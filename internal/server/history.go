package server

import (
	"context"
	"sync"

	"github.com/Crashmere/Yuyan/internal/doc"
	"github.com/Crashmere/Yuyan/internal/render"
	"github.com/Crashmere/Yuyan/internal/store"
)

// history caches what is derived from snapshots. Snapshots never change and their IDs
// are never reused, so entries only need dropping when a map grows large.
type history struct {
	mu        sync.Mutex
	keys      map[int64]string
	current   map[int64]currentContent
	summaries map[summaryKey]doc.ChangeSummary
	pages     map[int64]versionPage
}

// summaryKey names a summary against the preceding snapshot (since), or against the
// current document with the given title and content key.
type summaryKey struct {
	id    int64
	since int64
	title string
	key   string
}

type currentContent struct {
	revision  int64
	updatedAt string
	key       string
}

type versionPage struct {
	render.Result
	images []string
}

// Rendered pages can be large; the other entries are a few hundred bytes at most.
const historyEntries, historyPages = 8192, 16

func remember[K comparable, V any](mu *sync.Mutex, m *map[K]V, limit int, key K, value V) {
	mu.Lock()
	defer mu.Unlock()
	if *m == nil || len(*m) >= limit {
		*m = map[K]V{}
	}
	(*m)[key] = value
}

func recall[K comparable, V any](mu *sync.Mutex, m *map[K]V, key K) (V, bool) {
	mu.Lock()
	defer mu.Unlock()
	v, ok := (*m)[key]
	return v, ok
}

// snapshots loads contents on demand and keeps the last two, all a newest-first walk
// over a history needs at a time.
type snapshots struct {
	ctx    context.Context
	store  *store.Store
	loaded []store.Version
}

func (l *snapshots) get(id int64) (store.Version, error) {
	for _, v := range l.loaded {
		if v.ID == id {
			return v, nil
		}
	}
	v, err := l.store.GetVersion(l.ctx, id)
	if err != nil {
		return v, err
	}
	if len(l.loaded) == 2 {
		l.loaded = l.loaded[1:]
	}
	l.loaded = append(l.loaded, v)
	return v, nil
}

func (s *Server) snapshotKey(v store.Version, l *snapshots) (string, error) {
	if key, ok := recall(&s.history.mu, &s.history.keys, v.ID); ok {
		return key, nil
	}
	full, err := l.get(v.ID)
	if err != nil {
		return "", err
	}
	key := doc.ContentKey(full.Content)
	remember(&s.history.mu, &s.history.keys, historyEntries, v.ID, key)
	return key, nil
}

func (s *Server) currentKey(d store.Doc) string {
	if c, ok := recall(&s.history.mu, &s.history.current, d.ID); ok && c.revision == d.Revision && c.updatedAt == d.UpdatedAt {
		return c.key
	}
	key := doc.ContentKey(d.Content)
	remember(&s.history.mu, &s.history.current, historyEntries, d.ID, currentContent{d.Revision, d.UpdatedAt, key})
	return key
}

func (s *Server) matchesCurrent(v store.Version, d store.Doc, l *snapshots) (bool, error) {
	if v.Title != d.Title {
		return false, nil
	}
	key, err := s.snapshotKey(v, l)
	return key == s.currentKey(d), err
}

func (s *Server) summary(key summaryKey, compute func() (doc.ChangeSummary, error)) (doc.ChangeSummary, error) {
	if summary, ok := recall(&s.history.mu, &s.history.summaries, key); ok {
		return summary, nil
	}
	summary, err := compute()
	if err == nil {
		remember(&s.history.mu, &s.history.summaries, historyEntries, key, summary)
	}
	return summary, err
}

func (s *Server) summaryToCurrent(v store.Version, d store.Doc, l *snapshots) (doc.ChangeSummary, error) {
	return s.summary(summaryKey{id: v.ID, title: d.Title, key: s.currentKey(d)}, func() (doc.ChangeSummary, error) {
		before, err := l.get(v.ID)
		return doc.SummarizeChanges(before.Title, before.Content, d.Title, d.Content), err
	})
}

func (s *Server) describeVersion(v store.Version, previous *store.Version, d store.Doc, l *snapshots) (versionInfo, error) {
	info := infoOf(v)
	var err error
	if info.MatchesCurrent, err = s.matchesCurrent(v, d, l); err != nil {
		return info, err
	}
	if previous == nil {
		label := "保留的最早版本"
		if v.Revision == 1 && v.Reason == "create" {
			label = "初始内容"
		}
		info.Summary = doc.ChangeSummary{Labels: []string{label}, Sections: []string{}}
		return info, nil
	}
	info.Summary, err = s.summary(summaryKey{id: v.ID, since: previous.ID}, func() (doc.ChangeSummary, error) {
		before, err := l.get(previous.ID)
		if err != nil {
			return doc.ChangeSummary{}, err
		}
		after, err := l.get(v.ID)
		return doc.SummarizeChanges(before.Title, before.Content, after.Title, after.Content), err
	})
	return info, err
}

func (s *Server) versionPage(v store.Version, l *snapshots) (versionPage, error) {
	if page, ok := recall(&s.history.mu, &s.history.pages, v.ID); ok {
		return page, nil
	}
	full, err := l.get(v.ID)
	if err != nil {
		return versionPage{}, err
	}
	page := versionPage{render.Render(full.Content, render.Options{BasePath: s.base}), doc.AssetIDs(full.Content)}
	remember(&s.history.mu, &s.history.pages, historyPages, v.ID, page)
	return page, nil
}

// recentChangeBase finds the start of the latest editing or restoring session. Autosave
// checkpoints inside it must not hide its earlier edits; histories without session
// boundaries fall back to the newest different snapshot.
func (s *Server) recentChangeBase(heads []store.Version, d store.Doc, l *snapshots) (*store.Version, error) {
	var fallback *store.Version
	for i := range heads {
		v := &heads[i]
		if v.Revision > d.Revision {
			continue
		}
		if v.Reason == "before-edit" || v.Reason == "before-restore" {
			return v, nil
		}
		same, err := s.matchesCurrent(*v, d, l)
		if err != nil {
			return nil, err
		}
		if !same {
			if fallback == nil {
				fallback = v
			}
			if v.Reason != "autosave" {
				return v, nil
			}
		}
	}
	return fallback, nil
}
