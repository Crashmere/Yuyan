package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/Crashmere/Yuyan/internal/doc"
)

var ErrVersionNotFound = fmt.Errorf("%w: 历史版本已过期或不存在", ErrNotFound)

type Version struct {
	ID        int64    `json:"id"`
	DocID     int64    `json:"docId"`
	Revision  int64    `json:"revision"`
	Title     string   `json:"title"`
	Reason    string   `json:"reason"`
	CreatedAt string   `json:"createdAt"`
	Content   doc.Node `json:"content,omitempty"`
}

func (s *Store) Versions(ctx context.Context, docID int64) ([]Version, error) {
	rows, err := s.DB.QueryContext(ctx, `
SELECT id, doc_id, revision, title, reason, created_at, content FROM doc_versions WHERE doc_id = ? ORDER BY id DESC`, docID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Version
	for rows.Next() {
		var v Version
		var content string
		if err := rows.Scan(&v.ID, &v.DocID, &v.Revision, &v.Title, &v.Reason, &v.CreatedAt, &content); err != nil {
			return nil, err
		}
		v.Content, err = doc.Parse([]byte(content))
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func (s *Store) GetVersion(ctx context.Context, id int64) (Version, error) {
	return getVersion(ctx, s.DB, id)
}

func getVersion(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, id int64) (Version, error) {
	var v Version
	var content string
	err := q.QueryRowContext(ctx, `
SELECT id, doc_id, revision, title, reason, created_at, content FROM doc_versions WHERE id = ?`, id).
		Scan(&v.ID, &v.DocID, &v.Revision, &v.Title, &v.Reason, &v.CreatedAt, &content)
	if errors.Is(err, sql.ErrNoRows) {
		return v, ErrVersionNotFound
	}
	if err != nil {
		return v, err
	}
	v.Content, err = doc.Parse([]byte(content))
	return v, err
}

// PreviousVersion is the snapshot recorded just before v, or ErrNotFound when v is the oldest.
func (s *Store) PreviousVersion(ctx context.Context, v Version) (Version, error) {
	var p Version
	var content string
	err := s.DB.QueryRowContext(ctx, `
SELECT id, doc_id, revision, title, reason, created_at, content FROM doc_versions WHERE doc_id = ? AND id < ? ORDER BY id DESC LIMIT 1`, v.DocID, v.ID).
		Scan(&p.ID, &p.DocID, &p.Revision, &p.Title, &p.Reason, &p.CreatedAt, &content)
	if errors.Is(err, sql.ErrNoRows) {
		return p, ErrNotFound
	}
	if err == nil {
		p.Content, err = doc.Parse([]byte(content))
	}
	return p, err
}

// Snapshot records the current state at the end of an editing session unless it is already
// the newest version.
func (s *Store) Snapshot(ctx context.Context, docID int64) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var title, content string
	var revision int64
	err = tx.QueryRowContext(ctx, `SELECT title, content, revision FROM docs WHERE id = ? AND deleted_at IS NULL`, docID).Scan(&title, &content, &revision)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	var lastRevision sql.NullInt64
	if err := tx.QueryRowContext(ctx, `SELECT revision FROM doc_versions WHERE doc_id = ? ORDER BY id DESC LIMIT 1`, docID).Scan(&lastRevision); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if lastRevision.Valid && lastRevision.Int64 == revision {
		return nil
	}
	if err := insertVersion(ctx, tx, docID, revision, title, content, "session", s.stamp()); err != nil {
		return err
	}
	return tx.Commit()
}

// RestoreVersion keeps the current state as a version first, then makes the chosen version current.
func (s *Store) RestoreVersion(ctx context.Context, versionID, baseRevision int64) (int64, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	v, err := getVersion(ctx, tx, versionID)
	if err != nil {
		return 0, err
	}
	var current, bookID int64
	var title, content string
	var deleted sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT revision, book_id, title, content, deleted_at FROM docs WHERE id = ?`, v.DocID).Scan(&current, &bookID, &title, &content, &deleted)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && deleted.Valid) {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, err
	}
	if current != baseRevision {
		return current, ErrConflict
	}
	if err := checkBookAlive(ctx, tx, bookID); err != nil {
		return 0, err
	}
	if err := retainContentAssets(ctx, tx, v.Content); err != nil {
		return 0, err
	}
	now, next := s.stamp(), current+1
	// Capture a fresh rollback point in the same transaction as the restore. An
	// existing snapshot of this revision may itself be about to expire.
	if err := insertVersion(ctx, tx, v.DocID, current, title, content, "before-restore", now); err != nil {
		return 0, err
	}
	data, err := v.Content.Marshal()
	if err != nil {
		return 0, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE docs SET title = ?, content = ?, schema_version = ?, plain_text = ?, revision = ?, updated_at = ? WHERE id = ?`, v.Title, string(data), doc.SchemaVersion, doc.PlainText(v.Content), next, now, v.DocID); err != nil {
		return 0, err
	}
	if err := insertVersion(ctx, tx, v.DocID, next, v.Title, string(data), "restore", now); err != nil {
		return 0, err
	}
	return next, tx.Commit()
}
