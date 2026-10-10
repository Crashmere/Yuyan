package server

import (
	"errors"
	"net/http"

	"github.com/Crashmere/Yuyan/internal/store"
)

func (s *Server) apiDissolveGroup(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	var in store.DissolveGroupInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	err = s.store.DissolveGroup(r.Context(), id, in)
	if errors.Is(err, store.ErrInvalid) {
		return badRequest("只能解散目录分组，请提交当前分组的直接子项列表")
	}
	if errors.Is(err, store.ErrConflict) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "conflict", "message": "目录已变化，请刷新后重新解散分组"})
		return nil
	}
	if err != nil {
		return err
	}
	s.forget(id)
	w.WriteHeader(http.StatusNoContent)
	return nil
}
