package server

import (
	"errors"
	"net/http"

	"github.com/Crashmere/Yuyan/internal/store"
)

func (s *Server) apiBookToGroup(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	var body store.BookToGroupInput
	if err := readJSON(w, r, &body); err != nil {
		return err
	}
	result, err := s.store.BookToGroup(r.Context(), id, body)
	if errors.Is(err, store.ErrInvalid) {
		return badRequest("请选择另一个知识库，并提交来源知识库当前名称和有序根目录列表")
	}
	if errors.Is(err, store.ErrConflict) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "conflict", "message": "知识库名称或目录已变化，请刷新后重新转换"})
		return nil
	}
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, result)
	return nil
}
