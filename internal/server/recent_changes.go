package server

import (
	"net/http"
	"strconv"

	"github.com/Crashmere/Yuyan/internal/store"
)

// Loaded only when the reader enables change markers. It never writes history or
// returns an invented empty baseline when retained history is unavailable.
func (s *Server) recentChanges(r *http.Request) (any, error) {
	d, err := s.liveDoc(r)
	if err != nil {
		return nil, err
	}
	if d.Kind != "doc" {
		return nil, store.ErrNotFound
	}
	if revision := r.URL.Query().Get("revision"); revision != "" && revision != strconv.FormatInt(d.Revision, 10) {
		return nil, conflictError{revision: d.Revision}
	}
	heads, err := s.store.VersionHeads(r.Context(), d.ID)
	if err != nil {
		return nil, err
	}
	l := &snapshots{ctx: r.Context(), store: s.store}
	p, err := s.recentChangeBase(heads, d, l)
	if err != nil {
		return nil, err
	}
	out := map[string]any{"revision": d.Revision, "baseline": nil}
	if p != nil {
		page, err := s.versionPage(*p, l)
		if err != nil {
			return nil, err
		}
		summary, err := s.summaryToCurrent(*p, d, l)
		if err != nil {
			return nil, err
		}
		out["baseline"] = map[string]any{"id": p.ID, "revision": p.Revision, "title": p.Title, "html": page.HTML}
		out["summary"] = summary
	}
	return out, nil
}
