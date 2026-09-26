package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	pngenc "image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/Crashmere/Yuyan/internal/doc"
	"github.com/Crashmere/Yuyan/internal/store"
)

func newServer(t *testing.T) (*store.Store, http.Handler) {
	t.Helper()
	dir := t.TempDir()
	if err := store.Init(dir); err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	static := fstest.MapFS{
		"manifest.json":    {Data: []byte(`{"src/app/main.ts":{"file":"assets/app-1.js","name":"app","isEntry":true,"css":["assets/app-1.css"]}}`)},
		"assets/app-1.js":  {Data: []byte("")},
		"assets/app-1.css": {Data: []byte("")},
		"favicon.svg":      {Data: []byte("<svg/>")},
	}
	srv, err := New(st, static, "/yuyan/")
	if err != nil {
		t.Fatal(err)
	}
	return st, srv.Handler(true)
}

func do(t *testing.T, h http.Handler, method, path, body string) (int, string) {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	out, _ := io.ReadAll(rec.Body)
	return rec.Code, string(out)
}

var initialData = regexp.MustCompile(`(?s)<script id="yy-initial" type="application/json">(.*?)</script>`)

func preloadedOf(t *testing.T, page string) map[string]preloaded {
	t.Helper()
	m := initialData.FindStringSubmatch(page)
	if m == nil {
		t.Fatalf("no initial data in page:\n%s", page)
	}
	var out map[string]preloaded
	if err := json.Unmarshal([]byte(m[1]), &out); err != nil {
		t.Fatalf("initial data is not JSON: %v\n%s", err, m[1])
	}
	return out
}

func TestShellPreloadsTheFirstScreen(t *testing.T) {
	ctx := context.Background()
	st, h := newServer(t)
	b, _ := st.CreateBook(ctx, "算法课", "")
	content := doc.Node{Type: "doc", Content: []doc.Node{
		{Type: "heading", Attrs: map[string]any{"level": float64(2)}, Content: []doc.Node{{Type: "text", Text: "Dijkstra"}}},
		{Type: "paragraph", Content: []doc.Node{{Type: "text", Text: "边权 非负"}}},
	}}
	d, _ := st.CreateDoc(ctx, store.CreateDocInput{BookID: b.ID, Title: "最短路</script><b>", Content: &content})

	status, page := do(t, h, "GET", fmt.Sprintf("/yuyan/docs/%d", d.ID), "")
	if status != http.StatusOK {
		t.Fatalf("status %d", status)
	}
	for _, want := range []string{`/yuyan/static/assets/app-1.js`, `/yuyan/static/assets/app-1.css`, `<title>最短路&lt;/script&gt;&lt;b&gt; - 语燕</title>`} {
		if !strings.Contains(page, want) {
			t.Errorf("page lacks %q", want)
		}
	}
	data := preloadedOf(t, page)
	view := data[fmt.Sprintf("docs/%d/view", d.ID)]
	body, _ := json.Marshal(view.Body)
	if view.Status != http.StatusOK || !strings.Contains(string(body), `"chars":12`) || !strings.Contains(string(body), `id=\"dijkstra\"`) {
		t.Fatalf("doc view preload: %d %s", view.Status, body)
	}
	for _, key := range []string{"books", fmt.Sprintf("books/%d/tree", b.ID)} {
		if data[key].Status != http.StatusOK {
			t.Errorf("%s not preloaded: %+v", key, data[key])
		}
	}

	status, page = do(t, h, "GET", fmt.Sprintf("/yuyan/docs/%d/edit", d.ID), "")
	edit := preloadedOf(t, page)[fmt.Sprintf("docs/%d", d.ID)]
	if body, _ := json.Marshal(edit.Body); status != http.StatusOK || edit.Status != http.StatusOK || !strings.Contains(string(body), `"images":{}`) {
		t.Fatalf("edit page preload: %d %d %s", status, edit.Status, body)
	}
}

func TestViewsCarryImageSizes(t *testing.T) {
	ctx := context.Background()
	st, h := newServer(t)
	var png bytes.Buffer
	if err := pngenc.Encode(&png, image.NewRGBA(image.Rect(0, 0, 30, 20))); err != nil {
		t.Fatal(err)
	}
	asset, err := st.PutAsset(ctx, png.Bytes(), "a.png")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := st.CreateBook(ctx, "图集", "")
	content := doc.Node{Type: "doc", Content: []doc.Node{{Type: "paragraph", Content: []doc.Node{
		{Type: "image", Attrs: map[string]any{"src": asset.URL}},
		{Type: "image", Attrs: map[string]any{"src": "https://example.com/b.png"}},
	}}}}
	d, _ := st.CreateDoc(ctx, store.CreateDocInput{BookID: b.ID, Title: "图片", Content: &content})
	if err := st.Snapshot(ctx, d.ID); err != nil {
		t.Fatal(err)
	}
	versions, _ := st.Versions(ctx, d.ID)
	want := fmt.Sprintf(`"images":{"%s":[30,20]}`, asset.ID)
	for _, path := range []string{fmt.Sprintf("/yuyan/api/docs/%d/view", d.ID), fmt.Sprintf("/yuyan/api/docs/%d", d.ID), fmt.Sprintf("/yuyan/api/versions/%d/view", versions[0].ID)} {
		if status, body := do(t, h, "GET", path, ""); status != http.StatusOK || !strings.Contains(body, want) {
			t.Errorf("%s: %d, want %s in\n%s", path, status, want, body)
		}
	}
}

func TestTitlesListDocumentsWithTheirPlace(t *testing.T) {
	ctx := context.Background()
	st, h := newServer(t)
	b, _ := st.CreateBook(ctx, "设计模式", "")
	group, _ := st.CreateDoc(ctx, store.CreateDocInput{BookID: b.ID, Kind: "group", Title: "结构型模式"})
	parent, _ := st.CreateDoc(ctx, store.CreateDocInput{BookID: b.ID, ParentID: &group.ID, Title: "装饰"})
	st.CreateDoc(ctx, store.CreateDocInput{BookID: b.ID, ParentID: &parent.ID, Title: "IO 流"})
	status, body := do(t, h, "GET", "/yuyan/api/titles", "")
	var got []titleEntry
	if err := json.Unmarshal([]byte(body), &got); status != http.StatusOK || err != nil {
		t.Fatalf("titles: %d %v %s", status, err, body)
	}
	want := []titleEntry{
		{ID: parent.ID, Title: "装饰", BookID: b.ID, BookName: "设计模式", Path: []string{"结构型模式"}},
		{ID: parent.ID + 1, Title: "IO 流", BookID: b.ID, BookName: "设计模式", Path: []string{"结构型模式", "装饰"}},
	}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("titles:\n got %+v\nwant %+v", got, want)
	}
}

func TestMissingPagesAndAPIs(t *testing.T) {
	_, h := newServer(t)
	status, page := do(t, h, "GET", "/yuyan/docs/999", "")
	if status != http.StatusNotFound || preloadedOf(t, page)["docs/999/view"].Status != http.StatusNotFound {
		t.Fatalf("missing doc page: %d", status)
	}
	if status, page := do(t, h, "GET", "/yuyan/no/such/page", ""); status != http.StatusNotFound || !strings.Contains(page, `id="app"`) {
		t.Fatalf("unknown page: %d", status)
	}
	if status, body := do(t, h, "GET", "/yuyan/api/no-such-thing", ""); status != http.StatusNotFound || !strings.Contains(body, `"not_found"`) {
		t.Fatalf("unknown API: %d %s", status, body)
	}
}

func TestTreeEditingAPI(t *testing.T) {
	ctx := context.Background()
	st, h := newServer(t)
	b, _ := st.CreateBook(ctx, "设计模式", "简介")
	group, _ := st.CreateDoc(ctx, store.CreateDocInput{BookID: b.ID, Kind: "group", Title: "创建型模式"})
	child, _ := st.CreateDoc(ctx, store.CreateDocInput{BookID: b.ID, ParentID: &group.ID, Title: "单例"})
	overview, _ := st.CreateDoc(ctx, store.CreateDocInput{BookID: b.ID, Title: "创建型模式"})

	if status, body := do(t, h, "POST", fmt.Sprintf("/yuyan/api/docs/%d/move", child.ID),
		fmt.Sprintf(`{"bookId":%d,"parentId":%d,"index":0}`, b.ID, overview.ID)); status != http.StatusNoContent {
		t.Fatalf("move: %d %s", status, body)
	}
	if status, body := do(t, h, "POST", fmt.Sprintf("/yuyan/api/docs/%d/move", overview.ID),
		fmt.Sprintf(`{"bookId":%d,"parentId":%d,"index":0}`, b.ID, child.ID)); status != http.StatusBadRequest || !strings.Contains(body, "不能移动到这里") {
		t.Fatalf("move into own subtree: %d %s", status, body)
	}
	if status, body := do(t, h, "PATCH", fmt.Sprintf("/yuyan/api/docs/%d", overview.ID), `{"title":"创建型模式概述"}`); status != http.StatusOK || !strings.Contains(body, `"revision":2`) {
		t.Fatalf("rename: %d %s", status, body)
	}
	if status, body := do(t, h, "PATCH", fmt.Sprintf("/yuyan/api/books/%d", b.ID), `{"name":"设计模式笔记"}`); status != http.StatusOK || !strings.Contains(body, `"description":"简介"`) {
		t.Fatalf("book rename must keep the description: %d %s", status, body)
	}
	if status, _ := do(t, h, "DELETE", fmt.Sprintf("/yuyan/api/docs/%d", group.ID), ""); status != http.StatusNoContent {
		t.Fatalf("delete: %d", status)
	}
	if status, _ := do(t, h, "DELETE", fmt.Sprintf("/yuyan/api/trash/docs/%d", group.ID), ""); status != http.StatusNoContent {
		t.Fatalf("purge: %d", status)
	}
	if status, body := do(t, h, "GET", "/yuyan/api/trash", ""); status != http.StatusOK || body != "[]\n" {
		t.Fatalf("trash after purge: %d %s", status, body)
	}
}
