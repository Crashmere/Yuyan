package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/Crashmere/Yuyan/internal/doc"
)

// Snapshots are taken at most this often during continuous editing.
const autosaveSnapshotInterval = 10 * time.Minute

type Doc struct {
	ID        int64           `json:"id"`
	BookID    int64           `json:"bookId"`
	ParentID  *int64          `json:"parentId"`
	Kind      string          `json:"kind"`
	Title     string          `json:"title"`
	Content   doc.Node        `json:"content"`
	Revision  int64           `json:"revision"`
	CreatedAt string          `json:"createdAt"`
	UpdatedAt string          `json:"updatedAt"`
	DeletedAt string          `json:"deletedAt,omitempty"`
	BookName  string          `json:"bookName,omitempty"`
}

type TreeNode struct {
	ID       int64       `json:"id"`
	ParentID *int64      `json:"parentId"`
	Kind     string      `json:"kind"`
	Title    string      `json:"title"`
	Children []*TreeNode `json:"children,omitempty"`
}

type CreateDocInput struct {
	BookID     int64     `json:"bookId"`
	ParentID   *int64    `json:"parentId"`
	Kind       string    `json:"kind"`
	Title      string    `json:"title"`
	Content    *doc.Node `json:"content"`
	SourcePath string    `json:"sourcePath"`
}

func (s *Store) CreateDoc(ctx context.Context, in CreateDocInput) (Doc, error) {
	in.Title = strings.TrimSpace(in.Title)
	if in.Kind == "" {
		in.Kind = "doc"
	}
	if in.Kind != "doc" && in.Kind != "group" {
		return Doc{}, ErrInvalid
	}
	if in.Title == "" {
		in.Title = "无标题文档"
	}
	content := doc.Empty()
	if in.Content != nil {
		content = *in.Content
	}
	data, err := content.Marshal()
	if err != nil {
		return Doc{}, err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Doc{}, err
	}
	defer tx.Rollback()
	if err := checkBookAlive(ctx, tx, in.BookID); err != nil {
		return Doc{}, err
	}
	if in.ParentID != nil {
		var book int64
		err := tx.QueryRowContext(ctx, `SELECT book_id FROM docs WHERE id = ? AND deleted_at IS NULL`, *in.ParentID).Scan(&book)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && book != in.BookID) {
			return Doc{}, ErrInvalid
		}
		if err != nil {
			return Doc{}, err
		}
	}
	now := s.stamp()
	var source any
	if in.SourcePath != "" {
		source = in.SourcePath
	}
	res, err := tx.ExecContext(ctx, `
INSERT INTO docs(book_id, parent_id, position, kind, title, content, schema_version, plain_text, source_path, created_at, updated_at)
VALUES (?, ?, (SELECT coalesce(max(position), 0) + 1 FROM docs WHERE book_id = ? AND parent_id IS ?), ?, ?, ?, ?, ?, ?, ?, ?)`,
		in.BookID, in.ParentID, in.BookID, in.ParentID, in.Kind, in.Title, string(data), doc.SchemaVersion,
		doc.PlainText(content), source, now, now)
	if err != nil {
		return Doc{}, err
	}
	id, _ := res.LastInsertId()
	if err := insertVersion(ctx, tx, id, 1, in.Title, string(data), "create", now); err != nil {
		return Doc{}, err
	}
	if err := tx.Commit(); err != nil {
		return Doc{}, err
	}
	return s.GetDoc(ctx, id)
}

func checkBookAlive(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, bookID int64) error {
	var deleted sql.NullString
	err := q.QueryRowContext(ctx, `SELECT deleted_at FROM books WHERE id = ?`, bookID).Scan(&deleted)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && deleted.Valid) {
		return ErrNotFound
	}
	return err
}

func (s *Store) GetDoc(ctx context.Context, id int64) (Doc, error) {
	var d Doc
	var parent sql.NullInt64
	var content string
	var deleted sql.NullString
	err := s.DB.QueryRowContext(ctx, `
SELECT d.id, d.book_id, d.parent_id, d.kind, d.title, d.content, d.revision, d.created_at, d.updated_at, d.deleted_at, b.name
FROM docs d JOIN books b ON b.id = d.book_id WHERE d.id = ?`, id).
		Scan(&d.ID, &d.BookID, &parent, &d.Kind, &d.Title, &content, &d.Revision, &d.CreatedAt, &d.UpdatedAt, &deleted, &d.BookName)
	if errors.Is(err, sql.ErrNoRows) {
		return d, ErrNotFound
	}
	if err != nil {
		return d, err
	}
	if parent.Valid {
		d.ParentID = &parent.Int64
	}
	d.DeletedAt = deleted.String
	d.Content, err = doc.Parse([]byte(content))
	return d, err
}

// SaveDoc replaces title and content when baseRevision matches; otherwise it returns ErrConflict
// together with the current revision so the editor can warn instead of overwriting.
func (s *Store) SaveDoc(ctx context.Context, id int64, title string, content doc.Node, baseRevision int64) (int64, string, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		title = "无标题文档"
	}
	data, err := content.Marshal()
	if err != nil {
		return 0, "", err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, "", err
	}
	defer tx.Rollback()
	var current int64
	var deleted sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT revision, deleted_at FROM docs WHERE id = ?`, id).Scan(&current, &deleted)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && deleted.Valid) {
		return 0, "", ErrNotFound
	}
	if err != nil {
		return 0, "", err
	}
	if current != baseRevision {
		return current, "", ErrConflict
	}
	now := s.stamp()
	next := current + 1
	if _, err := tx.ExecContext(ctx, `
UPDATE docs SET title = ?, content = ?, schema_version = ?, plain_text = ?, revision = ?, updated_at = ? WHERE id = ?`,
		title, string(data), doc.SchemaVersion, doc.PlainText(content), next, now, id); err != nil {
		return 0, "", err
	}
	var last sql.NullString
	if err := tx.QueryRowContext(ctx, `SELECT max(created_at) FROM doc_versions WHERE doc_id = ?`, id).Scan(&last); err != nil {
		return 0, "", err
	}
	if !last.Valid || olderThan(last.String, now, autosaveSnapshotInterval) {
		if err := insertVersion(ctx, tx, id, next, title, string(data), "autosave", now); err != nil {
			return 0, "", err
		}
	}
	return next, now, tx.Commit()
}

func olderThan(stamp, now string, d time.Duration) bool {
	a, err1 := time.Parse(time.RFC3339Nano, stamp)
	b, err2 := time.Parse(time.RFC3339Nano, now)
	return err1 != nil || err2 != nil || b.Sub(a) >= d
}

func insertVersion(ctx context.Context, tx *sql.Tx, docID, revision int64, title, content, reason, now string) error {
	_, err := tx.ExecContext(ctx, `
INSERT INTO doc_versions(doc_id, revision, title, content, schema_version, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		docID, revision, title, content, doc.SchemaVersion, reason, now)
	return err
}

// Tree returns the live document tree of a knowledge base in display order.
func (s *Store) Tree(ctx context.Context, bookID int64) ([]*TreeNode, error) {
	rows, err := s.DB.QueryContext(ctx, `
SELECT id, parent_id, kind, title FROM docs WHERE book_id = ? AND deleted_at IS NULL ORDER BY position, id`, bookID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var all []*TreeNode
	byID := map[int64]*TreeNode{}
	for rows.Next() {
		n := &TreeNode{}
		var parent sql.NullInt64
		if err := rows.Scan(&n.ID, &parent, &n.Kind, &n.Title); err != nil {
			return nil, err
		}
		if parent.Valid {
			n.ParentID = &parent.Int64
		}
		all = append(all, n)
		byID[n.ID] = n
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	var roots []*TreeNode
	for _, n := range all {
		if n.ParentID != nil && byID[*n.ParentID] != nil {
			p := byID[*n.ParentID]
			p.Children = append(p.Children, n)
		} else {
			roots = append(roots, n)
		}
	}
	return roots, nil
}

// Flatten lists tree nodes depth-first, the reading order used for previous/next links.
func Flatten(nodes []*TreeNode) []*TreeNode {
	var out []*TreeNode
	var walk func([]*TreeNode)
	walk = func(ns []*TreeNode) {
		for _, n := range ns {
			out = append(out, n)
			walk(n.Children)
		}
	}
	walk(nodes)
	return out
}

type DocSummary struct {
	ID        int64  `json:"id"`
	BookID    int64  `json:"bookId"`
	BookName  string `json:"bookName"`
	Title     string `json:"title"`
	Kind      string `json:"kind"`
	UpdatedAt string `json:"updatedAt"`
	DeletedAt string `json:"deletedAt,omitempty"`
}

func (s *Store) Recent(ctx context.Context, limit int) ([]DocSummary, error) {
	return s.summaries(ctx, `
SELECT d.id, d.book_id, b.name, d.title, d.kind, d.updated_at, '' FROM docs d JOIN books b ON b.id = d.book_id
WHERE d.deleted_at IS NULL AND b.deleted_at IS NULL AND d.kind = 'doc' ORDER BY d.updated_at DESC, d.id DESC LIMIT ?`, limit)
}

func (s *Store) summaries(ctx context.Context, q string, args ...any) ([]DocSummary, error) {
	rows, err := s.DB.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DocSummary
	for rows.Next() {
		var d DocSummary
		if err := rows.Scan(&d.ID, &d.BookID, &d.BookName, &d.Title, &d.Kind, &d.UpdatedAt, &d.DeletedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// DeleteDoc moves a document and its live descendants to the trash with one shared timestamp.
func (s *Store) DeleteDoc(ctx context.Context, id int64) error {
	res, err := s.DB.ExecContext(ctx, `
WITH RECURSIVE sub(id) AS (
  SELECT id FROM docs WHERE id = ? AND deleted_at IS NULL
  UNION ALL SELECT d.id FROM docs d JOIN sub ON d.parent_id = sub.id WHERE d.deleted_at IS NULL
)
UPDATE docs SET deleted_at = ? WHERE id IN (SELECT id FROM sub)`, id, s.stamp())
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// RestoreDoc brings back everything deleted together with the document. If its parent is still
// in the trash, the document returns to the top level of its knowledge base.
func (s *Store) RestoreDoc(ctx context.Context, id int64) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var deleted sql.NullString
	var parent sql.NullInt64
	var book int64
	err = tx.QueryRowContext(ctx, `SELECT deleted_at, parent_id, book_id FROM docs WHERE id = ?`, id).Scan(&deleted, &parent, &book)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !deleted.Valid) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if err := checkBookAlive(ctx, tx, book); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
WITH RECURSIVE sub(id) AS (
  SELECT id FROM docs WHERE id = ?
  UNION ALL SELECT d.id FROM docs d JOIN sub ON d.parent_id = sub.id WHERE d.deleted_at = ?
)
UPDATE docs SET deleted_at = NULL WHERE id IN (SELECT id FROM sub)`, id, deleted.String); err != nil {
		return err
	}
	if parent.Valid {
		var parentDeleted sql.NullString
		if err := tx.QueryRowContext(ctx, `SELECT deleted_at FROM docs WHERE id = ?`, parent.Int64).Scan(&parentDeleted); err != nil {
			return err
		}
		if parentDeleted.Valid {
			if _, err := tx.ExecContext(ctx, `UPDATE docs SET parent_id = NULL WHERE id = ?`, id); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

type TrashItem struct {
	Kind      string `json:"kind"`
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	BookName  string `json:"bookName"`
	DeletedAt string `json:"deletedAt"`
}

// Trash lists deleted knowledge bases and the documents at the root of each deletion.
func (s *Store) Trash(ctx context.Context) ([]TrashItem, error) {
	rows, err := s.DB.QueryContext(ctx, `
SELECT 'book', id, name, name, deleted_at FROM books WHERE deleted_at IS NOT NULL
UNION ALL
SELECT 'doc', d.id, d.title, b.name, d.deleted_at FROM docs d JOIN books b ON b.id = d.book_id
LEFT JOIN docs p ON p.id = d.parent_id
WHERE d.deleted_at IS NOT NULL AND (p.id IS NULL OR p.deleted_at IS NULL OR p.deleted_at != d.deleted_at)
ORDER BY 5 DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TrashItem
	for rows.Next() {
		var t TrashItem
		if err := rows.Scan(&t.Kind, &t.ID, &t.Title, &t.BookName, &t.DeletedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
