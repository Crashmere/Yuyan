// Package server serves Yuyan's pages, JSON API, images and embedded frontend assets.
package server

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io/fs"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"sync"

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
	shell     *template.Template
	chromaCSS string

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
	s := &Server{store: st, base: base, static: static, chromaCSS: render.ChromaCSS(), cache: map[int64]cachedRender{}}
	var err error
	if s.entries, err = readManifest(static); err != nil {
		return nil, err
	}
	if s.shell, err = s.parseShell(); err != nil {
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
		Imports []string `json:"imports"`
		IsEntry bool     `json:"isEntry"`
		Name    string   `json:"name"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	// An entry needs its own CSS plus the CSS of every chunk it imports statically.
	var collect func(key string, seen map[string]bool, css *[]string)
	collect = func(key string, seen map[string]bool, css *[]string) {
		if seen[key] {
			return
		}
		seen[key] = true
		chunk := raw[key]
		for _, imp := range chunk.Imports {
			collect(imp, seen, css)
		}
		for _, c := range chunk.CSS {
			if !seen["css:"+c] {
				seen["css:"+c] = true
				*css = append(*css, c)
			}
		}
	}
	out := map[string]entry{}
	for key, v := range raw {
		if v.IsEntry {
			var css []string
			collect(key, map[string]bool{}, &css)
			out[v.Name] = entry{JS: v.File, CSS: css}
		}
	}
	if _, ok := out["app"]; !ok {
		return nil, errors.New(`frontend entry "app" missing from manifest`)
	}
	return out, nil
}

// Handler routes requests. withPrefix also accepts the public prefix directly, standing in for
// Nginx during local testing.
func (s *Server) Handler(withPrefix bool) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { fmt.Fprintln(w, "ok") })

	// Every page is the same app shell; each route preloads the data its first screen needs.
	mux.HandleFunc("GET /{$}", s.appPage(routeHome))
	mux.HandleFunc("GET /books/{id}", s.appPage(routeBook))
	mux.HandleFunc("GET /docs/{id}", s.appPage(routeDoc))
	mux.HandleFunc("GET /docs/{id}/edit", s.appPage(routeEdit))
	mux.HandleFunc("GET /docs/{id}/history", s.appPage(routeHistory))
	mux.HandleFunc("GET /versions/{id}", s.appPage(routeVersion))
	mux.HandleFunc("GET /search", s.appPage(routeSearch))
	mux.HandleFunc("GET /trash", s.appPage(routeTrash))
	mux.HandleFunc("GET /", s.appPage(routeNotFound))

	mux.HandleFunc("GET /assets/{file}", s.assetFile)
	mux.HandleFunc("GET /static/chroma.css", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		fmt.Fprint(w, s.chromaCSS)
	})
	mux.Handle("GET /static/", http.StripPrefix("/static/", immutable(http.FileServerFS(s.static))))

	mux.Handle("GET /api/meta", s.read(s.apiMeta))
	mux.Handle("GET /api/books", s.get(s.books))
	mux.Handle("POST /api/books", s.write(s.apiCreateBook))
	mux.Handle("PUT /api/books/order", s.write(s.apiReorderBooks))
	mux.Handle("GET /api/books/{id}", s.get(s.book))
	mux.Handle("PATCH /api/books/{id}", s.write(s.apiUpdateBook))
	mux.Handle("DELETE /api/books/{id}", s.write(s.apiDeleteBook))
	mux.Handle("POST /api/books/{id}/restore", s.write(s.apiRestoreBook))
	mux.Handle("GET /api/books/{id}/tree", s.get(s.tree))
	mux.Handle("GET /api/recent", s.get(s.recent))
	mux.Handle("GET /api/titles", s.get(s.titles))
	mux.Handle("POST /api/docs", s.write(s.apiCreateDoc))
	mux.Handle("GET /api/docs/{id}", s.get(s.fullDoc))
	mux.Handle("PUT /api/docs/{id}", s.write(s.apiSaveDoc))
	mux.Handle("PATCH /api/docs/{id}", s.write(s.apiRenameDoc))
	mux.Handle("DELETE /api/docs/{id}", s.write(s.apiDeleteDoc))
	mux.Handle("GET /api/docs/{id}/view", s.get(s.docView))
	mux.Handle("POST /api/docs/{id}/move", s.write(s.apiMoveDoc))
	mux.Handle("POST /api/docs/{id}/restore", s.write(s.apiRestoreDoc))
	mux.Handle("POST /api/docs/{id}/snapshot", s.write(s.apiSnapshot))
	mux.Handle("POST /api/docs/{id}/discard", s.write(s.apiDiscardEdits))
	mux.Handle("GET /api/docs/{id}/versions", s.get(s.versions))
	mux.Handle("GET /api/versions/{id}", s.read(s.apiGetVersion))
	mux.Handle("GET /api/versions/{id}/view", s.get(s.versionView))
	mux.Handle("POST /api/versions/{id}/restore", s.write(s.apiRestoreVersion))
	mux.Handle("POST /api/assets", s.write(s.apiUploadAsset))
	mux.Handle("GET /api/search", s.read(s.apiSearch))
	mux.Handle("GET /api/trash", s.get(s.trash))
	mux.Handle("DELETE /api/trash", s.write(s.apiEmptyTrash))
	mux.Handle("DELETE /api/trash/docs/{id}", s.write(s.apiPurgeDoc))
	mux.Handle("DELETE /api/trash/books/{id}", s.write(s.apiPurgeBook))
	mux.Handle("GET /api/", s.read(func(http.ResponseWriter, *http.Request) error { return store.ErrNotFound }))

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

// get serves a read that pages also preload (see app.go), so both return the same JSON.
func (s *Server) get(load func(*http.Request) (any, error)) http.Handler {
	return s.read(func(w http.ResponseWriter, r *http.Request) error {
		v, err := load(r)
		if err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, v)
		return nil
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
	status, body := errorResponse(err)
	writeJSON(w, status, body)
}

func errorResponse(err error) (int, apiError) {
	var conflict conflictError
	var maxBytes *http.MaxBytesError
	switch {
	case errors.As(err, &conflict):
		return http.StatusConflict, apiError{Error: "conflict", Message: "文档已在别处修改", Revision: conflict.revision}
	case errors.Is(err, store.ErrNotFound):
		return http.StatusNotFound, apiError{Error: "not_found", Message: "内容不存在或已删除"}
	case errors.Is(err, store.ErrUnsupported):
		return http.StatusUnsupportedMediaType, apiError{Error: "unsupported", Message: "只支持 PNG、JPEG、GIF、WebP 和 BMP 图片"}
	case errors.As(err, &maxBytes):
		return http.StatusRequestEntityTooLarge, apiError{Error: "too_large", Message: "内容过大"}
	case errors.Is(err, store.ErrInvalid), errors.Is(err, errBadRequest):
		return http.StatusBadRequest, apiError{Error: "invalid", Message: err.Error()}
	}
	slog.Error("request", "error", err)
	return http.StatusInternalServerError, apiError{Error: "internal", Message: "服务器出错，请稍后重试"}
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
