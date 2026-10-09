package server

import (
	"encoding/json"
	"fmt"
	"html/template"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/Crashmere/Yuyan/internal/render"
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
	Entry   entry
	Initial template.JS
}

func (s *Server) parseShell() (*template.Template, error) {
	funcs := template.FuncMap{"static": func(p string) string { return s.base + "static/" + p }}
	return template.New("shell.html").Funcs(funcs).ParseFS(templateFiles, "templates/shell.html")
}

func (s *Server) appPage(rt route) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
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
			if v, ok := main("docs/"+id+"/view", s.docView); ok {
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
		initial, err := json.Marshal(p)
		if err != nil {
			slog.Error("preload", "path", r.URL.Path, "error", err)
			http.Error(w, "服务器出错，请稍后重试", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(status)
		// json.Marshal escapes <, > and &, so the data cannot end the script element early.
		data := shellData{Base: s.base, Title: title, Entry: s.entries["app"], Initial: template.JS(initial)}
		if err := s.shell.Execute(w, data); err != nil {
			slog.Error("render shell", "path", r.URL.Path, "error", err)
		}
	}
}

// rendered caches page HTML by document revision; saves invalidate through forget.
func (s *Server) rendered(d store.Doc) render.Result {
	s.mu.Lock()
	c, ok := s.cache[d.ID]
	s.mu.Unlock()
	if ok && c.revision == d.Revision {
		return c.result
	}
	res := render.Render(d.Content, render.Options{BasePath: s.base})
	s.mu.Lock()
	if len(s.cache) >= 256 {
		clear(s.cache)
	}
	s.cache[d.ID] = cachedRender{revision: d.Revision, result: res}
	s.mu.Unlock()
	return res
}

func (s *Server) forget(id int64) {
	s.mu.Lock()
	delete(s.cache, id)
	s.mu.Unlock()
}
