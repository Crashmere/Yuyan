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
	err := s.DB.QueryRowContext(ctx, `SELECT id, name, description, position, updated_at, deleted_at FROM books WHERE id = ?`, id).
		Scan(&b.ID, &b.Name, &b.Description, &b.Position, &b.UpdatedAt, &deleted)
	if errors.Is(err, sql.ErrNoRows) {
		return b, ErrNotFound
	}
	b.DeletedAt = deleted.String
	return b, err
}

func (s *Store) CreateBook(ctx context.Context, name, description string) (Book, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Book{}, ErrInvalid
	}
	now := s.stamp()
	res, err := s.DB.ExecContext(ctx, `
INSERT INTO books(name, description, position, created_at, updated_at)
VALUES (?, ?, (SELECT coalesce(max(position), 0) + 1 FROM books), ?, ?)`, name, description, now, now)
	if err != nil {
		return Book{}, err
	}
	id, _ := res.LastInsertId()
	return s.GetBook(ctx, id)
}

func (s *Store) UpdateBook(ctx context.Context, id int64, name, description string) (Book, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Book{}, ErrInvalid
	}
	res, err := s.DB.ExecContext(ctx, `UPDATE books SET name = ?, description = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
		name, description, s.stamp(), id)
	if err != nil {
		return Book{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return Book{}, ErrNotFound
	}
	return s.GetBook(ctx, id)
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
