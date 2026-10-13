package store

import (
	"context"
	"database/sql"
	"errors"
	"sync"

	"github.com/Crashmere/Yuyan/internal/doc"
)

// docCounts remembers each document's character and image counts, so trees and totals read
// only documents written since they were last counted instead of every body on each request.
// Keyed like mediaIndex: every content write advances the revision, and the creation time
// tells a purged document's reused ID apart.
type docCounts struct {
	mu   sync.Mutex
	rows map[int64]counted
}

type counted struct {
	version       string
	chars, images int
}

const docVersion = `revision || '/' || created_at`

// counts returns the counts of documents given their current versions (docVersion). Stale rows
// are read one per query, so other requests run in between.
func (s *Store) counts(ctx context.Context, versions map[int64]string) (map[int64]counted, error) {
	out := make(map[int64]counted, len(versions))
	var stale []int64
	s.docCounts.mu.Lock()
	for id, v := range versions {
		if c, ok := s.docCounts.rows[id]; ok && c.version == v {
			out[id] = c
		} else {
			stale = append(stale, id)
		}
	}
	s.docCounts.mu.Unlock()
	for _, id := range stale {
		var c counted
		var text string
		err := s.DB.QueryRowContext(ctx, `
SELECT `+docVersion+`, plain_text, (SELECT count(*) FROM json_tree(docs.content) WHERE key = 'type' AND value = 'image')
FROM docs WHERE id = ?`, id).Scan(&c.version, &text, &c.images)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, err
		}
		c.chars = doc.CountChars(text)
		out[id] = c
		s.docCounts.mu.Lock()
		if s.docCounts.rows == nil {
			s.docCounts.rows = map[int64]counted{}
		}
		s.docCounts.rows[id] = c
		s.docCounts.mu.Unlock()
	}
	return out, nil
}
