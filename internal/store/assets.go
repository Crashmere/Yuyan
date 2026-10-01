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
	"net/http"
	"os"
	"path/filepath"
	"strings"

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
	return s.putAsset(ctx, data, originalName, false)
}

// PutAttachment shares immutable media storage with images. Arbitrary files are never served inline.
func (s *Store) PutAttachment(ctx context.Context, data []byte, originalName string) (Asset, error) {
	return s.putAsset(ctx, data, originalName, true)
}

func (s *Store) putAsset(ctx context.Context, data []byte, originalName string, attachment bool) (Asset, error) {
	if (!attachment && len(data) == 0) || len(data) > MaxAssetBytes {
		return Asset{}, ErrInvalid
	}
	mime := http.DetectContentType(data)
	ext, ok := imageExt[mime]
	if !ok {
		if !attachment {
			return Asset{}, ErrUnsupported
		}
		ext = "bin"
	}
	sum := sha256.Sum256(data)
	full := hex.EncodeToString(sum[:])
	id := full[:32]
	if a, err := s.GetAsset(ctx, id); err == nil {
		return a, nil
	} else if !errors.Is(err, ErrNotFound) {
		return Asset{}, err
	}
	var width, height int
	if cfg, _, err := image.DecodeConfig(bytes.NewReader(data)); err == nil {
		width, height = cfg.Width, cfg.Height
	}
	path := s.AssetPath(id, ext)
	if err := writeAssetImmutable(path, data, full); err != nil {
		return Asset{}, err
	}
	_, err := s.DB.ExecContext(ctx, `
INSERT OR IGNORE INTO assets(id, sha256, ext, mime, size, width, height, original_name, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, full, ext, mime, len(data), nullInt(width), nullInt(height), originalName, s.stamp())
	if err != nil {
		return Asset{}, err
	}
	return s.GetAsset(ctx, id)
}

// Publish a complete file without replacing an existing inode (backups use hard links).
func writeAssetImmutable(path string, data []byte, digest string) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".upload-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err = tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err = tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	if err = os.Link(tmp.Name(), path); err != nil && !errors.Is(err, os.ErrExist) {
		return err
	}
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
	var a Asset
	var w, h sql.NullInt64
	err := s.DB.QueryRowContext(ctx, `SELECT id, ext, mime, size, width, height, original_name FROM assets WHERE id = ?`, id).
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
