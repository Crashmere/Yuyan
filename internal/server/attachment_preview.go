package server

import (
	"bytes"
	"context"
	"encoding/binary"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/Crashmere/Yuyan/internal/doc"
	"github.com/Crashmere/Yuyan/internal/store"
)

const previewTextBytes = 1 << 20

type attachmentPreview struct {
	Kind      string         `json:"kind"`
	Text      string         `json:"text,omitempty"`
	Entries   []archiveEntry `json:"entries,omitempty"`
	Truncated bool           `json:"truncated,omitempty"`
	Message   string         `json:"message,omitempty"`
}

func (s *Server) previewAsset(r *http.Request) (store.Asset, string, error) {
	id := r.PathValue("id")
	if !doc.AttachmentSource.MatchString("/attachments/" + id) {
		return store.Asset{}, "", store.ErrNotFound
	}
	a, err := s.store.GetAsset(r.Context(), id)
	name := a.OriginalName
	if r.URL.Query().Has("name") {
		name = doc.AttachmentName(r.URL.Query().Get("name"))
	}
	return a, name, err
}

// Only passive media gets an inline URL. HTML, SVG and XML are displayed as escaped text.
// PDF bytes are rendered by PDF.js, without the scripting or interactive-form layers.
func previewMedia(data []byte, name string) (kind, mediaType string) {
	t := http.DetectContentType(data)
	switch t {
	case "image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/x-icon":
		return "image", t
	case "application/pdf":
		return "pdf", t
	case "audio/mpeg", "audio/ogg", "audio/wave", "audio/aiff", "audio/midi":
		return "audio", t
	case "video/mp4", "video/webm", "video/ogg", "video/avi":
		if ext := strings.ToLower(filepath.Ext(name)); ext == ".m4a" || ext == ".ogg" || ext == ".opus" {
			return "audio", t
		}
		return "video", t
	}
	if bytes.HasPrefix(data, []byte("fLaC")) {
		return "audio", "audio/flac"
	}
	return "", ""
}

func (s *Server) attachmentPreview(r *http.Request) (any, error) {
	a, name, err := s.previewAsset(r)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(s.store.AssetPath(a.ID, a.Ext))
	if err != nil {
		return nil, store.ErrNotFound
	}
	defer f.Close()
	header := make([]byte, 512)
	n, err := f.ReadAt(header, 0)
	if err != nil && err != io.EOF {
		return nil, err
	}
	header = header[:n]
	if kind, _ := previewMedia(header, name); kind != "" {
		return attachmentPreview{Kind: kind}, nil
	}
	if format := archiveFormat(header, name); format != "" {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		return previewArchive(ctx, f, a.Size, format), nil
	}
	data, err := io.ReadAll(io.LimitReader(f, previewTextBytes+4))
	if err != nil {
		return nil, err
	}
	if text, ok := previewText(data, a.Size > previewTextBytes); ok {
		return attachmentPreview{Kind: "text", Text: text, Truncated: a.Size > previewTextBytes}, nil
	}
	return attachmentPreview{Kind: "unsupported", Message: "暂不支持此格式的在线预览，可下载后打开。"}, nil
}

func previewText(data []byte, truncated bool) (string, bool) {
	if bytes.HasPrefix(data, []byte{0xff, 0xfe}) || bytes.HasPrefix(data, []byte{0xfe, 0xff}) {
		var order binary.ByteOrder = binary.LittleEndian
		if data[0] == 0xfe {
			order = binary.BigEndian
		}
		u := make([]uint16, 0, len(data)/2)
		for i := 2; i+1 < len(data); i += 2 {
			u = append(u, order.Uint16(data[i:i+2]))
		}
		data = []byte(string(utf16.Decode(u)))
	} else {
		data = bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf})
	}
	if truncated {
		if len(data) > previewTextBytes {
			data = data[:previewTextBytes]
		}
		for i := 0; i < 3 && len(data) > 0 && !utf8.Valid(data); i++ {
			data = data[:len(data)-1]
		}
	}
	if !utf8.Valid(data) {
		return "", false
	}
	for _, c := range data {
		if c < 32 && c != '\n' && c != '\r' && c != '\t' && c != '\f' {
			return "", false
		}
	}
	return string(data), true
}

func (s *Server) attachmentContent(w http.ResponseWriter, r *http.Request) {
	a, name, err := s.previewAsset(r)
	if err != nil {
		writeError(w, err)
		return
	}
	f, err := os.Open(s.store.AssetPath(a.ID, a.Ext))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	header := make([]byte, 512)
	n, _ := f.ReadAt(header, 0)
	_, mediaType := previewMedia(header[:n], name)
	if mediaType == "" {
		http.Error(w, "此文件不支持直接预览", http.StatusUnsupportedMediaType)
		return
	}
	w.Header().Set("Content-Type", mediaType)
	w.Header().Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": name}))
	w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'")
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	http.ServeContent(w, r, name, time.Time{}, f)
}
