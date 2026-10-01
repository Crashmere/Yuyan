package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
)

// PurgeDoc permanently deletes a document in the trash together with everything deleted with it.
// Children that were trashed separately stay in the trash and move to the top level of their
// knowledge base, as if restored without a parent. Unreferenced media is collected
// separately after its one-hour grace period.
func (s *Store) PurgeDoc(ctx context.Context, id int64) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var deleted sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT deleted_at FROM docs WHERE id = ?`, id).Scan(&deleted)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !deleted.Valid) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
CREATE TEMP TABLE IF NOT EXISTS purge(id INTEGER PRIMARY KEY);
DELETE FROM purge;`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
WITH RECURSIVE sub(id) AS (
  SELECT id FROM docs WHERE id = ?
  UNION ALL SELECT d.id FROM docs d JOIN sub ON d.parent_id = sub.id WHERE d.deleted_at = ?
)
INSERT INTO purge SELECT id FROM sub`, id, deleted.String); err != nil {
		return err
	}
	if err := purgeListed(ctx, tx); err != nil {
		return err
	}
	return tx.Commit()
}

// PurgeBook permanently deletes a knowledge base in the trash with all of its documents.
func (s *Store) PurgeBook(ctx context.Context, id int64) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var deleted sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT deleted_at FROM books WHERE id = ?`, id).Scan(&deleted)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !deleted.Valid) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if err := purgeBooks(ctx, tx, `id = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

// EmptyTrash permanently deletes every knowledge base and document in the trash.
func (s *Store) EmptyTrash(ctx context.Context) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := purgeBooks(ctx, tx, `deleted_at IS NOT NULL`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
CREATE TEMP TABLE IF NOT EXISTS purge(id INTEGER PRIMARY KEY);
DELETE FROM purge;
INSERT INTO purge SELECT id FROM docs WHERE deleted_at IS NOT NULL;`); err != nil {
		return err
	}
	if err := purgeListed(ctx, tx); err != nil {
		return err
	}
	return tx.Commit()
}

func purgeBooks(ctx context.Context, tx *sql.Tx, where string, args ...any) error {
	books := `SELECT id FROM books WHERE ` + where
	groups, err := readBookGroups(ctx, tx)
	if err != nil {
		return err
	}
	changed := false
	for i := range groups.Groups {
		kept := []int64{}
		for _, id := range groups.Groups[i].BookIDs {
			var purge bool
			params := append([]any{id}, args...)
			if err := tx.QueryRowContext(ctx, `SELECT ? IN (`+books+`)`, params...).Scan(&purge); err != nil {
				return err
			}
			if purge {
				changed = true
			} else {
				kept = append(kept, id)
			}
		}
		groups.Groups[i].BookIDs = kept
	}
	if changed {
		groups.Revision++
		data, err := json.Marshal(groups)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE meta SET value = ? WHERE key = 'book_groups'`, string(data)); err != nil {
			return err
		}
	}
	for _, q := range []string{
		`DELETE FROM doc_versions WHERE doc_id IN (SELECT id FROM docs WHERE book_id IN (` + books + `))`,
		`DELETE FROM docs WHERE book_id IN (` + books + `)`,
		`DELETE FROM books WHERE ` + where,
	} {
		if _, err := tx.ExecContext(ctx, q, args...); err != nil {
			return err
		}
	}
	return nil
}

// purgeListed deletes the documents in the temp table purge and their versions, first detaching
// any remaining document that still points at one of them.
func purgeListed(ctx context.Context, tx *sql.Tx) error {
	for _, q := range []string{
		`UPDATE docs SET parent_id = NULL WHERE parent_id IN (SELECT id FROM purge) AND id NOT IN (SELECT id FROM purge)`,
		`DELETE FROM doc_versions WHERE doc_id IN (SELECT id FROM purge)`,
		`DELETE FROM docs WHERE id IN (SELECT id FROM purge)`,
		`DELETE FROM purge`,
	} {
		if _, err := tx.ExecContext(ctx, q); err != nil {
			return err
		}
	}
	return nil
}
