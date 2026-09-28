package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strconv"

	"github.com/Crashmere/Yuyan/internal/doc"
)

type BatchDocsInput struct {
	BookID       int64   `json:"bookId"`
	IDs          []int64 `json:"ids"`
	Action       string  `json:"action"`
	TargetBookID int64   `json:"targetBookId"`
	ParentID     *int64  `json:"parentId"`
}

type BatchDocsResult struct {
	IDs []int64 `json:"ids"`
}

// BatchDocs validates the complete selection before writing, and commits all changes together.
// Selecting a parent requires all of its live descendants in IDs: a stale tree cannot silently
// include a newly added child. The database's tree order determines the order at the destination.
func (s *Store) BatchDocs(ctx context.Context, in BatchDocsInput) (BatchDocsResult, error) {
	result := BatchDocsResult{IDs: []int64{}}
	if len(in.IDs) == 0 || len(in.IDs) > 5000 || (in.Action != "move" && in.Action != "copy" && in.Action != "trash") {
		return result, ErrInvalid
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	if err := checkBookAlive(ctx, tx, in.BookID); err != nil {
		return result, err
	}
	type item struct {
		id     int64
		parent sql.NullInt64
	}
	rows, err := tx.QueryContext(ctx, `SELECT id, parent_id FROM docs WHERE book_id = ? AND deleted_at IS NULL ORDER BY position, id`, in.BookID)
	if err != nil {
		return result, err
	}
	all := map[int64]item{}
	children := map[int64][]int64{}
	for rows.Next() {
		var n item
		if err := rows.Scan(&n.id, &n.parent); err != nil {
			rows.Close()
			return result, err
		}
		all[n.id] = n
		children[n.parent.Int64] = append(children[n.parent.Int64], n.id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return result, err
	}
	selected := map[int64]bool{}
	for _, id := range in.IDs {
		if _, ok := all[id]; !ok {
			return result, ErrConflict
		}
		selected[id] = true
	}
	var roots, ordered []int64
	var walk func(int64, bool) error
	walk = func(id int64, parentSelected bool) error {
		if parentSelected && !selected[id] {
			return ErrConflict
		}
		if selected[id] {
			ordered = append(ordered, id)
			if !parentSelected {
				roots = append(roots, id)
			}
		}
		for _, child := range children[id] {
			if err := walk(child, selected[id]); err != nil {
				return err
			}
		}
		return nil
	}
	for _, id := range children[0] {
		if err := walk(id, false); err != nil {
			return result, err
		}
	}
	if len(ordered) != len(selected) {
		return result, ErrConflict
	}
	if in.Action != "trash" {
		if err := checkBookAlive(ctx, tx, in.TargetBookID); err != nil {
			return result, err
		}
		if in.ParentID != nil {
			var book int64
			err := tx.QueryRowContext(ctx, `SELECT book_id FROM docs WHERE id = ? AND deleted_at IS NULL`, *in.ParentID).Scan(&book)
			if errors.Is(err, sql.ErrNoRows) || (err == nil && book != in.TargetBookID) || (in.Action == "move" && selected[*in.ParentID]) {
				return result, ErrInvalid
			}
			if err != nil {
				return result, err
			}
		}
	}
	now := s.stamp()
	if in.Action == "trash" {
		for _, id := range ordered {
			if _, err := tx.ExecContext(ctx, `UPDATE docs SET deleted_at = ? WHERE id = ?`, now, id); err != nil {
				return result, err
			}
		}
		result.IDs = ordered
	} else {
		var position int
		if err := tx.QueryRowContext(ctx, `SELECT coalesce(max(position), 0) FROM docs WHERE book_id = ? AND parent_id IS ? AND deleted_at IS NULL`, in.TargetBookID, in.ParentID).Scan(&position); err != nil {
			return result, err
		}
		if in.Action == "move" {
			for _, id := range roots {
				position++
				if _, err := tx.ExecContext(ctx, `WITH RECURSIVE sub(id) AS (
SELECT id FROM docs WHERE id = ? UNION ALL SELECT d.id FROM docs d JOIN sub ON d.parent_id = sub.id
) UPDATE docs SET book_id = ? WHERE id IN (SELECT id FROM sub)`, id, in.TargetBookID); err != nil {
					return result, err
				}
				if _, err := tx.ExecContext(ctx, `UPDATE docs SET parent_id = ?, position = ? WHERE id = ?`, in.ParentID, position, id); err != nil {
					return result, err
				}
			}
			result.IDs = ordered
		} else {
			copies := map[int64]int64{}
			childPositions := map[int64]int{}
			for _, id := range ordered {
				parent := in.ParentID
				itemPosition := position + 1
				isRoot := !selected[all[id].parent.Int64]
				if !isRoot {
					p := copies[all[id].parent.Int64]
					parent = &p
					childPositions[p]++
					itemPosition = childPositions[p]
				} else {
					position++
				}
				var title string
				if err := tx.QueryRowContext(ctx, `SELECT title FROM docs WHERE id = ?`, id).Scan(&title); err != nil {
					return result, err
				}
				if isRoot {
					original := title
					for suffix := 1; ; suffix++ {
						title = original + "（副本）"
						if suffix > 1 {
							title = fmt.Sprintf("%s（副本 %d）", original, suffix)
						}
						var count int
						if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM docs WHERE book_id = ? AND parent_id IS ? AND title = ? AND deleted_at IS NULL`, in.TargetBookID, parent, title).Scan(&count); err != nil {
							return result, err
						}
						if count == 0 {
							break
						}
					}
				}
				res, err := tx.ExecContext(ctx, `INSERT INTO docs(book_id, parent_id, position, kind, title, content, schema_version, plain_text, created_at, updated_at)
SELECT ?, ?, ?, kind, ?, content, schema_version, plain_text, ?, ? FROM docs WHERE id = ?`, in.TargetBookID, parent, itemPosition, title, now, now, id)
				if err != nil {
					return result, err
				}
				copies[id], err = res.LastInsertId()
				if err != nil {
					return result, err
				}
				result.IDs = append(result.IDs, copies[id])
			}
			// Resolve links only after all new IDs exist. Shared content-addressed images stay shared.
			for _, id := range result.IDs {
				var title, raw string
				if err := tx.QueryRowContext(ctx, `SELECT title, content FROM docs WHERE id = ?`, id).Scan(&title, &raw); err != nil {
					return result, err
				}
				content, err := doc.Parse([]byte(raw))
				if err != nil {
					return result, err
				}
				rewriteCopyLinks(&content, copies)
				data, err := content.Marshal()
				if err != nil {
					return result, err
				}
				if _, err := tx.ExecContext(ctx, `UPDATE docs SET content = ? WHERE id = ?`, string(data), id); err != nil {
					return result, err
				}
				if err := insertVersion(ctx, tx, id, 1, title, string(data), "create", now); err != nil {
					return result, err
				}
			}
		}
	}
	return result, tx.Commit()
}

var copyDocLink = regexp.MustCompile(`^/docs/([0-9]+)([?#].*)?$`)

func rewriteCopyLinks(n *doc.Node, copies map[int64]int64) {
	for _, mark := range n.Marks {
		if mark.Type != "link" {
			continue
		}
		href, _ := mark.Attrs["href"].(string)
		m := copyDocLink.FindStringSubmatch(href)
		if m == nil {
			continue
		}
		id, _ := strconv.ParseInt(m[1], 10, 64)
		if replacement, ok := copies[id]; ok {
			mark.Attrs["href"] = fmt.Sprintf("/docs/%d%s", replacement, m[2])
		}
	}
	for i := range n.Content {
		rewriteCopyLinks(&n.Content[i], copies)
	}
}
