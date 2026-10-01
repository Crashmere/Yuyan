package server

import (
	"errors"
	"io"
	"mime"
	"net/http"

	"github.com/Crashmere/Yuyan/internal/doc"
	"github.com/Crashmere/Yuyan/internal/store"
)

func (s *Server) apiUploadAttachment(w http.ResponseWriter, r *http.Request) error {
	r.Body = http.MaxBytesReader(w, r.Body, store.MaxAssetBytes+(1<<20))
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		var maxBytes *http.MaxBytesError
		if errors.As(err, &maxBytes) {
			return err
		}
		return badRequest("无法读取附件上传表单")
	}
	defer r.MultipartForm.RemoveAll()
	file, header, err := r.FormFile("file")
	if err != nil {
		return badRequest("缺少附件文件")
	}
	defer file.Close()
	if header.Size > store.MaxAssetBytes {
		return badRequest("单个附件不能超过 25 MiB")
	}
	data, err := io.ReadAll(io.LimitReader(file, store.MaxAssetBytes+1))
	if err != nil {
		return err
	}
	if len(data) > store.MaxAssetBytes {
		return badRequest("单个附件不能超过 25 MiB")
	}
	name := doc.AttachmentName(header.Filename)
	a, err := s.store.PutAttachment(r.Context(), data, name)
	if err != nil {
		return err
	}
	a.URL = "/attachments/" + a.ID
	a.OriginalName = name // Each insertion keeps its own name, even for identical bytes.
	writeJSON(w, http.StatusCreated, a)
	return nil
}

func (s *Server) attachmentFile(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !doc.AttachmentSource.MatchString("/attachments/" + id) {
		http.NotFound(w, r)
		return
	}
	a, err := s.store.GetAsset(r.Context(), id)
	if err != nil {
		writeError(w, err)
		return
	}
	name := a.OriginalName
	if r.URL.Query().Has("name") {
		name = r.URL.Query().Get("name")
	}
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": doc.AttachmentName(name)}))
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "sandbox")
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	http.ServeFile(w, r, s.store.AssetPath(a.ID, a.Ext))
}
