package server

import (
	"context"
	"errors"
	"fmt"
	"hash/maphash"
	"html"
	"net/http"
	"strconv"
	"strings"

	"github.com/Crashmere/Yuyan/internal/doc"
	"github.com/Crashmere/Yuyan/internal/render"
	"github.com/Crashmere/Yuyan/internal/store"
)

// Long documents are read in segments (DESIGN 26.2): the reading page gets the first with the
// page and the rest as the reader nears them. Segments are cut between top-level blocks of the
// whole page's HTML, so together they are exactly that HTML, with its heading IDs and code
// block numbering.
const (
	segmentAbove = 256 << 10
	firstSegment = 64 << 10
	segmentSize  = 128 << 10
)

var errStale = errors.New("stale segments")

// page is a document rendered for reading, cached by revision.
type page struct {
	render.Result
	// version identifies the HTML within this process; segment requests name it.
	version string
	chars   int
	assets  []string
	// segments is nil when the page is short enough to send whole.
	segments []segment
}

type segment struct {
	start, end int
	info       segmentInfo
	assets     []string
}

type segmentInfo struct {
	Blocks int `json:"blocks"`
	Bytes  int `json:"bytes"`
	Codes  int `json:"codes"`
	TOC    int `json:"toc"`
	Images int `json:"images"`
	// Heads are the top-level headings: the block within the segment, the level, the outline
	// index or, for a heading outside the outline, its ID, and 1 if the reader can fold it.
	Heads [][4]any `json:"heads,omitempty"`
}

type segmentsView struct {
	Version string        `json:"version"`
	Items   []segmentInfo `json:"items"`
}

func (p *page) manifest() *segmentsView {
	v := &segmentsView{Version: p.version, Items: make([]segmentInfo, len(p.segments))}
	for i, sg := range p.segments {
		v.Items[i] = sg.info
	}
	return v
}

// cutSegments splits a long page between its top-level blocks, top being the document's
// top-level nodes in the same order. A remainder too short to be worth a request stays with
// the segment before it.
func cutSegments(res render.Result, top []doc.Node) []segment {
	blocks := res.Blocks
	if len(res.HTML) <= segmentAbove || len(blocks) != len(top) {
		return nil
	}
	var out []segment
	start, first, target := 0, 0, firstSegment
	for i, b := range blocks {
		last := i == len(blocks)-1
		if !last && (b.End-start < target || len(res.HTML)-b.End < segmentSize/4) {
			continue
		}
		sg := segment{start: start, end: b.End}
		before := render.Block{}
		if first > 0 {
			before = blocks[first-1]
		}
		sg.info = segmentInfo{Blocks: i - first + 1, Bytes: b.End - start, Codes: b.Codes - before.Codes, TOC: b.Headings - before.Headings}
		for j := first; j <= i; j++ {
			sg.info.Images += countImages(top[j])
			sg.assets = append(sg.assets, doc.AssetIDs(top[j])...)
			if blocks[j].Level == 0 {
				continue
			}
			var ref any = blocks[j].ID
			if j == 0 && blocks[j].Headings > 0 || j > 0 && blocks[j].Headings > blocks[j-1].Headings {
				ref = blocks[j].Headings - 1
			}
			// As folds.ts decides: a heading folds what follows it up to the next heading at
			// its level or above, so it needs a block after it that is not such a heading.
			foldable := 0
			if j+1 < len(blocks) && (blocks[j+1].Level == 0 || blocks[j+1].Level > blocks[j].Level) {
				foldable = 1
			}
			sg.info.Heads = append(sg.info.Heads, [4]any{j - first, blocks[j].Level, ref, foldable})
		}
		out = append(out, sg)
		start, first, target = b.End, i+1, segmentSize
	}
	if len(out) < 2 {
		return nil
	}
	return out
}

// countImages counts what shows as a picture, for estimating the height of unloaded segments.
func countImages(n doc.Node) int {
	c := 0
	if n.Type == "image" || n.Type == "drawing" {
		c++
	}
	for _, child := range n.Content {
		c += countImages(child)
	}
	return c
}

// pageFor returns the reading page of a live document, rendering it when the cache lacks this
// revision. d may lack its body (GetDocMeta); the body is then read, and the document returned
// is the one rendered, newer than d if it was saved in between. One rendering of a document
// runs at a time, so concurrent requests for a long document parse its body only once.
func (s *Server) pageFor(ctx context.Context, d store.Doc) (*page, store.Doc, error) {
	for {
		s.mu.Lock()
		if c, ok := s.cache[d.ID]; ok && c.revision == d.Revision && c.updatedAt == d.UpdatedAt {
			s.mu.Unlock()
			return c.page, d, nil
		}
		wait, busy := s.rendering[d.ID]
		if !busy {
			wait = make(chan struct{})
			s.rendering[d.ID] = wait
		}
		s.mu.Unlock()
		if busy {
			select {
			case <-wait:
				continue
			case <-ctx.Done():
				return nil, d, ctx.Err()
			}
		}
		p, full, err := s.renderPage(ctx, d.ID)
		s.mu.Lock()
		delete(s.rendering, d.ID)
		close(wait)
		if err == nil {
			if len(s.cache) >= 256 {
				clear(s.cache)
			}
			s.cache[d.ID] = cachedPage{revision: full.Revision, updatedAt: full.UpdatedAt, page: p}
		}
		s.mu.Unlock()
		return p, full, err
	}
}

func (s *Server) renderPage(ctx context.Context, id int64) (*page, store.Doc, error) {
	d, err := s.store.GetDoc(ctx, id)
	if err == nil && d.DeletedAt != "" {
		err = store.ErrNotFound
	}
	if err != nil {
		return nil, d, err
	}
	res := render.Render(d.Content, render.Options{BasePath: s.base})
	p := &page{
		Result:  res,
		version: fmt.Sprintf("%016x", maphash.String(etagSeed, res.HTML)),
		chars:   doc.CountChars(doc.PlainText(d.Content)),
		assets:  doc.AssetIDs(d.Content),
	}
	p.segments = cutSegments(res, d.Content.Content)
	p.Blocks = nil
	return p, d, nil
}

// segmentedPage finds the page a segment request is about, refusing a version that is no
// longer current: the document was saved, or the server restarted, since the page was read.
func (s *Server) segmentedPage(r *http.Request) (*page, error) {
	d, err := s.liveDocMeta(r)
	if err == nil && d.Kind != "doc" {
		err = store.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	p, _, err := s.pageFor(r.Context(), d)
	if err != nil {
		return nil, err
	}
	if p.segments == nil || r.URL.Query().Get("version") != p.version {
		return nil, errStale
	}
	return p, nil
}

type segmentsBody struct {
	HTML   string            `json:"html"`
	Images map[string][2]int `json:"images"`
}

// docSegments serves segments from to to-1 joined, with the sizes of their images. The version
// in the address pins the content, so the browser may keep the response.
func (s *Server) docSegments(w http.ResponseWriter, r *http.Request) error {
	p, err := s.segmentedPage(r)
	if err != nil {
		return err
	}
	q := r.URL.Query()
	from, err1 := strconv.Atoi(q.Get("from"))
	to, err2 := strconv.Atoi(q.Get("to"))
	if err1 != nil || err2 != nil || from < 0 || to > len(p.segments) || from >= to {
		return fmt.Errorf("%w: 段号应在 0 到 %d 之间", errBadRequest, len(p.segments))
	}
	var assets []string
	for _, sg := range p.segments[from:to] {
		assets = append(assets, sg.assets...)
	}
	images, err := s.store.AssetSizes(r.Context(), assets)
	if err != nil {
		return err
	}
	body, err := marshalJSON(segmentsBody{HTML: p.HTML[p.segments[from].start:p.segments[to-1].end], Images: images})
	if err != nil {
		return err
	}
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_, _ = w.Write(body)
	return nil
}

// docSegmentMatches lists the segments containing any word of q, as the page highlights them
// (shared/searchMatch.ts termPattern). The text is the HTML without tags, so this may list a
// segment whose only match is in a formula's source; the page checks again.
func (s *Server) docSegmentMatches(r *http.Request) (any, error) {
	p, err := s.segmentedPage(r)
	if err != nil {
		return nil, err
	}
	terms := strings.Fields(strings.ToLower(r.URL.Query().Get("q")))
	found := []int{}
	for i, sg := range p.segments {
		if len(terms) == 0 {
			break
		}
		text := strings.ToLower(htmlText(p.HTML[sg.start:sg.end]))
		for _, t := range terms {
			if strings.Contains(text, t) {
				found = append(found, i)
				break
			}
		}
	}
	return map[string][]int{"segments": found}, nil
}

// htmlText is the text of rendered HTML, each tag replaced by a line break so words in
// separate elements do not run together. The renderer escapes "<" in text and attributes.
func htmlText(h string) string {
	var b strings.Builder
	b.Grow(len(h) / 2)
	for {
		i := strings.IndexByte(h, '<')
		if i < 0 {
			b.WriteString(h)
			break
		}
		b.WriteString(h[:i])
		b.WriteByte('\n')
		j := strings.IndexByte(h[i:], '>')
		if j < 0 {
			break
		}
		h = h[i+j+1:]
	}
	return html.UnescapeString(b.String())
}
