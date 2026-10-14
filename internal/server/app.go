package server

import (
	"bytes"
	"fmt"
	"html/template"
	"log/slog"
	"net/http"
	"slices"
	"strconv"

	"github.com/Crashmere/Yuyan/internal/store"
)

type route int

const (
	routeHome route = iota
	routeBook
	routeDoc
	routeEdit
	routeHistory
	routeVersion
	routeSearch
	routeTrash
	routeNotFound
)

// routeViews are the views the app loads on demand, by source path as in the build manifest. The
// reading page is part of the app entry.
var routeViews = map[route]string{
	routeHome:     "src/app/views/HomeView.vue",
	routeBook:     "src/app/views/BookView.vue",
	routeEdit:     "src/app/views/EditView.vue",
	routeHistory:  "src/app/views/HistoryView.vue",
	routeVersion:  "src/app/views/VersionView.vue",
	routeSearch:   "src/app/views/SearchView.vue",
	routeTrash:    "src/app/views/TrashView.vue",
	routeNotFound: "src/app/views/NotFoundView.vue",
}

// pageAssets are what a page needs from the start: the app with every chunk it imports, and the
// view when that is loaded on demand. Listing them all lets the browser fetch them at once instead
// of discovering them one import at a time. The view's files are fetched at low priority, so a
// large view such as the editor does not hold back the app, which shows the page meanwhile.
type pageAssets struct {
	JS      string
	CSS     []string
	Preload []string
	// The app applies ViewCSS when it loads the view; the page only fetches it early.
	ViewCSS     []string
	ViewPreload []string
}

func newPages(app entry, views map[string]entry) (map[route]pageAssets, error) {
	pages := map[route]pageAssets{routeDoc: {JS: app.JS, CSS: app.CSS, Preload: app.Imports}}
	for rt, key := range routeViews {
		view, ok := views[key]
		if !ok {
			return nil, fmt.Errorf("frontend view %q is not loaded on demand in the build", key)
		}
		p := pageAssets{JS: app.JS, CSS: app.CSS, Preload: app.Imports}
		have := map[string]bool{app.JS: true}
		for _, f := range append(slices.Clone(app.Imports), app.CSS...) {
			have[f] = true
		}
		for _, f := range append([]string{view.JS}, view.Imports...) {
			if !have[f] {
				have[f] = true
				p.ViewPreload = append(p.ViewPreload, f)
			}
		}
		for _, c := range view.CSS {
			if !have[c] {
				have[c] = true
				p.ViewCSS = append(p.ViewCSS, c)
			}
		}
		pages[rt] = p
	}
	return pages, nil
}

type preloaded struct {
	Status int `json:"status"`
	Body   any `json:"body"`
}

// preload records the API responses the first screen needs, keyed by the API path the app will
// request, so opening any page costs a single round trip.
type preload map[string]preloaded

func (p preload) add(path string, r *http.Request, load func(*http.Request) (any, error)) (any, bool) {
	v, err := load(r)
	if err != nil {
		status, body := errorResponse(err)
		p[path] = preloaded{Status: status, Body: body}
		return nil, false
	}
	p[path] = preloaded{Status: http.StatusOK, Body: v}
	return v, true
}

// withID lets a loader that reads the {id} path value run for another object, such as the
// knowledge base of the document being opened.
func withID(r *http.Request, id int64) *http.Request {
	r2 := r.Clone(r.Context())
	r2.SetPathValue("id", strconv.FormatInt(id, 10))
	return r2
}

type shellData struct {
	Base    string
	Title   string
	Assets  pageAssets
	Initial template.JS
}

func (s *Server) parseShell() (*template.Template, error) {
	funcs := template.FuncMap{"static": func(p string) string { return s.base + "static/" + p }}
	return template.New("shell.html").Funcs(funcs).ParseFS(templateFiles, "templates/shell.html")
}

func (s *Server) appPage(rt route) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if rt == routeEdit {
			// The reading page asks first, before the editor loads the whole document (DESIGN 26.6).
			if id, err := strconv.ParseInt(r.PathValue("id"), 10, 64); err == nil {
				if heavy, err := s.store.HeavyToEdit(r.Context(), id); err == nil && heavy {
					http.Redirect(w, r, fmt.Sprintf("%sdocs/%d?edit=1", s.base, id), http.StatusFound)
					return
				}
			}
		}
		p := preload{}
		p.add("books", r, s.books)
		p.add("book-groups", r, s.bookGroups)
		id := r.PathValue("id")
		status, title := http.StatusOK, ""
		// main loads the object the page is about; its failure decides the page status.
		main := func(path string, load func(*http.Request) (any, error)) (any, bool) {
			v, ok := p.add(path, r, load)
			if !ok {
				status = p[path].Status
			}
			return v, ok
		}
		tree := func(bookID int64) {
			p.add(fmt.Sprintf("books/%d/tree", bookID), withID(r, bookID), s.tree)
		}
		switch rt {
		case routeHome:
			p.add("recent", r, s.recent)
			p.add("stats", r, s.stats)
		case routeBook:
			if v, ok := main("books/"+id, s.book); ok {
				title = v.(store.Book).Name
				tree(v.(store.Book).ID)
			}
		case routeDoc:
			if v, ok := main("docs/"+id+"/view?segments=1", s.readingView); ok {
				d := v.(docView).Doc
				title = d.Title
				tree(d.BookID)
			}
		case routeEdit:
			if v, ok := main("docs/"+id, s.fullDoc); ok {
				d := v.(docWithImages)
				title = "编辑：" + d.Title
				tree(d.BookID)
			}
		case routeHistory:
			if v, ok := main("docs/"+id+"/versions", s.versions); ok {
				d := v.(map[string]any)["doc"].(store.DocMeta)
				title = "历史版本：" + d.Title
				tree(d.BookID)
			}
		case routeVersion:
			if v, ok := main("versions/"+id+"/view", s.versionView); ok {
				d := v.(map[string]any)["doc"].(store.DocMeta)
				title = "版本预览：" + d.Title
				tree(d.BookID)
			}
		case routeSearch:
			title = "搜索"
		case routeTrash:
			p.add("trash", r, s.trash)
			title = "回收站"
		case routeNotFound:
			status = http.StatusNotFound
		}
		if status == http.StatusNotFound {
			title = "找不到内容"
		}
		if title == "" {
			title = "语燕"
		} else {
			title += " - 语燕"
		}
		initial, err := marshalJSON(p)
		if err != nil {
			slog.Error("preload", "path", r.URL.Path, "error", err)
			http.Error(w, "服务器出错，请稍后重试", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(status)
		// With every "<" escaped, the data can neither end the script element nor open a comment
		// in it; ">" and "&" mean nothing there.
		initial = bytes.ReplaceAll(initial, []byte("<"), []byte(`\u003c`))
		data := shellData{Base: s.base, Title: title, Assets: s.pages[rt], Initial: template.JS(initial)}
		if err := s.shell.Execute(w, data); err != nil {
			slog.Error("render shell", "path", r.URL.Path, "error", err)
		}
	}
}

// forget drops a document's cached page after a save; the cache also compares the revision and
// update time, as a purged document's ID can be reused.
func (s *Server) forget(id int64) {
	s.mu.Lock()
	delete(s.cache, id)
	s.mu.Unlock()
}
