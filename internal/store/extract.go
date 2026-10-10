package store

import (
	"context"
	"database/sql"
	"errors"
	"slices"
)

type ExtractGroupInput struct {
	DissolveGroupInput
	Title string `json:"title"`
}

type ExtractGroupResult struct {
	Book       Book       `json:"book"`
	BookGroups BookGroups `json:"bookGroups"`
}

// ExtractGroup turns one directory level into a knowledge base. Its children become roots;
// all descendants, including trash, keep their identity, contents, history and inner hierarchy.
func (s *Store) ExtractGroup(ctx context.Context, id int64, in ExtractGroupInput) (ExtractGroupResult, error) {
	result := ExtractGroupResult{}
	if in.BookID <= 0 || in.Title == "" || in.ChildIDs == nil || (in.ParentID != nil && *in.ParentID <= 0) {
		return result, ErrInvalid
	}
	seen := map[int64]bool{}
	for _, childID := range in.ChildIDs {
		if childID <= 0 || seen[childID] {
			return result, ErrInvalid
		}
		seen[childID] = true
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	var bookID int64
	var parent sql.NullInt64
	var kind, title string
	var deleted sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT book_id, parent_id, kind, title, deleted_at FROM docs WHERE id = ?`, id).
		Scan(&bookID, &parent, &kind, &title, &deleted)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && deleted.Valid) {
		return result, ErrNotFound
	}
	if err != nil {
		return result, err
	}
	if kind != "group" {
		return result, ErrInvalid
	}
	if bookID != in.BookID || title != in.Title || parent.Valid != (in.ParentID != nil) || (parent.Valid && parent.Int64 != *in.ParentID) {
		return result, ErrConflict
	}
	if err := checkBookAlive(ctx, tx, bookID); err != nil {
		return result, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT id FROM docs WHERE book_id = ? AND parent_id = ? AND deleted_at IS NULL ORDER BY position, id`, bookID, id)
	if err != nil {
		return result, err
	}
	var children []int64
	for rows.Next() {
		var childID int64
		if err := rows.Scan(&childID); err != nil {
			rows.Close()
			return result, err
		}
		children = append(children, childID)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return result, err
	}
	if !slices.Equal(children, in.ChildIDs) {
		return result, ErrConflict
	}
	groups, err := readBookGroups(ctx, tx)
	if err != nil {
		return result, err
	}
	now := s.stamp()
	book := Book{Name: title, UpdatedAt: now}
	if err := tx.QueryRowContext(ctx, `SELECT coalesce(max(position), 0) + 1 FROM books`).Scan(&book.Position); err != nil {
		return result, err
	}
	res, err := tx.ExecContext(ctx, `INSERT INTO books(name, description, position, created_at, updated_at) VALUES (?, '', ?, ?, ?)`, title, book.Position, now, now)
	if err != nil {
		return result, err
	}
	book.ID, err = res.LastInsertId()
	if err != nil {
		return result, err
	}
	for i := range groups.Groups {
		if slices.Contains(groups.Groups[i].BookIDs, bookID) {
			groups.Groups[i].BookIDs = append(groups.Groups[i].BookIDs, book.ID)
			groups.Revision++
			if err := writeBookGroups(ctx, tx, groups); err != nil {
				return result, err
			}
			break
		}
	}
	if _, err := tx.ExecContext(ctx, `WITH RECURSIVE sub(id) AS (
SELECT id FROM docs WHERE parent_id = ? AND book_id = ?
UNION SELECT d.id FROM docs d JOIN sub ON d.parent_id = sub.id WHERE d.book_id = ?
) UPDATE docs SET book_id = ? WHERE id IN (SELECT id FROM sub)`, id, bookID, bookID, book.ID); err != nil {
		return result, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE docs SET parent_id = NULL WHERE parent_id = ? AND book_id = ?`, id, book.ID); err != nil {
		return result, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE docs SET deleted_at = ? WHERE id = ?`, now, id); err != nil {
		return result, err
	}
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM docs WHERE book_id = ? AND kind = 'doc' AND deleted_at IS NULL`, book.ID).Scan(&book.DocCount); err != nil {
		return result, err
	}
	// Return the transaction's result directly: a read failure after commit must not look like
	// a failed extraction and invite creating another knowledge base.
	result.Book, result.BookGroups = book, groups
	return result, tx.Commit()
}
