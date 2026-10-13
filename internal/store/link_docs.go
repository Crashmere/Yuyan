package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/Crashmere/Yuyan/internal/doc"
)

// Live documents, excluding those in the trash and those of knowledge bases in the trash.
const liveLinkDocs = `FROM docs d JOIN books b ON b.id = d.book_id WHERE d.deleted_at IS NULL AND b.deleted_at IS NULL AND d.kind = 'doc'`

// LinkDoc is a live document as the link picker lists it, without its body. Version changes
// with every write of the body, as in docCounts.
type LinkDoc struct {
	ID       int64
	BookName string
	Title    string
	Version  string
}

// LiveLinkDocs lists the live documents, most recently updated first.
func (s *Store) LiveLinkDocs(ctx context.Context) ([]LinkDoc, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT d.id, b.name, d.title, d.revision || '/' || d.created_at `+liveLinkDocs+` ORDER BY d.updated_at DESC, d.id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LinkDoc{}
	for rows.Next() {
		var d LinkDoc
		if err := rows.Scan(&d.ID, &d.BookName, &d.Title, &d.Version); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// DocBody reads a document's body with its version.
func (s *Store) DocBody(ctx context.Context, id int64) (string, doc.Node, error) {
	var version, data string
	err := s.DB.QueryRowContext(ctx, `SELECT `+docVersion+`, content FROM docs WHERE id = ?`, id).Scan(&version, &data)
	if errors.Is(err, sql.ErrNoRows) {
		return "", doc.Node{}, ErrNotFound
	}
	if err != nil {
		return "", doc.Node{}, err
	}
	n, err := doc.Parse([]byte(data))
	return version, n, err
}

// LinkingDocs reads the live documents whose stored body contains any of texts, most recently
// updated first. Finish the single SQLite query before callers perform other store operations.
func (s *Store) LinkingDocs(ctx context.Context, texts ...string) ([]Doc, error) {
	match, args := make([]string, len(texts)), make([]any, len(texts))
	for i, t := range texts {
		match[i], args[i] = "instr(d.content, ?) > 0", t
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT d.id, d.book_id, b.name, d.title, d.content `+liveLinkDocs+` AND (`+strings.Join(match, " OR ")+`) ORDER BY d.updated_at DESC, d.id DESC`, args...)
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
