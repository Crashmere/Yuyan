package server

import (
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"time"

	"github.com/Crashmere/Yuyan/internal/doc"
)

func (s *Server) apiUploadAttachment(w http.ResponseWriter, r *http.Request) error {
	// Attachments can take longer than the server's ordinary two-minute request deadline.
	// Keep an idle read timeout instead, and start the response deadline after receiving the file.
	control := http.NewResponseController(w)
	_ = control.SetWriteDeadline(time.Time{})
	r.Body = &attachmentBody{ReadCloser: r.Body, control: control}
	defer func() { _ = control.SetWriteDeadline(time.Now().Add(2 * time.Minute)) }()
	reader, err := r.MultipartReader()
	if err != nil {
		return badRequest("无法读取附件上传表单")
	}
	file, err := reader.NextPart()
	if err != nil || file.FormName() != "file" || file.FileName() == "" {
		return badRequest("缺少附件文件")
	}
	name := doc.AttachmentName(file.FileName())
	a, err := s.store.PutAttachment(r.Context(), &attachmentPart{file, reader}, name)
	if errors.Is(err, io.ErrUnexpectedEOF) {
		return badRequest("附件上传未完成，请重试")
	}
	if err != nil {
		return err
	}
	a.URL = "/attachments/" + a.ID
	a.OriginalName = name // Each insertion keeps its own name, even for identical bytes.
	_ = control.SetWriteDeadline(time.Now().Add(2 * time.Minute))
	writeJSON(w, http.StatusCreated, a)
	return nil
}

type attachmentBody struct {
	io.ReadCloser
	control *http.ResponseController
}

// Large downloads must also outlive the ordinary response deadline while data keeps moving.
// Wrapping Write keeps the timeout idle-based without buffering the file in memory.
type attachmentWriter struct {
	http.ResponseWriter
	control *http.ResponseController
}

func (w attachmentWriter) Write(data []byte) (int, error) {
	_ = w.control.SetWriteDeadline(time.Now().Add(2 * time.Minute))
	return w.ResponseWriter.Write(data)
}

func (w attachmentWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (b *attachmentBody) Read(p []byte) (int, error) {
	_ = b.control.SetReadDeadline(time.Now().Add(2 * time.Minute))
	return b.ReadCloser.Read(p)
}

// Validate the final multipart boundary before publishing any file. Uploads contain one file;
// malformed trailing data or a second file must not leave a successfully registered attachment.
type attachmentPart struct {
	*multipart.Part
	reader *multipart.Reader
}

func (p *attachmentPart) Read(b []byte) (int, error) {
	n, err := p.Part.Read(b)
	if err == io.EOF {
		_, nextErr := p.reader.NextPart()
		if nextErr == nil {
			return n, badRequest("一次上传只支持一个附件文件")
		}
		if nextErr != io.EOF {
			return n, badRequest("附件上传表单不完整")
		}
	}
	return n, err
}

func (s *Server) attachmentFile(w http.ResponseWriter, r *http.Request) {
	w = attachmentWriter{w, http.NewResponseController(w)}
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
