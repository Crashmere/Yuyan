package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/Crashmere/Yuyan/internal/doc"
)

const AssetGracePeriod = time.Hour
const assetGCKey = "asset_gc:"

type assetGCState struct {
	UnreferencedAt time.Time `json:"unreferencedAt"`
	Deleting       bool      `json:"deleting,omitempty"`
}

type AssetGCResult struct {
	Referenced    int   `json:"referenced"`
	Pending       int   `json:"pending"`
	Eligible      int   `json:"eligible"`
	EligibleBytes int64 `json:"eligibleBytes"`
	Deleted       int   `json:"deleted"`
	Bytes         int64 `json:"deletedBytes"`
	Temps         int   `json:"temporaryFiles"`
}

// RunAssetGC runs only in the serving process. State lives in meta, survives
// restarts, and is included in existing native snapshots without a migration.
func (s *Store) RunAssetGC(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	first := true
	for {
		versions, err := s.pruneVersions(ctx, false, true)
		if err != nil && ctx.Err() == nil {
			slog.Error("version retention", "error", err)
		} else if versions.Ran {
			slog.Info("version retention", "retentionDays", 30, "deleted", versions.Deleted, "nextRun", versions.NextRun)
		}
		result, err := s.CollectAssets(ctx)
		if err == nil && first {
			slog.Info("asset cleanup ready", "gracePeriod", AssetGracePeriod, "interval", time.Minute, "referenced", result.Referenced, "pending", result.Pending)
			first = false
		}
		if err != nil && ctx.Err() == nil {
			slog.Error("asset cleanup", "error", err)
		} else if err == nil && (result.Deleted > 0 || result.Temps > 0) {
			slog.Info("asset cleanup", "deleted", result.Deleted, "bytes", result.Bytes, "temporaryFiles", result.Temps)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// CollectAssets records first observation of unused files, then removes only
// those continuously unused for an hour. Backups and uploads cannot race file
// removal. A committed deletion marker makes a crash between SQL and unlink
// retryable; never unlink before the asset row has been removed successfully.
func (s *Store) CollectAssets(ctx context.Context) (AssetGCResult, error) {
	return s.collectAssets(ctx, false)
}

// InspectAssets reports the current decisions without starting timers or deleting
// anything. Used before deployment and for read-only operational diagnostics.
func (s *Store) InspectAssets(ctx context.Context) (AssetGCResult, error) {
	return s.collectAssets(ctx, true)
}

func (s *Store) collectAssets(ctx context.Context, dryRun bool) (AssetGCResult, error) {
	var result AssetGCResult
	lock, err := s.lockAssets(ctx, !dryRun)
	if err != nil {
		return result, err
	}
	defer lock.Close()
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	// Reserve the writer before scanning; another process cannot change references
	// between this snapshot and its deletion decisions.
	if !dryRun {
		if _, err := tx.ExecContext(ctx, `UPDATE meta SET value = value WHERE key = 'schema'`); err != nil {
			return result, err
		}
	}
	refs, err := storedMediaReferences(ctx, tx)
	if err != nil {
		return result, err // Unreadable content must stop collection, not hide references.
	}
	states, err := readAssetGCStates(ctx, tx)
	if err != nil {
		return result, err
	}
	if err := s.drawingReferences(ctx, tx, refs, states); err != nil {
		return result, err
	}
	files, err := s.collectibleFiles(ctx, tx)
	if err != nil {
		return result, err
	}
	// Include committed deletions whose unlink was interrupted, even if the file
	// has already gone. This also completes markers restored from an old snapshot.
	for name, state := range states {
		if state.Deleting {
			if _, ok := files[name]; !ok {
				files[name] = 0
			}
		}
	}
	now := s.now().UTC()
	deleting := map[string]int64{}
	for name, size := range files {
		id, _, _ := strings.Cut(name, ".")
		state, tracked := states[name]
		if refs[id] {
			result.Referenced++
			if tracked && !dryRun {
				if _, err := tx.ExecContext(ctx, `DELETE FROM meta WHERE key = ?`, assetGCKey+name); err != nil {
					return result, err
				}
			}
			continue
		}
		if !tracked {
			state.UnreferencedAt = now
		}
		if now.Sub(state.UnreferencedAt) >= AssetGracePeriod {
			result.Eligible++
			result.EligibleBytes += size
			state.Deleting = true
			if !dryRun {
				if _, err := tx.ExecContext(ctx, `DELETE FROM assets WHERE id = ? AND ext = ?`, id, strings.TrimPrefix(name, id+".")); err != nil {
					return result, err
				}
			}
			deleting[name] = size
		} else {
			result.Pending++
		}
		if (!tracked || state.Deleting) && !dryRun {
			if err := writeAssetGCState(ctx, tx, name, state); err != nil {
				return result, err
			}
		}
	}
	if dryRun {
		return result, nil
	}
	if err := tx.Commit(); err != nil {
		return result, err
	}
	for name, size := range deleting {
		if err := os.Remove(filepath.Join(s.dir, "assets", name)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return result, fmt.Errorf("remove unused asset: %w", err)
		}
		if _, err := s.DB.ExecContext(ctx, `DELETE FROM meta WHERE key = ?`, assetGCKey+name); err != nil {
			return result, err
		}
		result.Deleted++
		result.Bytes += size
	}
	result.Temps, err = s.cleanUploadTemps(now)
	return result, err
}

func writeAssetGCState(ctx context.Context, tx *sql.Tx, name string, state assetGCState) error {
	data, err := json.Marshal(state)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, assetGCKey+name, string(data))
	return err
}

func readAssetGCStates(ctx context.Context, tx *sql.Tx) (map[string]assetGCState, error) {
	rows, err := tx.QueryContext(ctx, `SELECT key, value FROM meta WHERE key GLOB 'asset_gc:*'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	states := map[string]assetGCState{}
	for rows.Next() {
		var key, raw string
		if err := rows.Scan(&key, &raw); err != nil {
			return nil, err
		}
		name := strings.TrimPrefix(key, assetGCKey)
		var state assetGCState
		if !backupAssetName.MatchString("assets/"+name) || json.Unmarshal([]byte(raw), &state) != nil || state.UnreferencedAt.IsZero() {
			return nil, errors.New("invalid asset cleanup state")
		}
		states[name] = state
	}
	return states, rows.Err()
}

func storedMediaReferences(ctx context.Context, tx *sql.Tx) (map[string]bool, error) {
	rows, err := tx.QueryContext(ctx, `SELECT content FROM docs UNION ALL SELECT content FROM doc_versions UNION ALL SELECT json_extract(value, '$.content') FROM meta WHERE key GLOB 'template:*'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	refs := map[string]bool{}
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		n, err := doc.Parse([]byte(raw))
		if err != nil {
			return nil, fmt.Errorf("scan asset references: %w", err)
		}
		for id := range mediaReferences(n) {
			refs[id] = true
		}
	}
	return refs, rows.Err()
}

func (s *Store) collectibleFiles(ctx context.Context, tx *sql.Tx) (map[string]int64, error) {
	files := map[string]int64{}
	rows, err := tx.QueryContext(ctx, `SELECT id || '.' || ext, size FROM assets`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var name string
		var size int64
		if err := rows.Scan(&name, &size); err != nil {
			rows.Close()
			return nil, err
		}
		if !backupAssetName.MatchString("assets/" + name) {
			rows.Close()
			return nil, errors.New("invalid stored asset name")
		}
		files[name] = size
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(filepath.Join(s.dir, "assets"))
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		if !entry.Type().IsRegular() || !backupAssetName.MatchString("assets/"+entry.Name()) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return nil, err
		}
		files[entry.Name()] = info.Size()
	}
	return files, nil
}

func (s *Store) cleanUploadTemps(now time.Time) (int, error) {
	entries, err := os.ReadDir(filepath.Join(s.dir, "assets"))
	if err != nil {
		return 0, err
	}
	removed := 0
	for _, entry := range entries {
		if !entry.Type().IsRegular() || !strings.HasPrefix(entry.Name(), ".upload-") {
			continue
		}
		path := filepath.Join(s.dir, "assets", entry.Name())
		f, err := os.Open(path)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return removed, err
		}
		// Uploads lock their temporary file throughout reception and publication.
		if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
			f.Close()
			if errors.Is(err, syscall.EWOULDBLOCK) {
				continue
			}
			return removed, err
		}
		info, err := f.Stat()
		if err == nil && now.Sub(info.ModTime()) >= AssetGracePeriod {
			err = os.Remove(path)
			if err == nil {
				removed++
			}
		}
		f.Close()
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return removed, err
		}
	}
	return removed, nil
}
