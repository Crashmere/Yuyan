package server

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/Crashmere/Yuyan/internal/doc"
	"github.com/Crashmere/Yuyan/internal/render"
	"github.com/Crashmere/Yuyan/internal/store"
)

func excerpt(text string) string {
	r := []rune(strings.Join(strings.Fields(text), " "))
	if len(r) > 180 {
		return string(r[:180]) + "…"
	}
	return string(r)
}

type linkHeading struct {
	render.Heading
	Pinyin string `json:"pinyin"`
}
type linkTarget struct {
	ID       int64         `json:"id"`
	Title    string        `json:"title"`
	BookName string        `json:"bookName"`
	Pinyin   string        `json:"pinyin"`
	Headings []linkHeading `json:"headings"`
}

func (s *Server) linkTargets(r *http.Request) (any, error) {
	docs, err := s.store.LiveLinkDocs(r.Context())
	if err != nil {
		return nil, err
	}
	out := []linkTarget{}
	for _, d := range docs {
		t := linkTarget{ID: d.ID, Title: d.Title, BookName: d.BookName, Pinyin: pinyinOf(d.Title), Headings: []linkHeading{}}
		for _, h := range render.Headings(d.Content) {
			if h.Text != "" {
				t.Headings = append(t.Headings, linkHeading{h, pinyinOf(h.Text)})
			}
		}
		out = append(out, t)
	}
	return out, nil
}

func (s *Server) linkDoc(r *http.Request) (store.Doc, error) {
	d, err := s.liveDoc(r)
	if err != nil {
		return d, err
	}
	b, err := s.store.GetBook(r.Context(), d.BookID)
	if err == nil && (b.DeletedAt != "" || d.Kind != "doc") {
		err = store.ErrNotFound
	}
	return d, err
}

func (s *Server) linkPreview(r *http.Request) (any, error) {
	d, err := s.linkDoc(r)
	if err != nil {
		return nil, err
	}
	heading := r.URL.Query().Get("heading")
	text, title := doc.PlainText(d.Content), ""
	if heading != "" {
		headings, index, active, finished, level := render.Headings(d.Content), 0, false, false, 0
		var parts []string
		var walk func(doc.Node)
		walk = func(n doc.Node) {
			if finished {
				return
			}
			if n.Type == "heading" {
				h := headings[index]
				index++
				if active && h.Level <= level {
					finished = true
					return
				}
				if h.ID == heading {
					active, level, title = true, h.Level, h.Text
					return
				}
			}
			if active {
				if n.Type == "text" {
					parts = append(parts, n.Text)
				}
				if n.Type == "image" {
					parts = append(parts, n.Attr("caption"))
				}
			}
			for _, c := range n.Content {
				walk(c)
			}
		}
		walk(d.Content)
		if !active {
			return nil, store.ErrNotFound
		}
		text = strings.Join(parts, " ")
	}
	return map[string]any{"id": d.ID, "title": d.Title, "bookName": d.BookName, "heading": title, "snippet": excerpt(text)}, nil
}

func (s *Server) internalLinkID(href string) int64 {
	u, err := url.Parse(href)
	if err != nil || u.IsAbs() || u.Host != "" {
		return 0
	}
	path := u.Path
	if s.base != "/" {
		path = strings.TrimPrefix(path, strings.TrimSuffix(s.base, "/"))
	}
	id, ok := strings.CutPrefix(path, "/docs/")
	if !ok {
		return 0
	}
	n, err := strconv.ParseInt(id, 10, 64)
	if err != nil || n <= 0 {
		return 0
	}
	return n
}

type backlink struct {
	ID       int64  `json:"id"`
	Title    string `json:"title"`
	BookName string `json:"bookName"`
	Heading  string `json:"heading"`
	Snippet  string `json:"snippet"`
}

func (s *Server) backlinks(r *http.Request) (any, error) {
	target, err := s.linkDoc(r)
	if err != nil {
		return nil, err
	}
	docs, err := s.store.LiveLinkDocs(r.Context())
	if err != nil {
		return nil, err
	}
	out := []backlink{}
	for _, d := range docs {
		if d.ID == target.ID {
			continue
		}
		headings, index, current, found := render.Headings(d.Content), 0, "", false
		var walk func(doc.Node, string)
		walk = func(n doc.Node, context string) {
			if found {
				return
			}
			if n.Type == "heading" {
				current = headings[index].ID
				index++
			}
			if n.Type == "paragraph" || n.Type == "heading" {
				context = doc.PlainText(n)
			}
			for _, m := range n.Marks {
				if m.Type == "link" && s.internalLinkID(m.Attr("href")) == target.ID {
					if context == "" {
						context = doc.PlainText(n)
					}
					out = append(out, backlink{d.ID, d.Title, d.BookName, current, excerpt(context)})
					found = true
					return
				}
			}
			for _, c := range n.Content {
				walk(c, context)
			}
		}
		walk(d.Content, "")
	}
	return out, nil
}
