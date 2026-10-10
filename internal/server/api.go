package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"slices"
	"strconv"

	"github.com/Crashmere/Yuyan/internal/doc"
	"github.com/Crashmere/Yuyan/internal/render"
	"github.com/Crashmere/Yuyan/internal/store"
)

func pathID(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, store.ErrNotFound
	}
	return id, nil
}

// ---------------------------------------------------------------------------------------------
// Reads shared by the JSON API and page preloading. Each takes the request for its path values.

type bookEntry struct {
	store.Book
	Pinyin string `json:"pinyin"`
}

func (s *Server) books(r *http.Request) (any, error) {
	books, err := s.store.ListBooks(r.Context())
	if err != nil {
		return nil, err
	}
	out := make([]bookEntry, len(books))
	for i, b := range books {
		out[i] = bookEntry{Book: b, Pinyin: pinyinOf(b.Name)}
	}
	return out, nil
}

func (s *Server) liveBook(r *http.Request) (store.Book, error) {
	id, err := pathID(r)
	if err != nil {
		return store.Book{}, err
	}
	b, err := s.store.GetBook(r.Context(), id)
	if err == nil && b.DeletedAt != "" {
		err = store.ErrNotFound
	}
	return b, err
}

func (s *Server) book(r *http.Request) (any, error) {
	return s.liveBook(r)
}

func (s *Server) tree(r *http.Request) (any, error) {
	b, err := s.liveBook(r)
	if err != nil {
		return nil, err
	}
	tree, err := s.store.Tree(r.Context(), b.ID)
	return nonNil(tree), err
}

func (s *Server) recent(r *http.Request) (any, error) {
	recent, err := s.store.Recent(r.Context(), 20)
	return nonNil(recent), err
}

func (s *Server) stats(r *http.Request) (any, error) {
	return s.store.DocumentStats(r.Context())
}

type titleEntry struct {
	ID       int64    `json:"id"`
	Title    string   `json:"title"`
	Pinyin   string   `json:"pinyin"`
	BookID   int64    `json:"bookId"`
	BookName string   `json:"bookName"`
	Path     []string `json:"path"`
}

// titles lists every document with its knowledge base and the titles above it, so the search
// panel can match titles as the user types without a request per keystroke.
func (s *Server) titles(r *http.Request) (any, error) {
	books, err := s.store.ListBooks(r.Context())
	if err != nil {
		return nil, err
	}
	out := []titleEntry{}
	for _, b := range books {
		tree, err := s.store.Tree(r.Context(), b.ID)
		if err != nil {
			return nil, err
		}
		var walk func(nodes []*store.TreeNode, path []string)
		walk = func(nodes []*store.TreeNode, path []string) {
			for _, n := range nodes {
				if n.Kind == "doc" {
					out = append(out, titleEntry{ID: n.ID, Title: n.Title, Pinyin: pinyinOf(n.Title), BookID: b.ID, BookName: b.Name, Path: slices.Clone(path)})
				}
				walk(n.Children, append(slices.Clone(path), n.Title))
			}
		}
		walk(tree, []string{})
	}
	return out, nil
}

func (s *Server) liveDoc(r *http.Request) (store.Doc, error) {
	id, err := pathID(r)
	if err != nil {
		return store.Doc{}, err
	}
	d, err := s.store.GetDoc(r.Context(), id)
	if err == nil && d.DeletedAt != "" {
		err = store.ErrNotFound
	}
	return d, err
}

// imageSizes gives the pixel size of a document's uploaded images, keyed by asset id, so pages can
// reserve their space before the images load.
func (s *Server) imageSizes(r *http.Request, n doc.Node) (map[string][2]int, error) {
	return s.store.AssetSizes(r.Context(), doc.AssetIDs(n))
}

type docWithImages struct {
	store.Doc
	Images map[string][2]int `json:"images"`
}

func (s *Server) fullDoc(r *http.Request) (any, error) {
	d, err := s.liveDoc(r)
	if err != nil {
		return nil, err
	}
	images, err := s.imageSizes(r, d.Content)
	if err != nil {
		return nil, err
	}
	return docWithImages{Doc: d, Images: images}, nil
}

type docLink struct {
	ID    int64  `json:"id"`
	Title string `json:"title"`
}

type docView struct {
	Doc        store.DocMeta     `json:"doc"`
	HTML       string            `json:"html"`
	TOC        []render.Heading  `json:"toc"`
	HasMath    bool              `json:"hasMath"`
	HasMermaid bool              `json:"hasMermaid"`
	Chars      int               `json:"chars"`
	Prev       *docLink          `json:"prev"`
	Next       *docLink          `json:"next"`
	Children   []*store.TreeNode `json:"children"`
	Images     map[string][2]int `json:"images"`
}

// docView is what the reading view shows: rendered content, its outline, the neighbours in
// reading order, and for groups the documents under them.
func (s *Server) docView(r *http.Request) (any, error) {
	d, err := s.liveDoc(r)
	if err != nil {
		return nil, err
	}
	tree, err := s.store.Tree(r.Context(), d.BookID)
	if err != nil {
		return nil, err
	}
	v := docView{Doc: d.Meta(), TOC: []render.Heading{}, Children: []*store.TreeNode{}, Images: map[string][2]int{}}
	flat := store.Flatten(tree)
	for i, n := range flat {
		if n.ID != d.ID {
			continue
		}
		v.Children = nonNil(n.Children)
		for j := i - 1; j >= 0 && v.Prev == nil; j-- {
			if flat[j].Kind == "doc" {
				v.Prev = &docLink{ID: flat[j].ID, Title: flat[j].Title}
			}
		}
		for j := i + 1; j < len(flat) && v.Next == nil; j++ {
			if flat[j].Kind == "doc" {
				v.Next = &docLink{ID: flat[j].ID, Title: flat[j].Title}
			}
		}
	}
	if d.Kind == "doc" {
		res := s.rendered(d)
		v.HTML, v.TOC, v.HasMath, v.HasMermaid = res.HTML, nonNil(res.TOC), res.HasMath, res.HasMermaid
		v.Chars = doc.CountChars(doc.PlainText(d.Content))
		if v.Images, err = s.imageSizes(r, d.Content); err != nil {
			return nil, err
		}
	}
	return v, nil
}

type versionInfo struct {
	ID             int64             `json:"id"`
	DocID          int64             `json:"docId"`
	Revision       int64             `json:"revision"`
	Title          string            `json:"title"`
	Reason         string            `json:"reason"`
	CreatedAt      string            `json:"createdAt"`
	Summary        doc.ChangeSummary `json:"summary"`
	MatchesCurrent bool              `json:"matchesCurrent"`
}

func infoOf(v store.Version) versionInfo {
	return versionInfo{ID: v.ID, DocID: v.DocID, Revision: v.Revision, Title: v.Title, Reason: v.Reason, CreatedAt: v.CreatedAt}
}

func summarizeVersion(v store.Version, previous *store.Version, current store.Doc) versionInfo {
	info := infoOf(v)
	info.MatchesCurrent = v.Title == current.Title && doc.SameContent(v.Content, current.Content)
	if previous == nil {
		label := "保留的最早版本"
		if v.Revision == 1 && v.Reason == "create" {
			label = "初始内容"
		}
		info.Summary = doc.ChangeSummary{Labels: []string{label}, Sections: []string{}}
	} else {
		info.Summary = doc.SummarizeChanges(previous.Title, previous.Content, v.Title, v.Content)
	}
	return info
}

func (s *Server) versions(r *http.Request) (any, error) {
	d, err := s.liveDoc(r)
	if err != nil {
		return nil, err
	}
	list, err := s.store.Versions(r.Context(), d.ID)
	if err != nil {
		return nil, err
	}
	out := make([]versionInfo, len(list))
	for i, v := range list {
		var previous *store.Version
		if i+1 < len(list) {
			previous = &list[i+1]
		}
		out[i] = summarizeVersion(v, previous, d)
	}
	var pending *doc.ChangeSummary
	if len(list) > 0 && !out[0].MatchesCurrent {
		summary := doc.SummarizeChanges(list[0].Title, list[0].Content, d.Title, d.Content)
		pending = &summary
	}
	return map[string]any{"doc": d.Meta(), "versions": out, "pending": pending}, nil
}

func (s *Server) versionView(r *http.Request) (any, error) {
	id, err := pathID(r)
	if err != nil {
		return nil, err
	}
	v, err := s.store.GetVersion(r.Context(), id)
	if err != nil {
		return nil, err
	}
	d, err := s.store.GetDoc(r.Context(), v.DocID)
	if err != nil {
		return nil, err
	}
	if d.DeletedAt != "" {
		return nil, store.ErrNotFound
	}
	var previous *versionInfo
	var previousVersion *store.Version
	if p, err := s.store.PreviousVersion(r.Context(), v); err == nil {
		info := infoOf(p)
		previous = &info
		previousVersion = &p
	} else if !errors.Is(err, store.ErrNotFound) {
		return nil, err
	}
	res := render.Render(v.Content, render.Options{BasePath: s.base})
	images, err := s.imageSizes(r, v.Content)
	if err != nil {
		return nil, err
	}
	return map[string]any{"version": summarizeVersion(v, previousVersion, d), "previous": previous, "doc": d.Meta(), "html": res.HTML, "hasMath": res.HasMath, "hasMermaid": res.HasMermaid, "images": images}, nil
}

func (s *Server) trash(r *http.Request) (any, error) {
	items, err := s.store.Trash(r.Context())
	return nonNil(items), err
}

// ---------------------------------------------------------------------------------------------
// Writes

func (s *Server) apiMeta(w http.ResponseWriter, r *http.Request) error {
	stats, err := s.store.Stats(r.Context())
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{"schemaVersion": doc.SchemaVersion, "stats": stats, "features": []string{"drawing-v1"}, "drawingTool": map[string]any{"module": s.entries["drawing-tool"].JS, "css": s.entries["drawing-tool"].CSS}})
	return nil
}

type bookInput struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	GroupID     string `json:"groupId"`
}

func (s *Server) apiCreateBook(w http.ResponseWriter, r *http.Request) error {
	var in bookInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	b, err := s.store.CreateBook(r.Context(), in.Name, in.Description, in.GroupID)
	if in.GroupID != "" && errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found", "message": "目标分组已不存在，请刷新后重试"})
		return nil
	}
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
	var in store.BookPatch
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	b, err := s.store.UpdateBook(r.Context(), id, in)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, b)
	return nil
}

func (s *Server) apiReorderBooks(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		IDs []int64 `json:"ids"`
	}
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	if err := s.store.ReorderBooks(r.Context(), in.IDs); errors.Is(err, store.ErrInvalid) {
		return badRequest("知识库列表已变化，请刷新后再排序")
	} else if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
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

type saveDocInput struct {
	Title           string          `json:"title"`
	Content         json.RawMessage `json:"content"`
	BaseRevision    int64           `json:"baseRevision"`
	SessionRevision int64           `json:"sessionRevision"`
}

func (s *Server) apiSaveDoc(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	current, err := s.store.GetDoc(r.Context(), id)
	if err != nil {
		return err
	}
	if err := requireDrawingClient(r, current.Content); err != nil {
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
	revision, updated, err := s.store.SaveEditingDoc(r.Context(), id, in.Title, content, in.BaseRevision, in.SessionRevision)
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

// apiDiscardEdits undoes an editing session when the editor's 取消 is confirmed
// (store.DiscardEdits); the editor sends back what it opened.
func (s *Server) apiDiscardEdits(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	current, err := s.store.GetDoc(r.Context(), id)
	if err != nil {
		return err
	}
	if err := requireDrawingClient(r, current.Content); err != nil {
		return err
	}
	var in struct {
		Title        string          `json:"title"`
		Content      json.RawMessage `json:"content"`
		UpdatedAt    string          `json:"updatedAt"`
		Since        int64           `json:"since"`
		BaseRevision int64           `json:"baseRevision"`
	}
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	content, err := doc.Parse(in.Content)
	if err != nil {
		return badRequest("%v", err)
	}
	revision, err := s.store.DiscardEdits(r.Context(), id, in.Title, content, in.UpdatedAt, in.Since, in.BaseRevision)
	if errors.Is(err, store.ErrConflict) {
		return conflictError{revision: revision}
	}
	if errors.Is(err, store.ErrInvalid) {
		return badRequest("无效的更新时间或版本号")
	}
	if err != nil {
		return err
	}
	s.forget(id)
	writeJSON(w, http.StatusOK, map[string]any{"revision": revision})
	return nil
}

func (s *Server) apiRenameDoc(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	var in struct {
		Title string `json:"title"`
	}
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	revision, err := s.store.RenameDoc(r.Context(), id, in.Title)
	if errors.Is(err, store.ErrInvalid) {
		return badRequest("标题不能为空")
	}
	if err != nil {
		return err
	}
	s.forget(id)
	writeJSON(w, http.StatusOK, map[string]any{"revision": revision})
	return nil
}

func (s *Server) apiMoveDoc(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	var in struct {
		BookID   int64  `json:"bookId"`
		ParentID *int64 `json:"parentId"`
		Index    int    `json:"index"`
	}
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	if err := s.store.MoveDoc(r.Context(), id, in.BookID, in.ParentID, in.Index); errors.Is(err, store.ErrInvalid) {
		return badRequest("不能移动到这里：目标不存在，或者在它自己的子文档下")
	} else if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
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

func (s *Server) apiEmptyTrash(w http.ResponseWriter, r *http.Request) error {
	if err := s.store.EmptyTrash(r.Context()); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Server) apiPurgeDoc(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	if err := s.store.PurgeDoc(r.Context(), id); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Server) apiPurgeBook(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	if err := s.store.PurgeBook(r.Context(), id); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// nonNil keeps empty lists as [] rather than null in JSON.
func nonNil[T any](v []T) []T {
	if v == nil {
		return []T{}
	}
	return v
}
