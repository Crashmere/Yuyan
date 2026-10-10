package server

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/Crashmere/Yuyan/internal/store"
)

func (s *Server) apiExtractGroup(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	var body struct {
		BookID   int64           `json:"bookId"`
		ParentID json.RawMessage `json:"parentId"`
		Title    string          `json:"title"`
		ChildIDs []int64         `json:"childIds"`
	}
	if err := readJSON(w, r, &body); err != nil {
		return err
	}
	var parentID *int64
	if len(body.ParentID) == 0 || json.Unmarshal(body.ParentID, &parentID) != nil {
		return badRequest("请提交当前分组的父目录，根目录使用 null")
	}
	result, err := s.store.ExtractGroup(r.Context(), id, store.ExtractGroupInput{
		DissolveGroupInput: store.DissolveGroupInput{BookID: body.BookID, ParentID: parentID, ChildIDs: body.ChildIDs},
		Title:              body.Title,
	})
	if errors.Is(err, store.ErrInvalid) {
		return badRequest("只能提取目录分组，请提交当前名称、位置和直接子项列表")
	}
	if errors.Is(err, store.ErrConflict) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "conflict", "message": "分组名称或目录已变化，请刷新后重新提取"})
		return nil
	}
	if err != nil {
		return err
	}
	s.forget(id)
	writeJSON(w, http.StatusCreated, result)
	return nil
}
