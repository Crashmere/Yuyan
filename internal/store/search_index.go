package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"
)

// searchIndex holds the plain text of every live document, so a search scans memory instead of
// reading and lower-casing every body in SQLite. Text is keyed like docCounts: every content write
// advances the revision, and the creation time tells a purged document's reused ID apart. What can
// change without a new revision (book, deletion, the book's name) is read with each search.
type searchIndex struct {
	mu   sync.Mutex
	rows map[int64]*searchText
}

// searchText is a document's plain text with ASCII letters lower-cased, as search compares it, and
// one bit per byte marking the letters that were upper case, which together restore the original.
type searchText struct {
	version string
	folded  string
	upper   []uint64 // nil when no letter was upper case
}

// searchDoc is a live document as a search sees it.
type searchDoc struct {
	id, bookID                 int64
	bookName, title, updatedAt string
	text                       *searchText
}

func newSearchText(version, text string) *searchText {
	t := &searchText{version: version, folded: text}
	var b []byte
	for i := 0; i < len(text); i++ {
		if c := text[i]; 'A' <= c && c <= 'Z' {
			if b == nil {
				b = []byte(text)
				t.upper = make([]uint64, (len(text)+63)/64)
			}
			b[i] = c + 'a' - 'A'
			t.upper[i/64] |= 1 << (i % 64)
		}
	}
	if b != nil {
		t.folded = string(b)
	}
	return t
}

func (t *searchText) isUpper(i int) bool {
	return t.upper != nil && t.upper[i/64]>>(i%64)&1 != 0
}

// original returns bytes start to end of the text as stored.
func (t *searchText) original(start, end int) string {
	s := t.folded[start:end]
	var b []byte
	for i := start; t.upper != nil && i < end; i++ {
		if t.isUpper(i) {
			if b == nil {
				b = []byte(s)
			}
			b[i-start] -= 'a' - 'A'
		}
	}
	if b == nil {
		return s
	}
	return string(b)
}

func (t *searchText) bytes() int {
	return len(t.folded) + 8*len(t.upper)
}

// snippet returns the text around the first place any of terms appears in it, or its beginning.
func (t *searchText) snippet(terms []string, radius int) string {
	text := t.folded
	i, n := -1, 0
	for _, term := range terms {
		if j := strings.Index(text, term); j >= 0 && (i < 0 || j < i) {
			i, n = j, len(term)
		}
	}
	if i < 0 {
		return t.leading(radius * 2)
	}
	// Folding changes only single-byte letters, so characters span the same bytes in both texts.
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
	out := strings.Join(strings.Fields(t.original(start, end)), " ")
	if start > 0 {
		out = "…" + out
	}
	if end < len(text) {
		out += "…"
	}
	return out
}

// leading returns the first n characters of the text with each run of white space made one space
// and the ends trimmed, followed by "…" when more follows. It reads only as far as it needs.
func (t *searchText) leading(n int) string {
	var out strings.Builder
	count, space := 0, false
	for i := 0; i < len(t.folded); {
		r, size := utf8.DecodeRuneInString(t.folded[i:])
		if unicode.IsSpace(r) {
			space = count > 0
			i += size
			continue
		}
		if space {
			if count == n {
				return out.String() + "…"
			}
			out.WriteByte(' ')
			count, space = count+1, false
		}
		if count == n {
			return out.String() + "…"
		}
		out.WriteString(t.original(i, i+size))
		count++
		i += size
	}
	return out.String()
}

// refresh returns the live documents with their text, reading again the text of each document
// whose revision changed and forgetting the documents no longer live. The caller holds mu. Texts
// are read one per query, so through the shared pool other requests run in between.
func (x *searchIndex) refresh(ctx context.Context, db *sql.DB) ([]searchDoc, error) {
	rows, err := db.QueryContext(ctx, `
SELECT d.id, d.book_id, b.name, d.title, d.updated_at, d.revision || '/' || d.created_at
FROM docs d JOIN books b ON b.id = d.book_id
WHERE d.deleted_at IS NULL AND b.deleted_at IS NULL AND d.kind = 'doc'`)
	if err != nil {
		return nil, err
	}
	var docs []searchDoc
	var versions []string
	for rows.Next() {
		var d searchDoc
		var version string
		if err := rows.Scan(&d.id, &d.bookID, &d.bookName, &d.title, &d.updatedAt, &version); err != nil {
			rows.Close()
			return nil, err
		}
		docs, versions = append(docs, d), append(versions, version)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if x.rows == nil {
		x.rows = map[int64]*searchText{}
	}
	live := make(map[int64]bool, len(docs))
	out := docs[:0]
	for i, d := range docs {
		live[d.id] = true
		t := x.rows[d.id]
		if t == nil || t.version != versions[i] {
			var version, text string
			err := db.QueryRowContext(ctx, `SELECT `+docVersion+`, plain_text FROM docs WHERE id = ?`, d.id).Scan(&version, &text)
			if errors.Is(err, sql.ErrNoRows) {
				delete(x.rows, d.id) // Purged since the listing.
				continue
			}
			if err != nil {
				return nil, err
			}
			t = newSearchText(version, text)
			x.rows[d.id] = t
		}
		d.text = t
		out = append(out, d)
	}
	for id := range x.rows {
		if !live[id] {
			delete(x.rows, id)
		}
	}
	return out, nil
}

// WarmSearch builds the search index, so the first search after a start does not. It returns the
// number of documents and the bytes the index holds.
func (s *Store) WarmSearch(ctx context.Context) (docs, bytes int, err error) {
	s.search.mu.Lock()
	defer s.search.mu.Unlock()
	list, err := s.search.refresh(ctx, s.DB)
	for _, d := range list {
		bytes += d.text.bytes()
	}
	return len(list), bytes, err
}
