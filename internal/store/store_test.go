package store

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Crashmere/Yuyan/internal/doc"
)

func newStore(t *testing.T) *Store {
	t.Helper()
	dir := t.TempDir()
	if err := Init(dir); err != nil {
		t.Fatal(err)
	}
	if err := Init(dir); err == nil {
		t.Fatal("Init must refuse an existing database")
	}
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func paragraph(text string) doc.Node {
	return doc.Node{Type: "doc", Content: []doc.Node{{Type: "paragraph", Content: []doc.Node{{Type: "text", Text: text}}}}}
}

func TestOpenRequiresInit(t *testing.T) {
	if _, err := Open(t.TempDir()); err == nil {
		t.Fatal("Open must not create a database implicitly")
	}
}

func TestSaveDetectsConflicts(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	b, err := s.CreateBook(ctx, "算法课", "")
	if err != nil {
		t.Fatal(err)
	}
	d, err := s.CreateDoc(ctx, CreateDocInput{BookID: b.ID, Title: "最短路"})
	if err != nil {
		t.Fatal(err)
	}
	rev, _, err := s.SaveDoc(ctx, d.ID, "最短路", paragraph("第一版"), d.Revision)
	if err != nil || rev != d.Revision+1 {
		t.Fatalf("save: rev=%d err=%v", rev, err)
	}
	current, _, err := s.SaveDoc(ctx, d.ID, "最短路", paragraph("旧标签页"), d.Revision)
	if !errors.Is(err, ErrConflict) || current != rev {
		t.Fatalf("stale save must conflict, got rev=%d err=%v", current, err)
	}
	got, _ := s.GetDoc(ctx, d.ID)
	if doc.PlainText(got.Content) != "第一版" {
		t.Fatalf("stale save overwrote content: %q", doc.PlainText(got.Content))
	}
}

func TestVersionsAndRestore(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	clock := time.Date(2026, 9, 26, 8, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return clock }
	b, _ := s.CreateBook(ctx, "读书笔记", "")
	d, _ := s.CreateDoc(ctx, CreateDocInput{BookID: b.ID, Title: "条款 1"})
	clock = clock.Add(11 * time.Minute)
	rev, _, _ := s.SaveDoc(ctx, d.ID, "条款 1", paragraph("A"), d.Revision) // older than 10 min: autosave
	clock = clock.Add(time.Minute)
	rev, _, _ = s.SaveDoc(ctx, d.ID, "条款 1", paragraph("B"), rev) // within 10 min: no snapshot
	if err := s.Snapshot(ctx, d.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.Snapshot(ctx, d.ID); err != nil { // unchanged: no duplicate
		t.Fatal(err)
	}
	versions, _ := s.Versions(ctx, d.ID)
	if len(versions) != 3 { // session "B", autosave "A", create
		t.Fatalf("versions = %d, want 3", len(versions))
	}
	first := versions[1] // autosave with "A"
	next, err := s.RestoreVersion(ctx, first.ID, rev)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := s.GetDoc(ctx, d.ID)
	if doc.PlainText(got.Content) != "A" || got.Revision != next {
		t.Fatalf("restore: text=%q rev=%d", doc.PlainText(got.Content), got.Revision)
	}
	after, _ := s.Versions(ctx, d.ID)
	if after[0].Reason != "restore" {
		t.Fatalf("newest version reason = %s", after[0].Reason)
	}
}

func TestDiscardEditsLeavesNoTrace(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	clock := time.Date(2026, 9, 27, 8, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return clock }
	b, _ := s.CreateBook(ctx, "读书笔记", "")
	d, _ := s.CreateDoc(ctx, CreateDocInput{BookID: b.ID, Title: "条款 1"})
	clock = clock.Add(11 * time.Minute)
	_, _, _ = s.SaveDoc(ctx, d.ID, "条款 1", paragraph("原文"), d.Revision)
	opened, _ := s.GetDoc(ctx, d.ID) // the editor opens here
	before, _ := s.Versions(ctx, d.ID)
	clock = clock.Add(11 * time.Minute)
	rev, _, _ := s.SaveDoc(ctx, d.ID, "新标题", paragraph("改动"), opened.Revision) // records an autosave version
	if err := s.Snapshot(ctx, d.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DiscardEdits(ctx, d.ID, opened.Title, opened.Content, opened.UpdatedAt, opened.Revision, rev-1); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale base revision: err = %v, want conflict", err)
	}
	next, err := s.DiscardEdits(ctx, d.ID, opened.Title, opened.Content, opened.UpdatedAt, opened.Revision, rev)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := s.GetDoc(ctx, d.ID)
	if got.Title != "条款 1" || doc.PlainText(got.Content) != "原文" || got.UpdatedAt != opened.UpdatedAt || got.Revision != next || next <= rev {
		t.Fatalf("after discard: %q %q updated=%s rev=%d next=%d", got.Title, doc.PlainText(got.Content), got.UpdatedAt, got.Revision, next)
	}
	after, _ := s.Versions(ctx, d.ID)
	if len(after) != len(before) {
		t.Fatalf("versions = %d, want %d as before the session", len(after), len(before))
	}
}

func TestTrashRestoresSubtree(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	b, _ := s.CreateBook(ctx, "JUC", "")
	parent, _ := s.CreateDoc(ctx, CreateDocInput{BookID: b.ID, Kind: "group", Title: "线程池"})
	child, _ := s.CreateDoc(ctx, CreateDocInput{BookID: b.ID, ParentID: &parent.ID, Title: "ThreadPoolExecutor"})
	if err := s.DeleteDoc(ctx, parent.ID); err != nil {
		t.Fatal(err)
	}
	tree, _ := s.Tree(ctx, b.ID)
	if len(tree) != 0 {
		t.Fatalf("deleted subtree still visible: %d roots", len(tree))
	}
	trash, _ := s.Trash(ctx)
	if len(trash) != 1 || trash[0].ID != parent.ID {
		t.Fatalf("trash should list only the deletion root, got %+v", trash)
	}
	if err := s.RestoreDoc(ctx, parent.ID); err != nil {
		t.Fatal(err)
	}
	tree, _ = s.Tree(ctx, b.ID)
	if len(tree) != 1 || len(tree[0].Children) != 1 || tree[0].Children[0].ID != child.ID {
		t.Fatalf("subtree not restored: %+v", tree)
	}
}

func TestAssetsAreContentAddressed(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	img := image.NewRGBA(image.Rect(0, 0, 3, 2))
	img.Set(0, 0, color.RGBA{R: 255, A: 255})
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	a, err := s.PutAsset(ctx, buf.Bytes(), "img-001.png")
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.PutAsset(ctx, buf.Bytes(), "copy.png")
	if err != nil {
		t.Fatal(err)
	}
	if a.ID != b.ID || len(a.ID) != 32 || a.Ext != "png" || a.Width != 3 || a.Height != 2 {
		t.Fatalf("unexpected assets %+v %+v", a, b)
	}
	if _, err := s.PutAsset(ctx, []byte("<svg></svg>"), "x.svg"); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("svg must be rejected, got %v", err)
	}
	if err := s.Check(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestSearchMatchesChineseSubstrings(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	b, _ := s.CreateBook(ctx, "MySQL", "")
	c := paragraph("InnoDB 的聚簇索引按主键组织数据")
	d, _ := s.CreateDoc(ctx, CreateDocInput{BookID: b.ID, Title: "索引", Content: &c})
	hits, err := s.Search(ctx, "聚簇", 10)
	if err != nil || len(hits) != 1 || hits[0].ID != d.ID {
		t.Fatalf("hits=%+v err=%v", hits, err)
	}
	if hits, _ := s.Search(ctx, "innodb", 10); len(hits) != 1 {
		t.Fatal("search must ignore ASCII case")
	}
}

func TestBackupVerifyRestoreAndPrune(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	b, _ := s.CreateBook(ctx, "算法课", "")
	d, _ := s.CreateDoc(ctx, CreateDocInput{BookID: b.ID, Title: "最短路"})
	if _, _, err := s.SaveDoc(ctx, d.ID, "最短路", paragraph("备份内容"), d.Revision); err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	a, err := s.PutAsset(ctx, buf.Bytes(), "a.png")
	if err != nil {
		t.Fatal(err)
	}

	backups := t.TempDir()
	out := filepath.Join(backups, "daily-20260926T000000Z")
	if err := s.Backup(ctx, out); err != nil {
		t.Fatal(err)
	}
	if err := s.Backup(ctx, out); err == nil {
		t.Fatal("Backup must refuse an existing directory")
	}
	m, err := VerifyBackup(out)
	if err != nil || len(m.Files) != 2 {
		t.Fatalf("verify: %d files, %v", len(m.Files), err)
	}

	restored := filepath.Join(t.TempDir(), "restored")
	if err := Restore(ctx, out, restored); err != nil {
		t.Fatal(err)
	}
	r, err := Open(restored)
	if err != nil {
		t.Fatal(err)
	}
	got, err := r.GetDoc(ctx, d.ID)
	r.Close()
	if err != nil || doc.PlainText(got.Content) != "备份内容" {
		t.Fatalf("restored doc: %v", err)
	}
	if err := Restore(ctx, out, restored); err == nil {
		t.Fatal("Restore must refuse an existing directory")
	}

	// A changed image makes the backup unusable instead of restoring silently. The backup file is
	// a hard link, so it is replaced by rename rather than written, leaving the live image intact.
	changed := filepath.Join(out, "assets", a.ID+".png")
	if err := os.WriteFile(changed+".tmp", []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(changed+".tmp", changed); err != nil {
		t.Fatal(err)
	}
	if err := s.Check(ctx); err != nil {
		t.Fatalf("live store must be unaffected: %v", err)
	}
	if _, err := VerifyBackup(out); err == nil {
		t.Fatal("VerifyBackup must detect a changed image")
	}

	for _, name := range []string{"daily-20260920T000000Z", "daily-20260921T000000Z", "daily-20260922T000000Z"} {
		if err := os.MkdirAll(filepath.Join(backups, name), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(backups, name, manifestFile), []byte("{}"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := PruneBackups(backups, 2); err != nil {
		t.Fatal(err)
	}
	left, _ := os.ReadDir(backups)
	if len(left) != 2 || left[0].Name() != "daily-20260922T000000Z" || left[1].Name() != "daily-20260926T000000Z" {
		t.Fatalf("prune kept %v", left)
	}
}

func titles(nodes []*TreeNode) []string {
	var out []string
	for _, n := range nodes {
		out = append(out, n.Title)
	}
	return out
}

func TestMoveDoc(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	b, _ := s.CreateBook(ctx, "设计模式", "")
	other, _ := s.CreateBook(ctx, "杂项", "")
	group, _ := s.CreateDoc(ctx, CreateDocInput{BookID: b.ID, Kind: "group", Title: "创建型模式"})
	single, _ := s.CreateDoc(ctx, CreateDocInput{BookID: b.ID, ParentID: &group.ID, Title: "单例"})
	overview, _ := s.CreateDoc(ctx, CreateDocInput{BookID: b.ID, Title: "创建型模式"})
	last, _ := s.CreateDoc(ctx, CreateDocInput{BookID: b.ID, Title: "附录"})
	trashed, _ := s.CreateDoc(ctx, CreateDocInput{BookID: b.ID, ParentID: &overview.ID, Title: "已删除"})
	if err := s.DeleteDoc(ctx, trashed.ID); err != nil {
		t.Fatal(err)
	}

	// Reorder among siblings: the index counts siblings without the moved document.
	if err := s.MoveDoc(ctx, last.ID, b.ID, nil, 0); err != nil {
		t.Fatal(err)
	}
	tree, _ := s.Tree(ctx, b.ID)
	if got := titles(tree); len(got) != 3 || got[0] != "附录" || got[1] != "创建型模式" {
		t.Fatalf("order after reorder: %v", got)
	}

	// Merge a folder note: the child moves under the document of the same name.
	if err := s.MoveDoc(ctx, single.ID, b.ID, &overview.ID, 99); err != nil {
		t.Fatal(err)
	}
	tree, _ = s.Tree(ctx, b.ID)
	if len(tree[2].Children) != 1 || tree[2].Children[0].ID != single.ID || tree[1].Children != nil {
		t.Fatalf("child not moved under the overview: %+v", tree)
	}

	// Not into itself or its own subtree, and not under a parent in another book.
	for _, bad := range []*int64{&overview.ID, &single.ID} {
		if err := s.MoveDoc(ctx, overview.ID, b.ID, bad, 0); !errors.Is(err, ErrInvalid) {
			t.Fatalf("move into own subtree: %v", err)
		}
	}
	if err := s.MoveDoc(ctx, single.ID, other.ID, &group.ID, 0); !errors.Is(err, ErrInvalid) {
		t.Fatalf("parent from another book: %v", err)
	}

	// Across books the subtree follows, including children in the trash.
	if err := s.MoveDoc(ctx, overview.ID, other.ID, nil, 0); err != nil {
		t.Fatal(err)
	}
	moved, _ := s.Tree(ctx, other.ID)
	if len(moved) != 1 || len(moved[0].Children) != 1 {
		t.Fatalf("subtree not moved: %+v", moved)
	}
	if err := s.RestoreDoc(ctx, trashed.ID); err != nil {
		t.Fatal(err)
	}
	restored, _ := s.GetDoc(ctx, trashed.ID)
	if restored.BookID != other.ID {
		t.Fatalf("trashed child stayed in book %d", restored.BookID)
	}
}

func TestRenameAdvancesRevision(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	b, _ := s.CreateBook(ctx, "JUC", "")
	d, _ := s.CreateDoc(ctx, CreateDocInput{BookID: b.ID, Title: "线程池"})
	rev, err := s.RenameDoc(ctx, d.ID, "  线程池原理 ")
	if err != nil || rev != d.Revision+1 {
		t.Fatalf("rename: rev=%d err=%v", rev, err)
	}
	if _, _, err := s.SaveDoc(ctx, d.ID, "线程池", paragraph("旧标签页"), d.Revision); !errors.Is(err, ErrConflict) {
		t.Fatalf("editor with the old revision must conflict: %v", err)
	}
	if got, _ := s.GetDoc(ctx, d.ID); got.Title != "线程池原理" {
		t.Fatalf("title = %q", got.Title)
	}
	if _, err := s.RenameDoc(ctx, d.ID, " "); !errors.Is(err, ErrInvalid) {
		t.Fatalf("empty title: %v", err)
	}
}

func TestPurge(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	clock := time.Date(2026, 9, 26, 8, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return clock }
	b, _ := s.CreateBook(ctx, "CentOS", "")
	parent, _ := s.CreateDoc(ctx, CreateDocInput{BookID: b.ID, Title: "服务管理"})
	child, _ := s.CreateDoc(ctx, CreateDocInput{BookID: b.ID, ParentID: &parent.ID, Title: "systemd"})
	earlier, _ := s.CreateDoc(ctx, CreateDocInput{BookID: b.ID, ParentID: &parent.ID, Title: "SysV"})
	if err := s.DeleteDoc(ctx, earlier.ID); err != nil {
		t.Fatal(err)
	}
	clock = clock.Add(time.Minute)
	if err := s.DeleteDoc(ctx, parent.ID); err != nil {
		t.Fatal(err)
	}
	live, _ := s.CreateDoc(ctx, CreateDocInput{BookID: b.ID, Title: "防火墙"})
	if err := s.PurgeDoc(ctx, live.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("a live document must not be purged: %v", err)
	}
	if err := s.PurgeDoc(ctx, parent.ID); err != nil {
		t.Fatal(err)
	}
	for _, id := range []int64{parent.ID, child.ID} {
		if _, err := s.GetDoc(ctx, id); !errors.Is(err, ErrNotFound) {
			t.Fatalf("doc %d survived: %v", id, err)
		}
	}
	// Trashed separately earlier: still in the trash, now without a parent.
	if err := s.RestoreDoc(ctx, earlier.ID); err != nil {
		t.Fatal(err)
	}
	if tree, _ := s.Tree(ctx, b.ID); len(tree) != 2 || (tree[0].ID != earlier.ID && tree[1].ID != earlier.ID) {
		t.Fatalf("separately trashed child should be back at the top level: %v", titles(tree))
	}

	gone, _ := s.CreateBook(ctx, "旧知识库", "")
	d, _ := s.CreateDoc(ctx, CreateDocInput{BookID: gone.ID, Title: "笔记"})
	if err := s.DeleteBook(ctx, gone.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteDoc(ctx, earlier.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.EmptyTrash(ctx); err != nil {
		t.Fatal(err)
	}
	if trash, _ := s.Trash(ctx); len(trash) != 0 {
		t.Fatalf("trash not empty: %+v", trash)
	}
	if _, err := s.GetDoc(ctx, d.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("doc of purged book survived: %v", err)
	}
	if err := s.Check(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestBooksReorderAndPartialUpdate(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	a, _ := s.CreateBook(ctx, "A", "第一个")
	b, _ := s.CreateBook(ctx, "B", "")
	if err := s.ReorderBooks(ctx, []int64{b.ID, a.ID}); err != nil {
		t.Fatal(err)
	}
	if list, _ := s.ListBooks(ctx); list[0].ID != b.ID {
		t.Fatalf("order: %+v", list)
	}
	if err := s.ReorderBooks(ctx, []int64{b.ID}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("incomplete order must be rejected: %v", err)
	}
	name := "A2"
	got, err := s.UpdateBook(ctx, a.ID, BookPatch{Name: &name})
	if err != nil || got.Name != "A2" || got.Description != "第一个" {
		t.Fatalf("rename kept description? %+v %v", got, err)
	}
}
