package store

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"syscall"

	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/webp"
)

const MaxAssetBytes = 25 << 20

var ErrUnsupported = errors.New("unsupported image type")

var imageExt = map[string]string{
	"image/png":  "png",
	"image/jpeg": "jpg",
	"image/gif":  "gif",
	"image/webp": "webp",
	"image/bmp":  "bmp",
}

type Asset struct {
	ID           string `json:"id"`
	Ext          string `json:"ext"`
	Mime         string `json:"mime"`
	Size         int64  `json:"size"`
	Width        int    `json:"width,omitempty"`
	Height       int    `json:"height,omitempty"`
	OriginalName string `json:"originalName"`
	URL          string `json:"url"`
}

func (s *Store) AssetPath(id, ext string) string {
	return filepath.Join(s.dir, "assets", id+"."+ext)
}

// PutAsset stores an image under the first 128 bits of its SHA-256. Identical bytes map to the
// same object; existing files are never overwritten.
func (s *Store) PutAsset(ctx context.Context, data []byte, originalName string) (Asset, error) {
	if len(data) == 0 || len(data) > MaxAssetBytes {
		return Asset{}, ErrInvalid
	}
	if _, ok := imageExt[http.DetectContentType(data)]; !ok {
		return Asset{}, ErrUnsupported
	}
	return s.PutAttachment(ctx, bytes.NewReader(data), originalName)
}

// PutAttachment streams into immutable media storage without a file-size limit. The temporary
// file lives on the data volume, not /tmp; memory use does not grow with the upload size.
func (s *Store) PutAttachment(ctx context.Context, source io.Reader, originalName string) (Asset, error) {
	return s.putAttachment(ctx, source, originalName, nil)
}

// beforeCommit lets typed immutable packages register and protect their dependencies
// in the same transaction and directory lock as publication.
func (s *Store) putAttachment(ctx context.Context, source io.Reader, originalName string, beforeCommit func(*sql.Tx, string) error) (Asset, error) {
	tmp, err := os.CreateTemp(filepath.Join(s.dir, "assets"), ".upload-*")
	if err != nil {
		return Asset{}, err
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()
	if err := syscall.Flock(int(tmp.Fd()), syscall.LOCK_EX); err != nil {
		return Asset{}, err
	}
	hash := sha256.New()
	size, err := io.Copy(io.MultiWriter(tmp, hash), assetReader{ctx, source})
	if err != nil {
		return Asset{}, err
	}
	if err := ctx.Err(); err != nil {
		return Asset{}, err
	}
	header := make([]byte, 512)
	n, err := tmp.ReadAt(header, 0)
	if err != nil && err != io.EOF {
		return Asset{}, err
	}
	mime := http.DetectContentType(header[:n])
	ext, ok := imageExt[mime]
	if !ok {
		ext = "bin"
	}
	full := hex.EncodeToString(hash.Sum(nil))
	id := full[:32]
	var width, height int
	if ok {
		metadataBytes := size
		if size > MaxAssetBytes {
			metadataBytes = 1 << 20
		}
		if cfg, _, err := image.DecodeConfig(io.NewSectionReader(tmp, 0, metadataBytes)); err == nil {
			width, height = cfg.Width, cfg.Height
		}
	}
	if err := tmp.Sync(); err != nil {
		return Asset{}, err
	}
	if err := ctx.Err(); err != nil {
		return Asset{}, err
	}
	lock, err := s.lockAssets(ctx, false)
	if err != nil {
		return Asset{}, err
	}
	defer lock.Close()
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Asset{}, err
	}
	defer tx.Rollback()
	if a, err := getAsset(ctx, tx, id); err == nil {
		if beforeCommit != nil {
			if err := beforeCommit(tx, id); err != nil {
				return Asset{}, err
			}
		}
		if err := writeAssetGCState(ctx, tx, a.ID+"."+a.Ext, assetGCState{UnreferencedAt: s.now().UTC()}); err != nil {
			return Asset{}, err
		}
		return a, tx.Commit()
	} else if !errors.Is(err, ErrNotFound) {
		return Asset{}, err
	}
	if err := publishAsset(tmp.Name(), s.AssetPath(id, ext), full); err != nil {
		return Asset{}, err
	}
	_, err = tx.ExecContext(ctx, `
INSERT OR IGNORE INTO assets(id, sha256, ext, mime, size, width, height, original_name, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, full, ext, mime, size, nullInt(width), nullInt(height), originalName, s.stamp())
	if err != nil {
		return Asset{}, err
	}
	if err := writeAssetGCState(ctx, tx, id+"."+ext, assetGCState{UnreferencedAt: s.now().UTC()}); err != nil {
		return Asset{}, err
	}
	if beforeCommit != nil {
		if err := beforeCommit(tx, id); err != nil {
			return Asset{}, err
		}
	}
	a, err := getAsset(ctx, tx, id)
	if err != nil {
		return Asset{}, err
	}
	return a, tx.Commit()
}

type assetReader struct {
	ctx    context.Context
	source io.Reader
}

func (r assetReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.source.Read(p)
}

// Publish a complete file without replacing an existing inode (backups use hard links).
func publishAsset(tmp, path, digest string) error {
	if err := os.Link(tmp, path); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrExist) {
		return err
	}
	// Another upload may have published the same object before its database row was visible.
	got, err := fileDigest(path)
	if err != nil {
		return err
	}
	if got != digest {
		return errors.New("stored asset digest mismatch")
	}
	return nil
}

func nullInt(v int) any {
	if v == 0 {
		return nil
	}
	return v
}

func writeFileAtomic(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".upload-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmp.Name(), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

// AssetSizes returns the stored pixel size of the given images, keyed by asset id. Images whose
// size could not be read when they were uploaded are left out.
func (s *Store) AssetSizes(ctx context.Context, ids []string) (map[string][2]int, error) {
	sizes := map[string][2]int{}
	seen := map[string]bool{}
	var unique []any
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			unique = append(unique, id)
		}
	}
	// SQLite limits the number of bound parameters in one statement.
	for start := 0; start < len(unique); start += 500 {
		batch := unique[start:min(start+500, len(unique))]
		rows, err := s.DB.QueryContext(ctx, `SELECT id, width, height FROM assets WHERE width IS NOT NULL AND height IS NOT NULL AND id IN (?`+strings.Repeat(",?", len(batch)-1)+`)`, batch...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var id string
			var w, h int
			if err := rows.Scan(&id, &w, &h); err != nil {
				rows.Close()
				return nil, err
			}
			sizes[id] = [2]int{w, h}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
	}
	return sizes, nil
}

func (s *Store) GetAsset(ctx context.Context, id string) (Asset, error) {
	return getAsset(ctx, s.DB, id)
}

func getAsset(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, id string) (Asset, error) {
	var a Asset
	var w, h sql.NullInt64
	err := q.QueryRowContext(ctx, `SELECT id, ext, mime, size, width, height, original_name FROM assets WHERE id = ?`, id).
		Scan(&a.ID, &a.Ext, &a.Mime, &a.Size, &w, &h, &a.OriginalName)
	if errors.Is(err, sql.ErrNoRows) {
		return a, ErrNotFound
	}
	if err != nil {
		return a, err
	}
	a.Width, a.Height = int(w.Int64), int(h.Int64)
	a.URL = fmt.Sprintf("/assets/%s.%s", a.ID, a.Ext)
	return a, nil
}
