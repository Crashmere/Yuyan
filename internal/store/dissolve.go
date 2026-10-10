package store

import (
	"context"
	"database/sql"
	"errors"
	"slices"
)

type DissolveGroupInput struct {
	BookID   int64   `json:"bookId"`
	ParentID *int64  `json:"parentId"`
	ChildIDs []int64 `json:"childIds"`
}

// DissolveGroup replaces a group with its children at the same position. Only the empty
// group goes to trash; child documents keep their IDs, content, revisions and subtrees.
func (s *Store) DissolveGroup(ctx context.Context, id int64, in DissolveGroupInput) error {
	if in.BookID <= 0 || in.ChildIDs == nil {
		return ErrInvalid
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var bookID int64
	var parent sql.NullInt64
	var kind string
	var deleted sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT book_id, parent_id, kind, deleted_at FROM docs WHERE id = ?`, id).
		Scan(&bookID, &parent, &kind, &deleted)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && deleted.Valid) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if kind != "group" {
		return ErrInvalid
	}
	if bookID != in.BookID || parent.Valid != (in.ParentID != nil) || (parent.Valid && parent.Int64 != *in.ParentID) {
		return ErrConflict
	}
	if err := checkBookAlive(ctx, tx, bookID); err != nil {
		return err
	}

	// Include trashed children so their later restoration never depends on this removed group.
	rows, err := tx.QueryContext(ctx, `SELECT id, parent_id, deleted_at FROM docs
WHERE book_id = ? AND (parent_id IS ? OR parent_id = ?) ORDER BY position, id`, bookID, in.ParentID, id)
	if err != nil {
		return err
	}
	var siblings, children, liveChildren []int64
	for rows.Next() {
		var childID int64
		var childParent sql.NullInt64
		var childDeleted sql.NullString
		if err := rows.Scan(&childID, &childParent, &childDeleted); err != nil {
			rows.Close()
			return err
		}
		if childParent.Valid && childParent.Int64 == id {
			children = append(children, childID)
			if !childDeleted.Valid {
				liveChildren = append(liveChildren, childID)
			}
		} else {
			siblings = append(siblings, childID)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	// A stale menu cannot silently move newly added/reordered children or a relocated group.
	if !slices.Equal(liveChildren, in.ChildIDs) {
		return ErrConflict
	}
	index := slices.Index(siblings, id)
	if index < 0 {
		return ErrConflict
	}
	order := append(append(append([]int64{}, siblings[:index]...), children...), siblings[index+1:]...)
	if _, err := tx.ExecContext(ctx, `UPDATE docs SET parent_id = ? WHERE parent_id = ? AND book_id = ?`, in.ParentID, id, bookID); err != nil {
		return err
	}
	for i, siblingID := range order {
		if _, err := tx.ExecContext(ctx, `UPDATE docs SET position = ? WHERE id = ?`, i+1, siblingID); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE docs SET deleted_at = ? WHERE id = ?`, s.stamp(), id); err != nil {
		return err
	}
	return tx.Commit()
}
