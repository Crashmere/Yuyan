package store

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/Crashmere/Yuyan/internal/doc"
	"github.com/Crashmere/Yuyan/internal/drawing"
)

func (s *Store) PutDrawing(ctx context.Context, data []byte) (doc.Node, error) {
	p, err := drawing.Decode(data)
	if err != nil {
		return doc.Node{}, fmt.Errorf("%w: %s", ErrInvalid, err)
	}
	data, err = json.Marshal(p)
	if err != nil {
		return doc.Node{}, err
	}
	if len(data) > drawing.MaxBytes {
		return doc.Node{}, fmt.Errorf("%w: drawing package exceeds 12 MiB after normalization", ErrInvalid)
	}
	a, err := s.putAttachment(ctx, bytes.NewReader(data), "drawing.yuyan.json", func(tx *sql.Tx, id string) error {
		if err := retainDrawingFiles(ctx, tx, p); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `UPDATE assets SET mime = ? WHERE id = ?`, drawing.Mime, id)
		return err
	})
	if err != nil {
		return doc.Node{}, err
	}
	return doc.Node{Type: "drawing", Attrs: map[string]any{
		"src": "/drawings/" + a.ID, "version": 1, "width": max(100, min(800, p.Preview.Width)), "blockAlign": "center", "caption": "",
		"text": p.Text, "previewWidth": p.Preview.Width, "previewHeight": p.Preview.Height, "previewMime": p.Preview.Mime,
	}}, nil
}

func (s *Store) GetDrawing(ctx context.Context, id string) (drawing.Package, error) {
	return s.getDrawing(ctx, s.DB, id)
}

type assetQuery interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func (s *Store) getDrawing(ctx context.Context, q assetQuery, id string) (drawing.Package, error) {
	b, err := s.drawingBytes(ctx, q, id)
	if err != nil {
		return drawing.Package{}, err
	}
	p, err := drawing.Decode(b)
	if err != nil {
		return p, fmt.Errorf("read drawing %s: %w", id, err)
	}
	return p, nil
}

func retainDrawingFiles(ctx context.Context, tx *sql.Tx, p drawing.Package) error {
	for _, file := range p.Files {
		m := drawing.ImageSource.FindStringSubmatch(file.Src)
		a, err := getAsset(ctx, tx, m[1])
		if err != nil || a.URL != file.Src || a.Mime != file.MimeType || a.Width <= 0 || a.Height <= 0 {
			return ErrMissingAsset
		}
		if err := retainAsset(ctx, tx, a.ID, true); err != nil {
			return err
		}
	}
	return nil
}

// Validate derived node metadata against its immutable package, even when the
// client uses the generic document or template API.
func (s *Store) validateDrawings(ctx context.Context, tx *sql.Tx, n doc.Node) error {
	if n.Type == "drawing" {
		m := drawing.Source.FindStringSubmatch(n.Attr("src"))
		if m == nil {
			return ErrInvalid
		}
		p, err := s.getDrawing(ctx, tx, m[1])
		if err != nil {
			return err
		}
		if n.Attr("text") != p.Text || n.Attr("previewMime") != p.Preview.Mime || n.AttrInt("previewWidth", 0) != p.Preview.Width || n.AttrInt("previewHeight", 0) != p.Preview.Height {
			return ErrInvalid
		}
	}
	for _, child := range n.Content {
		if err := s.validateDrawings(ctx, tx, child); err != nil {
			return err
		}
	}
	return nil
}

// Packages in their upload/unreferenced grace period also keep images alive.
// Once the package becomes collectible, the dependencies begin their own grace
// period. Any unreadable registered package stops GC conservatively.
func (s *Store) drawingReferences(ctx context.Context, tx *sql.Tx, refs map[string]bool, states map[string]assetGCState) error {
	rows, err := tx.QueryContext(ctx, `SELECT id FROM assets WHERE mime = ?`, drawing.Mime)
	if err != nil {
		return err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, id := range ids {
		p, err := s.getDrawing(ctx, tx, id)
		if err != nil {
			return err
		}
		state, tracked := states[id+".bin"]
		if !refs[id] && tracked && s.now().UTC().Sub(state.UnreferencedAt) >= AssetGracePeriod {
			continue
		}
		for _, file := range p.Files {
			m := drawing.ImageSource.FindStringSubmatch(file.Src)
			a, err := getAsset(ctx, tx, m[1])
			if err != nil || a.URL != file.Src {
				return fmt.Errorf("missing dependency of drawing %s", id)
			}
			refs[a.ID] = true
		}
	}
	return nil
}

func (s *Store) retainDrawingAsset(ctx context.Context, tx *sql.Tx, id string) error {
	a, err := getAsset(ctx, tx, id)
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if !strings.EqualFold(a.Mime, drawing.Mime) {
		return nil
	}
	p, err := s.getDrawing(ctx, tx, id)
	if err != nil {
		return err
	}
	return retainDrawingFiles(ctx, tx, p)
}

func (s *Store) drawingBytes(ctx context.Context, q assetQuery, id string) ([]byte, error) {
	a, err := getAsset(ctx, q, id)
	if err != nil {
		return nil, err
	}
	if a.Mime != drawing.Mime || a.Ext != "bin" || a.Size > drawing.MaxBytes {
		return nil, ErrInvalid
	}
	f, err := os.Open(s.AssetPath(a.ID, a.Ext))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, drawing.MaxBytes+1))
	if err != nil {
		return nil, err
	}
	if len(b) > drawing.MaxBytes {
		return nil, ErrInvalid
	}
	return b, nil
}

func (s *Store) DrawingPreview(ctx context.Context, id string) (drawing.Package, error) {
	b, err := s.drawingBytes(ctx, s.DB, id)
	if err != nil {
		return drawing.Package{}, err
	}
	var p drawing.Package
	if json.Unmarshal(b, &p) != nil || p.Format != "yuyan-drawing" {
		return p, ErrInvalid
	}
	return p, drawing.ValidatePreview(p.Preview)
}
