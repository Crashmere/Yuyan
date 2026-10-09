package store

import (
	"context"

	"github.com/Crashmere/Yuyan/internal/doc"
)

type DocumentStats struct {
	Chars     int           `json:"chars"`
	BookChars map[int64]int `json:"bookChars"`
}

// DocumentStats counts current document bodies using the same rules as reading pages and catalogs.
// Stream the existing plain text so the home page needs neither document JSON nor a migration.
func (s *Store) DocumentStats(ctx context.Context) (DocumentStats, error) {
	out := DocumentStats{BookChars: make(map[int64]int)}
	rows, err := s.DB.QueryContext(ctx, `
SELECT b.id, coalesce(d.plain_text, '') FROM books b
LEFT JOIN docs d ON d.book_id = b.id AND d.kind = 'doc' AND d.deleted_at IS NULL
WHERE b.deleted_at IS NULL`)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var bookID int64
		var text string
		if err := rows.Scan(&bookID, &text); err != nil {
			return out, err
		}
		chars := doc.CountChars(text)
		out.Chars += chars
		out.BookChars[bookID] += chars
	}
	return out, rows.Err()
}
