package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
)

// Book groups are a small presentation configuration. Keep it in existing metadata, with a
// revision check; book/document records and their trash/restore lifecycle remain independent.
type BookGroup struct {
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	BookIDs []int64 `json:"bookIds"`
}

type BookGroups struct {
	Revision int64       `json:"revision"`
	Groups   []BookGroup `json:"groups"`
}

func readBookGroups(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}) (BookGroups, error) {
	out := BookGroups{Groups: []BookGroup{}}
	var value string
	err := q.QueryRowContext(ctx, `SELECT value FROM meta WHERE key = 'book_groups'`).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return out, err
	}
	err = json.Unmarshal([]byte(value), &out)
	return out, err
}

func (s *Store) BookGroups(ctx context.Context) (BookGroups, error) {
	return readBookGroups(ctx, s.DB)
}

func (s *Store) SaveBookGroups(ctx context.Context, groups []BookGroup, revision int64, bookOrder []int64) (BookGroups, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return BookGroups{}, err
	}
	defer tx.Rollback()
	current, err := readBookGroups(ctx, tx)
	if err != nil {
		return current, err
	}
	if revision != current.Revision {
		return current, ErrConflict
	}
	if len(groups) > 200 {
		return current, ErrInvalid
	}
	ids, names, books := map[string]bool{}, map[string]bool{}, map[int64]bool{}
	for i := range groups {
		g := &groups[i]
		g.Name = strings.TrimSpace(g.Name)
		if g.ID == "" || len(g.ID) > 64 || g.Name == "" || g.Name == "未分组" || len([]rune(g.Name)) > 100 || ids[g.ID] || names[g.Name] {
			return current, ErrInvalid
		}
		ids[g.ID], names[g.Name] = true, true
		kept := []int64{}
		for _, id := range g.BookIDs {
			if id <= 0 || books[id] {
				return current, ErrInvalid
			}
			books[id] = true
			var exists bool
			if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM books WHERE id = ?)`, id).Scan(&exists); err != nil {
				return current, err
			}
			// Trashed books keep their membership for restoration; purging clears it atomically.
			if !exists {
				return current, ErrInvalid
			}
			kept = append(kept, id)
		}
		g.BookIDs = kept
	}
	if groups == nil {
		groups = []BookGroup{}
	}
	if bookOrder != nil {
		if err := reorderBooks(ctx, tx, bookOrder); err != nil {
			return current, err
		}
	}
	next := BookGroups{Revision: current.Revision + 1, Groups: groups}
	if err := writeBookGroups(ctx, tx, next); err != nil {
		return current, err
	}
	return next, tx.Commit()
}

func writeBookGroups(ctx context.Context, tx *sql.Tx, groups BookGroups) error {
	data, err := json.Marshal(groups)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO meta(key, value) VALUES ('book_groups', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, string(data))
	return err
}
