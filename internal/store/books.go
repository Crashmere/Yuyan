package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

type Book struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Position    int    `json:"position"`
	DocCount    int    `json:"docCount"`
	UpdatedAt   string `json:"updatedAt"`
	DeletedAt   string `json:"deletedAt,omitempty"`
}

func (s *Store) ListBooks(ctx context.Context) ([]Book, error) {
	rows, err := s.DB.QueryContext(ctx, `
SELECT b.id, b.name, b.description, b.position, b.updated_at,
       (SELECT count(*) FROM docs d WHERE d.book_id = b.id AND d.deleted_at IS NULL AND d.kind = 'doc')
FROM books b WHERE b.deleted_at IS NULL ORDER BY b.position, b.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Book
	for rows.Next() {
		var b Book
		if err := rows.Scan(&b.ID, &b.Name, &b.Description, &b.Position, &b.UpdatedAt, &b.DocCount); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func (s *Store) GetBook(ctx context.Context, id int64) (Book, error) {
	var b Book
	var deleted sql.NullString
	err := s.DB.QueryRowContext(ctx, `
SELECT id, name, description, position, updated_at, deleted_at,
       (SELECT count(*) FROM docs d WHERE d.book_id = books.id AND d.deleted_at IS NULL AND d.kind = 'doc')
FROM books WHERE id = ?`, id).
		Scan(&b.ID, &b.Name, &b.Description, &b.Position, &b.UpdatedAt, &deleted, &b.DocCount)
	if errors.Is(err, sql.ErrNoRows) {
		return b, ErrNotFound
	}
	b.DeletedAt = deleted.String
	return b, err
}

// CreateBook appends a knowledge base and, when requested, its group membership atomically.
func (s *Store) CreateBook(ctx context.Context, name, description, groupID string) (Book, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Book{}, ErrInvalid
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Book{}, err
	}
	defer tx.Rollback()
	var groups BookGroups
	groupIndex := -1
	if groupID != "" {
		groups, err = readBookGroups(ctx, tx)
		if err != nil {
			return Book{}, err
		}
		for i, group := range groups.Groups {
			if group.ID == groupID {
				groupIndex = i
				break
			}
		}
		if groupIndex < 0 {
			return Book{}, ErrNotFound
		}
	}
	now := s.stamp()
	res, err := tx.ExecContext(ctx, `
INSERT INTO books(name, description, position, created_at, updated_at)
VALUES (?, ?, (SELECT coalesce(max(position), 0) + 1 FROM books), ?, ?)`, name, description, now, now)
	if err != nil {
		return Book{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Book{}, err
	}
	if groupIndex >= 0 {
		groups.Groups[groupIndex].BookIDs = append(groups.Groups[groupIndex].BookIDs, id)
		groups.Revision++
		if err := writeBookGroups(ctx, tx, groups); err != nil {
			return Book{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Book{}, err
	}
	return s.GetBook(ctx, id)
}

// BookPatch changes only the fields that are set.
type BookPatch struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
}

func (s *Store) UpdateBook(ctx context.Context, id int64, p BookPatch) (Book, error) {
	b, err := s.GetBook(ctx, id)
	if err != nil {
		return Book{}, err
	}
	if b.DeletedAt != "" {
		return Book{}, ErrNotFound
	}
	if p.Name != nil {
		b.Name = strings.TrimSpace(*p.Name)
	}
	if p.Description != nil {
		b.Description = strings.TrimSpace(*p.Description)
	}
	if b.Name == "" {
		return Book{}, ErrInvalid
	}
	if _, err := s.DB.ExecContext(ctx, `UPDATE books SET name = ?, description = ?, updated_at = ? WHERE id = ?`,
		b.Name, b.Description, s.stamp(), id); err != nil {
		return Book{}, err
	}
	return s.GetBook(ctx, id)
}

// ReorderBooks sets the display order. ids must list every live knowledge base exactly once, so
// a list built from a stale page is rejected instead of silently dropping new entries.
func (s *Store) ReorderBooks(ctx context.Context, ids []int64) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := reorderBooks(ctx, tx, ids); err != nil {
		return err
	}
	return tx.Commit()
}

// Shared with grouped moves so membership and position commit together.
func reorderBooks(ctx context.Context, tx *sql.Tx, ids []int64) error {
	var live int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM books WHERE deleted_at IS NULL`).Scan(&live); err != nil {
		return err
	}
	seen := map[int64]bool{}
	for i, id := range ids {
		if seen[id] {
			return ErrInvalid
		}
		seen[id] = true
		res, err := tx.ExecContext(ctx, `UPDATE books SET position = ? WHERE id = ? AND deleted_at IS NULL`, i+1, id)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrInvalid
		}
	}
	if len(ids) != live {
		return ErrInvalid
	}
	return nil
}

// DeleteBook moves a knowledge base to the trash; its documents stay intact and return with it.
func (s *Store) DeleteBook(ctx context.Context, id int64) error {
	res, err := s.DB.ExecContext(ctx, `UPDATE books SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`, s.stamp(), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) RestoreBook(ctx context.Context, id int64) error {
	res, err := s.DB.ExecContext(ctx, `UPDATE books SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
