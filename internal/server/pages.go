package server

import (
	"errors"
	"fmt"
	"html/template"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/Crashmere/Yuyan/internal/render"
	"github.com/Crashmere/Yuyan/internal/store"
)

var pageNames = []string{"home", "book", "doc", "edit", "history", "version", "search", "trash", "notfound"}

func (s *Server) parseTemplates() (map[string]*template.Template, error) {
	funcs := template.FuncMap{
		"link": func(parts ...any) string {
			var b strings.Builder
			b.WriteString(s.base)
			for _, p := range parts {
				b.WriteString(fmt.Sprint(p))
			}
			return b.String()
		},
		"static": func(p string) string { return s.base + "static/" + p },
		"when":   s.formatTime,
		"html":   func(v string) template.HTML { return template.HTML(v) },
		"dict": func(kv ...any) map[string]any {
			m := map[string]any{}
			for i := 0; i+1 < len(kv); i += 2 {
				m[fmt.Sprint(kv[i])] = kv[i+1]
			}
			return m
		},
		"reason": func(r string) string {
			return map[string]string{"create": "新建", "autosave": "自动快照", "session": "编辑结束", "restore": "恢复"}[r]
		},
	}
	out := map[string]*template.Template{}
	for _, name := range pageNames {
		t, err := template.New("layout.html").Funcs(funcs).ParseFS(templateFiles, "templates/layout.html", "templates/"+name+".html")
		if err != nil {
			return nil, err
		}
		out[name] = t
	}
	return out, nil
}

func (s *Server) formatTime(stamp string) string {
	t, err := time.Parse(time.RFC3339Nano, stamp)
	if err != nil {
		return stamp
	}
	return t.In(s.loc).Format("2006-01-02 15:04")
}

type page struct {
	Base  string
	Entry entry
	Query string
	Data  any
}

func (s *Server) show(w http.ResponseWriter, r *http.Request, status int, name, entryName string, data any) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(status)
	p := page{Base: s.base, Entry: s.entries[entryName], Query: r.URL.Query().Get("q"), Data: data}
	if err := s.pages[name].Execute(w, p); err != nil {
		slog.Error("render page", "page", name, "error", err)
	}
}

func (s *Server) fail(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, store.ErrNotFound) {
		s.show(w, r, http.StatusNotFound, "notfound", "reader", nil)
		return
	}
	slog.Error("page", "path", r.URL.Path, "error", err)
	http.Error(w, "服务器出错，请稍后重试", http.StatusInternalServerError)
}

func (s *Server) homePage(w http.ResponseWriter, r *http.Request) {
	books, err := s.store.ListBooks(r.Context())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	recent, err := s.store.Recent(r.Context(), 20)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.show(w, r, http.StatusOK, "home", "reader", map[string]any{"Books": books, "Recent": recent})
}

type bookView struct {
	Book      store.Book
	Tree      []*store.TreeNode
	CurrentID int64
}

func (s *Server) loadBook(r *http.Request, id, current int64) (bookView, error) {
	b, err := s.store.GetBook(r.Context(), id)
	if err != nil {
		return bookView{}, err
	}
	if b.DeletedAt != "" {
		return bookView{}, store.ErrNotFound
	}
	tree, err := s.store.Tree(r.Context(), id)
	return bookView{Book: b, Tree: tree, CurrentID: current}, err
}

func (s *Server) bookPage(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	v, err := s.loadBook(r, id, 0)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.show(w, r, http.StatusOK, "book", "reader", v)
}

type docView struct {
	bookView
	Doc        store.Doc
	HTML       string
	TOC        []render.Heading
	Children   []*store.TreeNode
	Prev, Next *store.TreeNode
}

func (s *Server) loadDoc(r *http.Request) (docView, error) {
	id, err := pathID(r)
	if err != nil {
		return docView{}, err
	}
	d, err := s.store.GetDoc(r.Context(), id)
	if err != nil {
		return docView{}, err
	}
	if d.DeletedAt != "" {
		return docView{}, store.ErrNotFound
	}
	bv, err := s.loadBook(r, d.BookID, d.ID)
	if err != nil {
		return docView{}, err
	}
	v := docView{bookView: bv, Doc: d}
	flat := store.Flatten(bv.Tree)
	for i, n := range flat {
		if n.ID != d.ID {
			continue
		}
		v.Children = n.Children
		for j := i - 1; j >= 0; j-- {
			if flat[j].Kind == "doc" {
				v.Prev = flat[j]
				break
			}
		}
		for j := i + 1; j < len(flat); j++ {
			if flat[j].Kind == "doc" {
				v.Next = flat[j]
				break
			}
		}
	}
	return v, nil
}

func (s *Server) docPage(w http.ResponseWriter, r *http.Request) {
	v, err := s.loadDoc(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	res := s.rendered(v.Doc)
	v.HTML, v.TOC = res.HTML, res.TOC
	s.show(w, r, http.StatusOK, "doc", "reader", v)
}

func (s *Server) editPage(w http.ResponseWriter, r *http.Request) {
	v, err := s.loadDoc(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if v.Doc.Kind != "doc" {
		http.Redirect(w, r, fmt.Sprintf("%sdocs/%d", s.base, v.Doc.ID), http.StatusSeeOther)
		return
	}
	s.show(w, r, http.StatusOK, "edit", "editor", v)
}

func (s *Server) historyPage(w http.ResponseWriter, r *http.Request) {
	v, err := s.loadDoc(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	versions, err := s.store.Versions(r.Context(), v.Doc.ID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.show(w, r, http.StatusOK, "history", "reader", map[string]any{"View": v, "Versions": versions})
}

func (s *Server) versionPage(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	ver, err := s.store.GetVersion(r.Context(), id)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	d, err := s.store.GetDoc(r.Context(), ver.DocID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	res := render.Render(ver.Content, render.Options{BasePath: s.base})
	s.show(w, r, http.StatusOK, "version", "reader", map[string]any{"Version": ver, "Doc": d, "HTML": res.HTML})
}

func (s *Server) searchPage(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	hits, err := s.store.Search(r.Context(), q, 50)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.show(w, r, http.StatusOK, "search", "reader", map[string]any{"Q": q, "Hits": hits})
}

func (s *Server) trashPage(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.Trash(r.Context())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.show(w, r, http.StatusOK, "trash", "reader", map[string]any{"Items": items})
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
