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
