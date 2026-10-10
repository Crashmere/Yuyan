package server

import (
	"errors"
	"net/http"

	"github.com/Crashmere/Yuyan/internal/store"
)

func (s *Server) bookGroups(r *http.Request) (any, error) {
	return s.store.BookGroups(r.Context())
}

func (s *Server) apiBookGroups(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		BaseRevision int64             `json:"baseRevision"`
		Groups       []store.BookGroup `json:"groups"`
		BookOrder    []int64           `json:"bookOrder"`
	}
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	next, err := s.store.SaveBookGroups(r.Context(), in.Groups, in.BaseRevision, in.BookOrder)
	if errors.Is(err, store.ErrConflict) {
		writeJSON(w, http.StatusConflict, map[string]any{"error": "conflict", "message": "知识库分组已在别处修改，请刷新后重试", "revision": next.Revision})
		return nil
	}
	if errors.Is(err, store.ErrInvalid) {
		return badRequest("分组或知识库顺序无效，请刷新列表后重试")
	}
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, next)
	return nil
}
