package store

import (
	"context"
	"slices"

	"github.com/Crashmere/Yuyan/internal/doc"
)

type BookToGroupInput struct {
	Name         string  `json:"name"`
	TargetBookID int64   `json:"targetBookId"`
	RootIDs      []int64 `json:"rootIds"`
}

type BookToGroupResult struct {
	Group DocMeta `json:"group"`
	Book  Book    `json:"book"`
}

// BookToGroup wraps the entire book in a new root group, then trashes the empty
// source book. Existing content, history, order and deletion states stay intact.
func (s *Store) BookToGroup(ctx context.Context, id int64, in BookToGroupInput) (BookToGroupResult, error) {
	result := BookToGroupResult{}
	if in.Name == "" || in.TargetBookID <= 0 || in.TargetBookID == id || in.RootIDs == nil {
		return result, ErrInvalid
	}
	seen := map[int64]bool{}
	for _, rootID := range in.RootIDs {
		if rootID <= 0 || seen[rootID] {
			return result, ErrInvalid
		}
		seen[rootID] = true
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	for _, bookID := range []int64{id, in.TargetBookID} {
		if err := checkBookAlive(ctx, tx, bookID); err != nil {
			return result, err
		}
	}
	var name string
	if err := tx.QueryRowContext(ctx, `SELECT name FROM books WHERE id = ?`, id).Scan(&name); err != nil {
		return result, err
	}
	if name != in.Name {
		return result, ErrConflict
	}
	rows, err := tx.QueryContext(ctx, `SELECT id FROM docs WHERE book_id = ? AND parent_id IS NULL AND deleted_at IS NULL ORDER BY position, id`, id)
	if err != nil {
		return result, err
	}
	var roots []int64
	for rows.Next() {
		var rootID int64
		if err := rows.Scan(&rootID); err != nil {
			rows.Close()
			return result, err
		}
		roots = append(roots, rootID)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return result, err
	}
	if !slices.Equal(roots, in.RootIDs) {
		return result, ErrConflict
	}
	raw, err := doc.Empty().Marshal()
	if err != nil {
		return result, err
	}
	now := s.stamp()
	res, err := tx.ExecContext(ctx, `INSERT INTO docs(book_id, parent_id, position, kind, title, content, schema_version, plain_text, created_at, updated_at)
VALUES (?, NULL, (SELECT coalesce(max(position), 0) + 1 FROM docs WHERE book_id = ? AND parent_id IS NULL), 'group', ?, ?, ?, '', ?, ?)`,
		in.TargetBookID, in.TargetBookID, name, string(raw), doc.SchemaVersion, now, now)
	if err != nil {
		return result, err
	}
	groupID, err := res.LastInsertId()
	if err != nil {
		return result, err
	}
	if err := insertVersion(ctx, tx, groupID, 1, name, string(raw), "create", now); err != nil {
		return result, err
	}
	// Include trash so its later restoration uses the destination hierarchy.
	if _, err := tx.ExecContext(ctx, `UPDATE docs SET book_id = ?, parent_id = coalesce(parent_id, ?) WHERE book_id = ?`, in.TargetBookID, groupID, id); err != nil {
		return result, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE books SET deleted_at = ? WHERE id = ?`, now, id); err != nil {
		return result, err
	}
	book := Book{}
	if err := tx.QueryRowContext(ctx, `SELECT id, name, description, position, updated_at,
(SELECT count(*) FROM docs WHERE book_id = books.id AND kind = 'doc' AND deleted_at IS NULL) FROM books WHERE id = ?`, in.TargetBookID).
		Scan(&book.ID, &book.Name, &book.Description, &book.Position, &book.UpdatedAt, &book.DocCount); err != nil {
		return result, err
	}
	result.Book = book
	result.Group = DocMeta{ID: groupID, BookID: book.ID, Kind: "group", Title: name, Revision: 1, CreatedAt: now, UpdatedAt: now, BookName: book.Name}
	// No fallible reads after commit: a successful conversion must not invite a retry.
	return result, tx.Commit()
}
