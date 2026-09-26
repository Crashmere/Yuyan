package store

import (
	"context"
	"strings"
	"unicode/utf8"
)

type SearchHit struct {
	ID       int64  `json:"id"`
	BookID   int64  `json:"bookId"`
	BookName string `json:"bookName"`
	Title    string `json:"title"`
	Snippet  string `json:"snippet"`
}

// Search does a case-insensitive substring match over titles and text. The corpus is only a few
// MiB, so a scan is fast and needs no Chinese word segmentation.
func (s *Store) Search(ctx context.Context, q string, limit int) ([]SearchHit, error) {
	q = strings.TrimSpace(q)
	if q == "" {
		return nil, nil
	}
	rows, err := s.DB.QueryContext(ctx, `
SELECT d.id, d.book_id, b.name, d.title, d.plain_text,
       instr(lower(d.title), lower(?1)) > 0 AS title_hit
FROM docs d JOIN books b ON b.id = d.book_id
WHERE d.deleted_at IS NULL AND b.deleted_at IS NULL AND d.kind = 'doc'
  AND (instr(lower(d.title), lower(?1)) > 0 OR instr(lower(d.plain_text), lower(?1)) > 0)
ORDER BY title_hit DESC, d.updated_at DESC LIMIT ?2`, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SearchHit
	for rows.Next() {
		var h SearchHit
		var text string
		var titleHit bool
		if err := rows.Scan(&h.ID, &h.BookID, &h.BookName, &h.Title, &text, &titleHit); err != nil {
			return nil, err
		}
		h.Snippet = snippet(text, q, 60)
		out = append(out, h)
	}
	return out, rows.Err()
}

func snippet(text, q string, radius int) string {
	lower := strings.ToLower(text)
	i := strings.Index(lower, strings.ToLower(q))
	if i < 0 {
		return truncateRunes(text, radius*2)
	}
	start := i
	for n := 0; start > 0 && n < radius; n++ {
		_, size := utf8.DecodeLastRuneInString(text[:start])
		start -= size
	}
	end := i + len(q)
	for n := 0; end < len(text) && n < radius; n++ {
		_, size := utf8.DecodeRuneInString(text[end:])
		end += size
	}
	out := strings.Join(strings.Fields(text[start:end]), " ")
	if start > 0 {
		out = "…" + out
	}
	if end < len(text) {
		out += "…"
	}
	return out
}

func truncateRunes(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return string(r[:n]) + "…"
}
