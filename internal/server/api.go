package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/Crashmere/Yuyan/internal/doc"
	"github.com/Crashmere/Yuyan/internal/store"
)

func pathID(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, store.ErrNotFound
	}
	return id, nil
}

func (s *Server) apiMeta(w http.ResponseWriter, r *http.Request) error {
	stats, err := s.store.Stats(r.Context())
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{"schemaVersion": doc.SchemaVersion, "stats": stats})
	return nil
}

func (s *Server) apiListBooks(w http.ResponseWriter, r *http.Request) error {
	books, err := s.store.ListBooks(r.Context())
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, nonNil(books))
	return nil
}

type bookInput struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

func (s *Server) apiCreateBook(w http.ResponseWriter, r *http.Request) error {
	var in bookInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	b, err := s.store.CreateBook(r.Context(), in.Name, in.Description)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, b)
	return nil
}

func (s *Server) apiUpdateBook(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	var in bookInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	b, err := s.store.UpdateBook(r.Context(), id, in.Name, in.Description)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, b)
	return nil
}

func (s *Server) apiDeleteBook(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	if err := s.store.DeleteBook(r.Context(), id); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Server) apiRestoreBook(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	if err := s.store.RestoreBook(r.Context(), id); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Server) apiTree(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	if _, err := s.store.GetBook(r.Context(), id); err != nil {
		return err
	}
	tree, err := s.store.Tree(r.Context(), id)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, nonNil(tree))
	return nil
}

type createDocInput struct {
	BookID     int64           `json:"bookId"`
	ParentID   *int64          `json:"parentId"`
	Kind       string          `json:"kind"`
	Title      string          `json:"title"`
	Content    json.RawMessage `json:"content"`
	SourcePath string          `json:"sourcePath"`
}

func (s *Server) apiCreateDoc(w http.ResponseWriter, r *http.Request) error {
	var in createDocInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	create := store.CreateDocInput{BookID: in.BookID, ParentID: in.ParentID, Kind: in.Kind, Title: in.Title, SourcePath: in.SourcePath}
	if len(in.Content) > 0 && string(in.Content) != "null" {
		n, err := doc.Parse(in.Content)
		if err != nil {
			return badRequest("%v", err)
		}
		create.Content = &n
	}
	d, err := s.store.CreateDoc(r.Context(), create)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, d)
	return nil
}

func (s *Server) apiGetDoc(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	d, err := s.store.GetDoc(r.Context(), id)
	if err != nil {
		return err
	}
	if d.DeletedAt != "" {
		return store.ErrNotFound
	}
	writeJSON(w, http.StatusOK, d)
	return nil
}

type saveDocInput struct {
	Title        string          `json:"title"`
	Content      json.RawMessage `json:"content"`
	BaseRevision int64           `json:"baseRevision"`
}

func (s *Server) apiSaveDoc(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	var in saveDocInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	content, err := doc.Parse(in.Content)
	if err != nil {
		return badRequest("%v", err)
	}
	revision, updated, err := s.store.SaveDoc(r.Context(), id, in.Title, content, in.BaseRevision)
	if errors.Is(err, store.ErrConflict) {
		return conflictError{revision: revision}
	}
	if err != nil {
		return err
	}
	s.forget(id)
	writeJSON(w, http.StatusOK, map[string]any{"revision": revision, "updatedAt": updated})
	return nil
}

func (s *Server) apiDeleteDoc(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	if err := s.store.DeleteDoc(r.Context(), id); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Server) apiRestoreDoc(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	if err := s.store.RestoreDoc(r.Context(), id); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Server) apiSnapshot(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	if err := s.store.Snapshot(r.Context(), id); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Server) apiVersions(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	versions, err := s.store.Versions(r.Context(), id)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, nonNil(versions))
	return nil
}

func (s *Server) apiGetVersion(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	v, err := s.store.GetVersion(r.Context(), id)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, v)
	return nil
}

func (s *Server) apiRestoreVersion(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	var in struct {
		BaseRevision int64 `json:"baseRevision"`
	}
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	v, err := s.store.GetVersion(r.Context(), id)
	if err != nil {
		return err
	}
	revision, err := s.store.RestoreVersion(r.Context(), id, in.BaseRevision)
	if errors.Is(err, store.ErrConflict) {
		return conflictError{revision: revision}
	}
	if err != nil {
		return err
	}
	s.forget(v.DocID)
	writeJSON(w, http.StatusOK, map[string]any{"revision": revision, "docId": v.DocID})
	return nil
}

func (s *Server) apiUploadAsset(w http.ResponseWriter, r *http.Request) error {
	r.Body = http.MaxBytesReader(w, r.Body, store.MaxAssetBytes+1<<20)
	file, header, err := r.FormFile("file")
	if err != nil {
		var maxBytes *http.MaxBytesError
		if errors.As(err, &maxBytes) {
			return err
		}
		return badRequest("缺少图片文件：%v", err)
	}
	defer file.Close()
	data, err := io.ReadAll(file)
	if err != nil {
		return err
	}
	a, err := s.store.PutAsset(r.Context(), data, header.Filename)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, a)
	return nil
}

func (s *Server) apiSearch(w http.ResponseWriter, r *http.Request) error {
	hits, err := s.store.Search(r.Context(), r.URL.Query().Get("q"), 50)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, nonNil(hits))
	return nil
}

// nonNil keeps empty lists as [] rather than null in JSON.
func nonNil[T any](v []T) []T {
	if v == nil {
		return []T{}
	}
	return v
}
