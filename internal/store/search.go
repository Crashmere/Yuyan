package store

import (
	"context"
	"slices"
	"strconv"
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

// maxSearchTerms bounds the work of one search; words after it are ignored.
const maxSearchTerms = 10

// Search does a case-insensitive substring match over titles and text for each space-separated
// word of q: a document matches when every word is in its title or its text. Documents with more
// of the words in the title come first. The corpus is only a few MiB, so a scan is fast and needs
// no Chinese word segmentation.
func (s *Store) Search(ctx context.Context, q string, limit int) ([]SearchHit, error) {
	terms := searchTerms(q)
	if len(terms) == 0 {
		return nil, nil
	}
	titled, matched := make([]string, len(terms)), make([]string, len(terms))
	args := make([]any, 0, len(terms)+1)
	for i, term := range terms {
		n := strconv.Itoa(i + 1)
		titled[i] = "(instr(lower(d.title), ?" + n + ") > 0)"
		matched[i] = "(instr(lower(d.title), ?" + n + ") > 0 OR instr(lower(d.plain_text), ?" + n + ") > 0)"
		args = append(args, term)
	}
	rows, err := s.DB.QueryContext(ctx, `
SELECT d.id, d.book_id, b.name, d.title, d.plain_text
FROM docs d JOIN books b ON b.id = d.book_id
WHERE d.deleted_at IS NULL AND b.deleted_at IS NULL AND d.kind = 'doc'
  AND `+strings.Join(matched, " AND ")+`
ORDER BY `+strings.Join(titled, " + ")+` DESC, d.updated_at DESC LIMIT ?`+strconv.Itoa(len(terms)+1), append(args, limit)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SearchHit
	for rows.Next() {
		var h SearchHit
		var text string
		if err := rows.Scan(&h.ID, &h.BookID, &h.BookName, &h.Title, &text); err != nil {
			return nil, err
		}
		h.Snippet = snippet(text, terms, 60)
		out = append(out, h)
	}
	return out, rows.Err()
}

// searchTerms splits q at spaces into its distinct words, folded as the search compares them.
func searchTerms(q string) []string {
	var terms []string
	for _, term := range strings.Fields(foldASCII(q)) {
		if len(terms) < maxSearchTerms && !slices.Contains(terms, term) {
			terms = append(terms, term)
		}
	}
	return terms
}

// foldASCII lower-cases ASCII letters only, as SQLite's lower() does, so offsets in the result are
// offsets in s.
func foldASCII(s string) string {
	b := []byte(s)
	for i, c := range b {
		if 'A' <= c && c <= 'Z' {
			b[i] = c + 'a' - 'A'
		}
	}
	return string(b)
}

// snippet returns the text around the first place any of terms appears in it.
func snippet(text string, terms []string, radius int) string {
	folded := foldASCII(text)
	i, n := -1, 0
	for _, term := range terms {
		if j := strings.Index(folded, term); j >= 0 && (i < 0 || j < i) {
			i, n = j, len(term)
		}
	}
	if i < 0 {
		return truncateRunes(text, radius*2)
	}
	start := i
	for k := 0; start > 0 && k < radius; k++ {
		_, size := utf8.DecodeLastRuneInString(text[:start])
		start -= size
	}
	end := i + n
	for k := 0; end < len(text) && k < radius; k++ {
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
