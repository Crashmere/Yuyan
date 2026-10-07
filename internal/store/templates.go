package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"

	"github.com/Crashmere/Yuyan/internal/doc"
)

// Templates are independent snapshots. The existing database snapshot and all-assets backup
// cover their content and images, including after the source document has been purged.
type Template struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Kind          string   `json:"kind"`
	Revision      int64    `json:"revision"`
	SchemaVersion int      `json:"schemaVersion"`
	CreatedAt     string   `json:"createdAt"`
	UpdatedAt     string   `json:"updatedAt"`
	Content       doc.Node `json:"content"`
}

func (s *Store) Templates(ctx context.Context) ([]Template, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT value FROM meta WHERE key LIKE 'template:%' ORDER BY key DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Template{}
	for rows.Next() {
		var value string
		var t Template
		if err := rows.Scan(&value); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(value), &t); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Store) Template(ctx context.Context, id string) (Template, error) {
	var t Template
	var value string
	err := s.DB.QueryRowContext(ctx, `SELECT value FROM meta WHERE key = ?`, "template:"+id).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return t, ErrNotFound
	}
	if err != nil {
		return t, err
	}
	err = json.Unmarshal([]byte(value), &t)
	return t, err
}

func (s *Store) CreateTemplate(ctx context.Context, name, kind string, content doc.Node) (Template, error) {
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > 100 || (kind != "document" && kind != "snippet") {
		return Template{}, ErrInvalid
	}
	data, err := content.Marshal()
	if err != nil {
		return Template{}, err
	}
	if _, err = doc.Parse(data); err != nil {
		return Template{}, ErrInvalid
	}
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return Template{}, err
	}
	t := Template{ID: hex.EncodeToString(id[:]), Name: name, Kind: kind, Revision: 1, SchemaVersion: doc.SchemaVersion, CreatedAt: s.stamp(), UpdatedAt: s.stamp(), Content: content}
	data, err = json.Marshal(t)
	if err != nil {
		return t, err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return t, err
	}
	defer tx.Rollback()
	if err := s.retainContentAssets(ctx, tx, content); err != nil {
		return t, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO meta(key, value) VALUES (?, ?)`, "template:"+t.ID, string(data)); err != nil {
		return t, err
	}
	return t, tx.Commit()
}

// Compare the stored revision in the same statement as the write, including deletion.
func (s *Store) ChangeTemplate(ctx context.Context, id, name string, revision int64, remove bool) (Template, error) {
	t, err := s.Template(ctx, id)
	if err != nil {
		return t, err
	}
	if t.Revision != revision {
		return t, ErrConflict
	}
	var result sql.Result
	if remove {
		result, err = s.DB.ExecContext(ctx, `DELETE FROM meta WHERE key = ? AND json_extract(value, '$.revision') = ?`, "template:"+id, revision)
	} else {
		name = strings.TrimSpace(name)
		if name == "" || len([]rune(name)) > 100 {
			return t, ErrInvalid
		}
		t.Name, t.Revision, t.UpdatedAt = name, revision+1, s.stamp()
		data, marshalErr := json.Marshal(t)
		if marshalErr != nil {
			return t, marshalErr
		}
		result, err = s.DB.ExecContext(ctx, `UPDATE meta SET value = ? WHERE key = ? AND json_extract(value, '$.revision') = ?`, string(data), "template:"+id, revision)
	}
	if err != nil {
		return t, err
	}
	n, err := result.RowsAffected()
	if err == nil && n == 0 {
		err = ErrConflict
	}
	return t, err
}
