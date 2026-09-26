// Package server serves Yuyan's pages, JSON API, images and embedded frontend assets.
package server

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io/fs"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/Crashmere/Yuyan/internal/render"
	"github.com/Crashmere/Yuyan/internal/store"
)

//go:embed templates/*.html
var templateFiles embed.FS

type Server struct {
	store     *store.Store
	base      string
	static    fs.FS
	entries   map[string]entry
	pages     map[string]*template.Template
	chromaCSS string
	loc       *time.Location

	mu    sync.Mutex
	cache map[int64]cachedRender
}

type entry struct {
	JS  string
	CSS []string
}

type cachedRender struct {
	revision int64
	result   render.Result
}

// New prepares the server. static is the Vite build output (web/dist); base is the public prefix,
// for example "/yuyan/", used when generating links. Requests themselves arrive without it.
func New(st *store.Store, static fs.FS, base string) (*Server, error) {
	if !strings.HasPrefix(base, "/") || !strings.HasSuffix(base, "/") {
		return nil, fmt.Errorf("base path %q must start and end with /", base)
	}
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		loc = time.FixedZone("CST", 8*3600)
	}
	s := &Server{store: st, base: base, static: static, chromaCSS: render.ChromaCSS(), loc: loc, cache: map[int64]cachedRender{}}
	if s.entries, err = readManifest(static); err != nil {
		return nil, err
	}
	if s.pages, err = s.parseTemplates(); err != nil {
		return nil, err
	}
	return s, nil
}

func readManifest(static fs.FS) (map[string]entry, error) {
	data, err := fs.ReadFile(static, "manifest.json")
	if err != nil {
		return nil, fmt.Errorf("frontend build missing (run npm --prefix web run build): %w", err)
	}
	var raw map[string]struct {
		File    string   `json:"file"`
		CSS     []string `json:"css"`
		IsEntry bool     `json:"isEntry"`
		Name    string   `json:"name"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	out := map[string]entry{}
	for _, v := range raw {
		if v.IsEntry {
			out[v.Name] = entry{JS: v.File, CSS: v.CSS}
		}
	}
	for _, name := range []string{"reader", "editor"} {
		if _, ok := out[name]; !ok {
			return nil, fmt.Errorf("frontend entry %q missing from manifest", name)
		}
	}
	return out, nil
}

// Handler routes requests. withPrefix also accepts the public prefix directly, standing in for
// Nginx during local testing.
func (s *Server) Handler(withPrefix bool) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { fmt.Fprintln(w, "ok") })

	mux.HandleFunc("GET /{$}", s.homePage)
	mux.HandleFunc("GET /books/{id}", s.bookPage)
	mux.HandleFunc("GET /docs/{id}", s.docPage)
	mux.HandleFunc("GET /docs/{id}/edit", s.editPage)
	mux.HandleFunc("GET /docs/{id}/history", s.historyPage)
	mux.HandleFunc("GET /versions/{id}", s.versionPage)
	mux.HandleFunc("GET /search", s.searchPage)
	mux.HandleFunc("GET /trash", s.trashPage)

	mux.HandleFunc("GET /assets/{file}", s.assetFile)
	mux.HandleFunc("GET /static/chroma.css", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		fmt.Fprint(w, s.chromaCSS)
	})
	mux.Handle("GET /static/", http.StripPrefix("/static/", immutable(http.FileServerFS(s.static))))

	mux.Handle("GET /api/meta", s.read(s.apiMeta))
	mux.Handle("GET /api/books", s.read(s.apiListBooks))
	mux.Handle("POST /api/books", s.write(s.apiCreateBook))
	mux.Handle("PATCH /api/books/{id}", s.write(s.apiUpdateBook))
	mux.Handle("DELETE /api/books/{id}", s.write(s.apiDeleteBook))
	mux.Handle("POST /api/books/{id}/restore", s.write(s.apiRestoreBook))
	mux.Handle("GET /api/books/{id}/tree", s.read(s.apiTree))
	mux.Handle("POST /api/docs", s.write(s.apiCreateDoc))
	mux.Handle("GET /api/docs/{id}", s.read(s.apiGetDoc))
	mux.Handle("PUT /api/docs/{id}", s.write(s.apiSaveDoc))
	mux.Handle("DELETE /api/docs/{id}", s.write(s.apiDeleteDoc))
	mux.Handle("POST /api/docs/{id}/restore", s.write(s.apiRestoreDoc))
	mux.Handle("POST /api/docs/{id}/snapshot", s.write(s.apiSnapshot))
	mux.Handle("GET /api/docs/{id}/versions", s.read(s.apiVersions))
	mux.Handle("GET /api/versions/{id}", s.read(s.apiGetVersion))
	mux.Handle("POST /api/versions/{id}/restore", s.write(s.apiRestoreVersion))
	mux.Handle("POST /api/assets", s.write(s.apiUploadAsset))
	mux.Handle("GET /api/search", s.read(s.apiSearch))

	var h http.Handler = headers(mux)
	if withPrefix {
		h = stripPrefix(s.base, h)
	}
	return h
}

func headers(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		h.ServeHTTP(w, r)
	})
}

func stripPrefix(base string, h http.Handler) http.Handler {
	bare := strings.TrimSuffix(base, "/")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == bare {
			http.Redirect(w, r, base, http.StatusPermanentRedirect)
			return
		}
		rest, ok := strings.CutPrefix(r.URL.Path, base)
		if !ok {
			http.NotFound(w, r)
			return
		}
		r2 := r.Clone(r.Context())
		r2.URL.Path = "/" + rest
		r2.URL.RawPath = ""
		h.ServeHTTP(w, r2)
	})
}

func immutable(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		h.ServeHTTP(w, r)
	})
}

// read wraps API reads.
func (s *Server) read(h func(http.ResponseWriter, *http.Request) error) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if err := h(w, r); err != nil {
			writeError(w, err)
		}
	})
}

// write wraps every state-changing API call. It is the single place where login will be enforced
// once HTTPS and authentication are added; until then access is open by the user's decision.
func (s *Server) write(h func(http.ResponseWriter, *http.Request) error) http.Handler {
	return s.read(h)
}

var assetName = regexp.MustCompile(`^[0-9a-f]{32}\.(png|jpg|gif|webp|bmp)$`)

var assetTypes = map[string]string{
	"png": "image/png", "jpg": "image/jpeg", "gif": "image/gif", "webp": "image/webp", "bmp": "image/bmp",
}

// assetFile serves images during local use; in production Nginx reads the files directly.
func (s *Server) assetFile(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("file")
	if !assetName.MatchString(name) {
		http.NotFound(w, r)
		return
	}
	id, ext, _ := strings.Cut(name, ".")
	w.Header().Set("Content-Type", assetTypes[ext])
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeFile(w, r, s.store.AssetPath(id, ext))
}

type apiError struct {
	Error    string `json:"error"`
	Message  string `json:"message"`
	Revision int64  `json:"revision,omitempty"`
}

type conflictError struct{ revision int64 }

func (c conflictError) Error() string { return "revision conflict" }

func writeError(w http.ResponseWriter, err error) {
	status, code, msg := http.StatusInternalServerError, "internal", "服务器出错，请稍后重试"
	var revision int64
	var conflict conflictError
	var maxBytes *http.MaxBytesError
	switch {
	case errors.As(err, &conflict):
		status, code, msg, revision = http.StatusConflict, "conflict", "文档已在别处修改", conflict.revision
	case errors.Is(err, store.ErrNotFound):
		status, code, msg = http.StatusNotFound, "not_found", "内容不存在或已删除"
	case errors.Is(err, store.ErrUnsupported):
		status, code, msg = http.StatusUnsupportedMediaType, "unsupported", "只支持 PNG、JPEG、GIF、WebP 和 BMP 图片"
	case errors.As(err, &maxBytes):
		status, code, msg = http.StatusRequestEntityTooLarge, "too_large", "内容过大"
	case errors.Is(err, store.ErrInvalid), errors.Is(err, errBadRequest):
		status, code, msg = http.StatusBadRequest, "invalid", err.Error()
	}
	writeJSON(w, status, apiError{Error: code, Message: msg, Revision: revision})
}

var errBadRequest = errors.New("bad request")

func badRequest(format string, args ...any) error {
	return fmt.Errorf("%w: %s", errBadRequest, fmt.Sprintf(format, args...))
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

const maxJSONBytes = 16 << 20

func readJSON(w http.ResponseWriter, r *http.Request, v any) error {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxJSONBytes))
	if err := dec.Decode(v); err != nil {
		var maxBytes *http.MaxBytesError
		if errors.As(err, &maxBytes) {
			return err
		}
		return badRequest("请求内容不是有效的 JSON：%v", err)
	}
	return nil
}
