package store

import (
	"context"

	"github.com/Crashmere/Yuyan/internal/doc"
)

type DocumentStats struct {
	Chars int `json:"chars"`
}

// DocumentStats counts current document bodies using the same rules as reading pages and catalogs.
// Stream the existing plain text so the home page needs neither document JSON nor a migration.
func (s *Store) DocumentStats(ctx context.Context) (DocumentStats, error) {
	var out DocumentStats
	rows, err := s.DB.QueryContext(ctx, `
SELECT d.plain_text FROM docs d JOIN books b ON b.id = d.book_id
WHERE d.kind = 'doc' AND d.deleted_at IS NULL AND b.deleted_at IS NULL`)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var text string
		if err := rows.Scan(&text); err != nil {
			return out, err
		}
		out.Chars += doc.CountChars(text)
	}
	return out, rows.Err()
}
