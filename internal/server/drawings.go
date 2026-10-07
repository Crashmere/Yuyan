package server

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/Crashmere/Yuyan/internal/doc"
	"github.com/Crashmere/Yuyan/internal/drawing"
	"github.com/Crashmere/Yuyan/internal/store"
)

func (s *Server) apiDrawing(r *http.Request) (any, error) {
	if !drawing.Source.MatchString("/drawings/" + r.PathValue("id")) {
		return nil, store.ErrNotFound
	}
	return s.store.GetDrawing(r.Context(), r.PathValue("id"))
}

func (s *Server) apiPutDrawing(w http.ResponseWriter, r *http.Request) error {
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, drawing.MaxBytes))
	if err != nil {
		return fmt.Errorf("%w: 画板包最大 12 MiB", errBadRequest)
	}
	n, err := s.store.PutDrawing(r.Context(), data)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, n)
	return nil
}

func (s *Server) drawingPreview(w http.ResponseWriter, r *http.Request) {
	if !drawing.Source.MatchString("/drawings/" + r.PathValue("id")) {
		writeError(w, store.ErrNotFound)
		return
	}
	p, err := s.store.DrawingPreview(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Content-Type", p.Preview.Mime)
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	http.ServeContent(w, r, "drawing", time.Time{}, bytes.NewReader(p.PreviewBytes()))
}

func (s *Server) drawingFile(w http.ResponseWriter, r *http.Request) {
	if !drawing.Source.MatchString("/drawings/" + r.PathValue("id")) {
		writeError(w, store.ErrNotFound)
		return
	}
	a, err := s.store.GetAsset(r.Context(), r.PathValue("id"))
	if err != nil || a.Mime != drawing.Mime {
		writeError(w, store.ErrNotFound)
		return
	}
	// The exact immutable bytes preserve their content-addressed filename on export.
	w.Header().Set("Content-Type", drawing.Mime)
	w.Header().Set("Content-Disposition", `attachment; filename="drawing.yuyan.json"`)
	http.ServeFile(w, r, s.store.AssetPath(a.ID, a.Ext))
}

// Old tabs silently drop unknown Tiptap nodes. Refuse a destructive resave until
// a client that explicitly understands drawing-v1 reads and edits the document.
func requireDrawingClient(r *http.Request, n doc.Node) error {
	if doc.HasDrawing(n) && r.Header.Get("X-Yuyan-Features") != "drawing-v1" {
		return fmt.Errorf("%w: 文档包含画板，请刷新页面或更新 yuyan-doc 后再保存", errBadRequest)
	}
	return nil
}
