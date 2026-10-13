package store

import (
	"context"
	"database/sql"
)

type DocumentStats struct {
	Chars     int           `json:"chars"`
	BookChars map[int64]int `json:"bookChars"`
}

// DocumentStats counts current document bodies using the same rules as reading pages and catalogs.
// Counts come from the existing plain text through docCounts, so the home page needs neither
// document JSON nor a migration.
func (s *Store) DocumentStats(ctx context.Context) (DocumentStats, error) {
	out := DocumentStats{BookChars: make(map[int64]int)}
	rows, err := s.DB.QueryContext(ctx, `
SELECT b.id, d.id, d.revision || '/' || d.created_at FROM books b
LEFT JOIN docs d ON d.book_id = b.id AND d.kind = 'doc' AND d.deleted_at IS NULL
WHERE b.deleted_at IS NULL`)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	bookOf := map[int64]int64{}
	versions := map[int64]string{}
	for rows.Next() {
		var bookID int64
		var docID sql.NullInt64
		var version sql.NullString
		if err := rows.Scan(&bookID, &docID, &version); err != nil {
			return out, err
		}
		out.BookChars[bookID] += 0
		if docID.Valid {
			bookOf[docID.Int64], versions[docID.Int64] = bookID, version.String
		}
	}
	if err := rows.Err(); err != nil {
		return out, err
	}
	counts, err := s.counts(ctx, versions)
	if err != nil {
		return out, err
	}
	for id, bookID := range bookOf {
		out.Chars += counts[id].chars
		out.BookChars[bookID] += counts[id].chars
	}
	return out, nil
}
