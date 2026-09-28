package server

import (
	"errors"
	"net/http"

	"github.com/Crashmere/Yuyan/internal/store"
)

func (s *Server) apiBatchDocs(w http.ResponseWriter, r *http.Request) error {
	var in store.BatchDocsInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	result, err := s.store.BatchDocs(r.Context(), in)
	if errors.Is(err, store.ErrInvalid) {
		return badRequest("无法批量操作：请检查所选项目和目标位置")
	}
	if errors.Is(err, store.ErrConflict) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "conflict", "message": "目录已变化，请重新选择后重试"})
		return nil
	}
	if err != nil {
		return err
	}
	for _, id := range result.IDs {
		s.forget(id)
	}
	writeJSON(w, http.StatusOK, result)
	return nil
}
