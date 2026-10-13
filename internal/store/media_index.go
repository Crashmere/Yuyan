package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"

	"github.com/Crashmere/Yuyan/internal/doc"
)

type queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

// mediaIndex remembers the media referenced by each stored body between collection
// passes, so a pass parses only bodies written since the previous one. Every content
// write advances the document revision; document IDs can be reused after a purge, so
// the creation time is part of the key. Snapshot IDs are never reused and snapshot
// bodies, like drawing packages, never change.
type mediaIndex struct {
	mu       sync.Mutex
	rows     map[string]indexedRefs
	drawings map[string][]string
}

type indexedRefs struct {
	version string
	refs    []string
}

var mediaSources = []struct{ prefix, list, fetch string }{
	{"doc:", `SELECT id, revision || '/' || created_at FROM docs`,
		`SELECT revision || '/' || created_at, content FROM docs WHERE id = ?`},
	{"version:", `SELECT id, '' FROM doc_versions`,
		`SELECT '', content FROM doc_versions WHERE id = ?`},
	{"meta:", `SELECT key, coalesce(json_extract(value, '$.revision'), '') FROM meta WHERE key GLOB 'template:*'`,
		`SELECT coalesce(json_extract(value, '$.revision'), ''), json_extract(value, '$.content') FROM meta WHERE key = ?`},
}

// refresh brings the index up to date with q and returns every referenced media ID.
// Bodies are read one per query, so through the shared pool other requests run in
// between; inside a transaction the result matches that snapshot exactly.
func (m *mediaIndex) refresh(ctx context.Context, q queryer) (map[string]bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.rows == nil {
		m.rows = map[string]indexedRefs{}
	}
	present := map[string]bool{}
	for _, src := range mediaSources {
		stale, err := m.stale(ctx, q, src.prefix, src.list, present)
		if err != nil {
			return nil, err
		}
		for _, key := range stale {
			if err := m.load(ctx, q, src.prefix, src.fetch, key); err != nil {
				return nil, err
			}
		}
	}
	refs := map[string]bool{}
	for id, row := range m.rows {
		if !present[id] {
			delete(m.rows, id)
			continue
		}
		for _, ref := range row.refs {
			refs[ref] = true
		}
	}
	return refs, nil
}

func (m *mediaIndex) stale(ctx context.Context, q queryer, prefix, list string, present map[string]bool) ([]any, error) {
	rows, err := q.QueryContext(ctx, list)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var stale []any
	for rows.Next() {
		var key any
		var version string
		if err := rows.Scan(&key, &version); err != nil {
			return nil, err
		}
		id := prefix + fmt.Sprint(key)
		present[id] = true
		if row, ok := m.rows[id]; !ok || row.version != version {
			stale = append(stale, key)
		}
	}
	return stale, rows.Err()
}

func (m *mediaIndex) load(ctx context.Context, q queryer, prefix, fetch string, key any) error {
	id := prefix + fmt.Sprint(key)
	var version, body string
	err := q.QueryRowContext(ctx, fetch, key).Scan(&version, &body)
	if errors.Is(err, sql.ErrNoRows) {
		delete(m.rows, id)
		return nil
	}
	if err != nil {
		return err
	}
	n, err := doc.Parse([]byte(body))
	if err != nil {
		return fmt.Errorf("scan asset references: %w", err)
	}
	var refs []string
	for ref := range mediaReferences(n) {
		refs = append(refs, ref)
	}
	m.rows[id] = indexedRefs{version, refs}
	return nil
}

// drawingFiles returns the image sources each registered drawing package depends on,
// reading a package only the first time it is seen.
func (m *mediaIndex) drawingFiles(ids []string, read func(id string) ([]string, error)) (map[string][]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	known := m.drawings
	m.drawings = map[string][]string{}
	for _, id := range ids {
		files, ok := known[id]
		if !ok {
			var err error
			if files, err = read(id); err != nil {
				return nil, err
			}
		}
		m.drawings[id] = files
	}
	return m.drawings, nil
}
