package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/Crashmere/Yuyan/internal/doc"
)

const VersionRetention = 30 * 24 * time.Hour
const versionRetentionKey = "version_retention:last_run"

var retentionZone = time.FixedZone("Asia/Shanghai", 8*60*60)

type VersionRetentionResult struct {
	Cutoff   time.Time `json:"cutoff"`
	NextRun  time.Time `json:"nextRun"`
	Eligible int       `json:"eligible"`
	Deleted  int64     `json:"deleted"`
	Ran      bool      `json:"ran"`
}

// The daily slot is 03:00 Beijing time, independent of the host's local timezone.
// A successful run after the slot also counts as catching up after downtime.
func versionRetentionSlot(now time.Time) time.Time {
	local := now.In(retentionZone)
	slot := time.Date(local.Year(), local.Month(), local.Day(), 3, 0, 0, 0, retentionZone)
	if local.Before(slot) {
		slot = slot.AddDate(0, 0, -1)
	}
	return slot
}

func (s *Store) PruneVersions(ctx context.Context, dryRun bool) (VersionRetentionResult, error) {
	return s.pruneVersions(ctx, dryRun, false)
}

func (s *Store) pruneVersions(ctx context.Context, dryRun, onlyIfDue bool) (VersionRetentionResult, error) {
	now := s.now().UTC()
	slot := versionRetentionSlot(now)
	result := VersionRetentionResult{Cutoff: now.Add(-VersionRetention).Truncate(time.Millisecond), NextRun: slot.AddDate(0, 0, 1)}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	if !dryRun {
		if _, err := tx.ExecContext(ctx, `UPDATE meta SET value = value WHERE key = 'schema'`); err != nil {
			return result, err
		}
	}
	if onlyIfDue {
		var raw string
		err := tx.QueryRowContext(ctx, `SELECT value FROM meta WHERE key = ?`, versionRetentionKey).Scan(&raw)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return result, err
		}
		if err == nil {
			last, err := time.Parse(time.RFC3339Nano, raw)
			if err != nil {
				return result, fmt.Errorf("invalid version retention state: %w", err)
			}
			if !last.Before(slot) {
				return result, nil
			}
		}
	}
	cutoff := result.Cutoff.Format("2006-01-02T15:04:05.000Z")
	rows, err := tx.QueryContext(ctx, `SELECT content FROM doc_versions WHERE created_at <= ?`, cutoff)
	if err != nil {
		return result, err
	}
	refs := map[string]bool{}
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			rows.Close()
			return result, err
		}
		n, err := doc.Parse([]byte(raw))
		if err != nil {
			rows.Close()
			return result, fmt.Errorf("read expiring version: %w", err)
		}
		for id := range mediaReferences(n) {
			refs[id] = true
		}
		result.Eligible++
	}
	err = rows.Err()
	rows.Close()
	if err != nil || dryRun {
		return result, err
	}
	if err := rememberVersionIDs(ctx, tx); err != nil {
		return result, err
	}
	deleted, err := tx.ExecContext(ctx, `DELETE FROM doc_versions WHERE created_at <= ?`, cutoff)
	if err != nil {
		return result, err
	}
	result.Deleted, err = deleted.RowsAffected()
	if err != nil {
		return result, err
	}
	// Last-reference removal starts a fresh grace period, even if an old upload
	// countdown has not yet been cleared by the next media scan.
	for id := range refs {
		if _, err := tx.ExecContext(ctx, `DELETE FROM meta WHERE key GLOB ?`, assetGCKey+id+".*"); err != nil {
			return result, err
		}
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, versionRetentionKey, now.Format(time.RFC3339Nano)); err != nil {
		return result, err
	}
	if err := tx.Commit(); err != nil {
		return result, err
	}
	result.Ran = true
	return result, nil
}

// SQLite INTEGER PRIMARY KEY can reuse IDs after pruning the newest rows. Keep
// the high-water mark in existing metadata so old preview URLs never change owner.
func rememberVersionIDs(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO meta(key, value) VALUES ('version_sequence', (SELECT coalesce(max(id), 0) FROM doc_versions)) ON CONFLICT(key) DO UPDATE SET value = max(CAST(meta.value AS INTEGER), CAST(excluded.value AS INTEGER))`)
	return err
}
