package store

import (
	"context"
	"database/sql"
	"errors"
	"sync"

	"github.com/Crashmere/Yuyan/internal/doc"
)

// docCounts remembers each document's character, image and node counts, so trees and totals read
// only documents written since they were last counted instead of every body on each request.
// Keyed like mediaIndex: every content write advances the revision, and the creation time
// tells a purged document's reused ID apart.
type docCounts struct {
	mu   sync.Mutex
	rows map[int64]counted
}

type counted struct {
	version              string
	chars, images, nodes int
}

const docVersion = `revision || '/' || created_at`

// HeavyEditLoad is the editing load, nodes plus characters / 100, from which the app asks before
// opening a document in the editor. Calibrated on synthetic documents (DESIGN 26.6).
const HeavyEditLoad = 40000

func (c counted) heavy() bool {
	return c.nodes+c.chars/100 >= HeavyEditLoad
}

// counts returns the counts of documents given their current versions (docVersion). Stale rows
// are read one per query, so other requests run in between. Nodes are the objects with a type,
// text included; marks and attributes may hold the same key.
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
SELECT `+docVersion+`, plain_text, count(*) FILTER (WHERE j.value = 'image'), count(*)
FROM docs, json_tree(docs.content) AS j
WHERE docs.id = ? AND j.key = 'type' AND j.path NOT LIKE '%.marks[%' AND j.path NOT LIKE '%.attrs%'
GROUP BY docs.id`, id).Scan(&c.version, &text, &c.images, &c.nodes)
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

// HeavyToEdit reports whether a live document reaches HeavyEditLoad; false when there is none.
func (s *Store) HeavyToEdit(ctx context.Context, id int64) (bool, error) {
	var version string
	err := s.DB.QueryRowContext(ctx, `SELECT `+docVersion+` FROM docs WHERE id = ? AND deleted_at IS NULL`, id).Scan(&version)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	counts, err := s.counts(ctx, map[int64]string{id: version})
	if err != nil {
		return false, err
	}
	return counts[id].heavy(), nil
}
