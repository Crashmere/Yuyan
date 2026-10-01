package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

const manifestFile = "manifest.json"

var backupAssetName = regexp.MustCompile(`^assets/[0-9a-f]{32}\.(png|jpg|gif|webp|bmp|bin)$`)

// BackupManifest lists every file of a backup with its SHA-256.
type BackupManifest struct {
	Version   int               `json:"version"`
	CreatedAt string            `json:"createdAt"`
	Files     map[string]string `json:"files"`
}

// Backup writes a consistent snapshot of the database and hard links to every recorded asset into
// out, which must not exist yet. Hard links require data and backups on the same mount point.
func (s *Store) Backup(ctx context.Context, out string) error {
	lock, err := s.lockAssets(ctx, false)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err := os.Mkdir(out, 0o700); err != nil {
		return err
	}
	complete := false
	defer func() {
		if !complete {
			os.RemoveAll(out)
		}
	}()
	if err := os.Mkdir(filepath.Join(out, "assets"), 0o700); err != nil {
		return err
	}
	dbPath := filepath.Join(out, dbFile)
	if _, err := s.DB.ExecContext(ctx, `VACUUM INTO ?`, dbPath); err != nil {
		return fmt.Errorf("snapshot database: %w", err)
	}
	if err := os.Chmod(dbPath, 0o600); err != nil {
		return err
	}
	snap, err := sql.Open("sqlite", "file:"+filepath.ToSlash(dbPath)+"?mode=ro")
	if err != nil {
		return err
	}
	defer snap.Close()
	var integrity string
	if err := snap.QueryRowContext(ctx, `PRAGMA integrity_check`).Scan(&integrity); err != nil || integrity != "ok" {
		return fmt.Errorf("snapshot integrity check failed: %v %s", err, integrity)
	}
	m := BackupManifest{Version: 2, CreatedAt: s.stamp(), Files: map[string]string{}}
	if m.Files[dbFile], err = fileDigest(dbPath); err != nil {
		return err
	}
	rows, err := snap.QueryContext(ctx, `SELECT id, ext, sha256 FROM assets`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id, ext, want string
		if err := rows.Scan(&id, &ext, &want); err != nil {
			return err
		}
		rel := "assets/" + id + "." + ext
		if !backupAssetName.MatchString(rel) {
			return fmt.Errorf("invalid asset name %s", rel)
		}
		dst := filepath.Join(out, filepath.FromSlash(rel))
		if err := os.Link(s.AssetPath(id, ext), dst); err != nil {
			return fmt.Errorf("hard-link asset backup: %w", err)
		}
		got, err := fileDigest(dst)
		if err != nil {
			return err
		}
		if got != want {
			return fmt.Errorf("%s does not match its recorded SHA-256", rel)
		}
		m.Files[rel] = got
	}
	if err := rows.Err(); err != nil {
		return err
	}
	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	if err := writeFileAtomic(filepath.Join(out, manifestFile), b); err != nil {
		return err
	}
	complete = true
	return nil
}

// VerifyBackup checks that every file listed in the manifest exists with the recorded SHA-256.
func VerifyBackup(dir string) (BackupManifest, error) {
	var m BackupManifest
	b, err := os.ReadFile(filepath.Join(dir, manifestFile))
	if err != nil {
		return m, err
	}
	if err := json.Unmarshal(b, &m); err != nil {
		return m, err
	}
	if (m.Version != 1 && m.Version != 2) || m.Files[dbFile] == "" {
		return m, errors.New("invalid backup manifest")
	}
	for rel, want := range m.Files {
		if rel != dbFile && !backupAssetName.MatchString(rel) {
			return m, fmt.Errorf("invalid backup path %q", rel)
		}
		got, err := fileDigest(filepath.Join(dir, filepath.FromSlash(rel)))
		if err != nil || got != want {
			return m, fmt.Errorf("backup file %s is missing or changed", rel)
		}
	}
	return m, nil
}

// Restore copies a verified backup into dir, which must not exist yet, and checks the result.
func Restore(ctx context.Context, from, dir string) error {
	m, err := VerifyBackup(from)
	if err != nil {
		return err
	}
	if _, err := os.Stat(dir); err == nil {
		return fmt.Errorf("%s already exists; restore only into a new directory", dir)
	}
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0o700); err != nil {
		return err
	}
	complete := false
	defer func() {
		if !complete {
			os.RemoveAll(dir)
		}
	}()
	for rel := range m.Files {
		if err := copyFile(filepath.Join(from, filepath.FromSlash(rel)), filepath.Join(dir, filepath.FromSlash(rel))); err != nil {
			return err
		}
	}
	s, err := Open(dir)
	if err != nil {
		return err
	}
	defer s.Close()
	if err := s.Check(ctx); err != nil {
		return err
	}
	complete = true
	return nil
}

// PruneBackups keeps the newest `keep` complete daily backups in dir.
func PruneBackups(dir string, keep int) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	var names []string
	for _, e := range entries {
		if e.IsDir() && strings.HasPrefix(e.Name(), "daily-") {
			if _, err := os.Stat(filepath.Join(dir, e.Name(), manifestFile)); err == nil {
				names = append(names, e.Name())
			}
		}
	}
	sort.Sort(sort.Reverse(sort.StringSlice(names)))
	for i := keep; i < len(names); i++ {
		if err := os.RemoveAll(filepath.Join(dir, names[i])); err != nil {
			return err
		}
	}
	return nil
}

func fileDigest(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	if err := out.Sync(); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}
