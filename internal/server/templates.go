package server

import (
	"errors"
	"net/http"
	"sort"

	"github.com/Crashmere/Yuyan/internal/doc"
	"github.com/Crashmere/Yuyan/internal/render"
	"github.com/Crashmere/Yuyan/internal/store"
)

type templateEntry struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	Revision  int64  `json:"revision"`
	UpdatedAt string `json:"updatedAt"`
	Pinyin    string `json:"pinyin"`
	Snippet   string `json:"snippet"`
}

func (s *Server) templates(r *http.Request) (any, error) {
	items, err := s.store.Templates(r.Context())
	if err != nil {
		return nil, err
	}
	sort.SliceStable(items, func(i, j int) bool { return items[i].UpdatedAt > items[j].UpdatedAt })
	out := []templateEntry{}
	for _, t := range items {
		out = append(out, templateEntry{t.ID, t.Name, t.Kind, t.Revision, t.UpdatedAt, pinyinOf(t.Name), excerpt(doc.PlainText(t.Content))})
	}
	return out, nil
}

func (s *Server) template(r *http.Request) (any, error) {
	t, err := s.store.Template(r.Context(), r.PathValue("id"))
	if err != nil {
		return nil, err
	}
	res := render.Render(t.Content, render.Options{BasePath: s.base, NoHeadingIDs: true})
	images, err := s.imageSizes(r, t.Content)
	if err != nil {
		return nil, err
	}
	return struct {
		store.Template
		HTML   string            `json:"html"`
		Images map[string][2]int `json:"images"`
	}{t, res.HTML, images}, nil
}

func (s *Server) apiCreateTemplate(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Name    string   `json:"name"`
		Kind    string   `json:"kind"`
		Content doc.Node `json:"content"`
	}
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	t, err := s.store.CreateTemplate(r.Context(), in.Name, in.Kind, in.Content)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, t)
	return nil
}

func (s *Server) apiChangeTemplate(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Name         string `json:"name"`
		BaseRevision int64  `json:"baseRevision"`
	}
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	t, err := s.store.ChangeTemplate(r.Context(), r.PathValue("id"), in.Name, in.BaseRevision, r.Method == http.MethodDelete)
	if errors.Is(err, store.ErrConflict) {
		writeJSON(w, http.StatusConflict, apiError{Error: "conflict", Message: "模板已在别处修改，请刷新后重试"})
		return nil
	}
	if err != nil {
		return err
	}
	if r.Method == http.MethodDelete {
		w.WriteHeader(http.StatusNoContent)
	} else {
		writeJSON(w, http.StatusOK, t)
	}
	return nil
}
