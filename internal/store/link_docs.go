package store

import (
	"context"
	"github.com/Crashmere/Yuyan/internal/doc"
)

// LiveLinkDocs reads only live documents, including the knowledge base's trash state.
// Finish the single SQLite query before callers perform other store operations.
func (s *Store) LiveLinkDocs(ctx context.Context) ([]Doc, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT d.id, d.book_id, b.name, d.title, d.content FROM docs d JOIN books b ON b.id = d.book_id WHERE d.deleted_at IS NULL AND b.deleted_at IS NULL AND d.kind = 'doc' ORDER BY d.updated_at DESC, d.id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Doc{}
	for rows.Next() {
		var d Doc
		var data string
		if err := rows.Scan(&d.ID, &d.BookID, &d.BookName, &d.Title, &data); err != nil {
			return nil, err
		}
		d.Content, err = doc.Parse([]byte(data))
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}
