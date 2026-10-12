package server

import (
	"net/http"
	"strconv"

	"github.com/Crashmere/Yuyan/internal/doc"
	"github.com/Crashmere/Yuyan/internal/render"
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
	p, err := s.store.RecentChangeBase(r.Context(), d)
	if err != nil {
		return nil, err
	}
	out := map[string]any{"revision": d.Revision, "baseline": nil}
	if p != nil {
		out["baseline"] = map[string]any{
			"id": p.ID, "revision": p.Revision, "title": p.Title,
			"html": render.Render(p.Content, render.Options{BasePath: s.base}).HTML,
		}
		out["summary"] = doc.SummarizeChanges(p.Title, p.Content, d.Title, d.Content)
	}
	return out, nil
}
