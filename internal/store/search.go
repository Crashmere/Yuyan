package store

import (
	"cmp"
	"context"
	"slices"
	"strings"
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
// of the words in the title come first, then the most recently updated. Substring matching needs
// no Chinese word segmentation; the text is scanned in memory (searchIndex).
func (s *Store) Search(ctx context.Context, q string, limit int) ([]SearchHit, error) {
	terms := searchTerms(q)
	if len(terms) == 0 {
		return nil, nil
	}
	s.search.mu.Lock()
	defer s.search.mu.Unlock()
	docs, err := s.search.refresh(ctx, s.DB)
	if err != nil {
		return nil, err
	}
	type match struct {
		searchDoc
		titled int
	}
	var found []match
	for _, d := range docs {
		title, titled := foldASCII(d.title), 0
		for _, term := range terms {
			if strings.Contains(title, term) {
				titled++
			} else if !strings.Contains(d.text.folded, term) {
				titled = -1
				break
			}
		}
		if titled >= 0 {
			found = append(found, match{d, titled})
		}
	}
	slices.SortFunc(found, func(a, b match) int {
		return cmp.Or(cmp.Compare(b.titled, a.titled), strings.Compare(b.updatedAt, a.updatedAt), cmp.Compare(b.id, a.id))
	})
	out := make([]SearchHit, 0, min(len(found), limit))
	for _, m := range found[:min(len(found), limit)] {
		out = append(out, SearchHit{ID: m.id, BookID: m.bookID, BookName: m.bookName, Title: m.title, Snippet: m.text.snippet(terms, 60)})
	}
	return out, nil
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
