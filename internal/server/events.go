package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/Crashmere/Yuyan/internal/store"
)

const (
	maxEventSubscribers = 64
	eventHeartbeat      = 25 * time.Second
	eventWriteTimeout   = 15 * time.Second
	clientHeader        = "X-Yuyan-Client"
)

type docEvent struct {
	DocID     int64  `json:"docId"`
	Revision  int64  `json:"revision"`
	UpdatedAt string `json:"updatedAt,omitempty"`
	Kind      string `json:"kind"`
	Source    string `json:"source,omitempty"`
}

type eventHub struct {
	mu      sync.Mutex
	closed  bool
	done    chan struct{}
	total   int
	docSubs map[int64]map[chan docEvent]struct{}
}

func newEventHub() *eventHub {
	return &eventHub{
		done:    make(chan struct{}),
		docSubs: map[int64]map[chan docEvent]struct{}{},
	}
}

func (h *eventHub) close() {
	h.mu.Lock()
	if !h.closed {
		h.closed = true
		close(h.done)
	}
	h.mu.Unlock()
}

func (h *eventHub) subscribe(docID int64) (chan docEvent, func(), bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed || h.total >= maxEventSubscribers {
		return nil, nil, false
	}
	ch := make(chan docEvent, 4)
	subs := h.docSubs[docID]
	if subs == nil {
		subs = map[chan docEvent]struct{}{}
		h.docSubs[docID] = subs
	}
	subs[ch] = struct{}{}
	h.total++
	var once sync.Once
	return ch, func() {
		once.Do(func() {
			h.mu.Lock()
			if subs := h.docSubs[docID]; subs != nil {
				if _, ok := subs[ch]; ok {
					delete(subs, ch)
					h.total--
					if len(subs) == 0 {
						delete(h.docSubs, docID)
					}
				}
			}
			h.mu.Unlock()
		})
	}, true
}

func (h *eventHub) publish(ev docEvent) {
	h.mu.Lock()
	for ch := range h.docSubs[ev.DocID] {
		select {
		case ch <- ev:
		default:
			select {
			case <-ch:
			default:
			}
			select {
			case ch <- ev:
			default:
			}
		}
	}
	h.mu.Unlock()
}

func (h *eventHub) subscribedIDs() []int64 {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.docSubs) == 0 {
		return nil
	}
	ids := make([]int64, 0, len(h.docSubs))
	for id := range h.docSubs {
		ids = append(ids, id)
	}
	return ids
}

func clientID(r *http.Request) string {
	id := strings.TrimSpace(r.Header.Get(clientHeader))
	if id == "" || len(id) > 64 {
		return ""
	}
	for i := range len(id) {
		c := id[i]
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.') {
			return ""
		}
	}
	return id
}

// CloseEvents stops active document-event streams so graceful HTTP shutdown does not wait for idle clients.
func (s *Server) CloseEvents() {
	if s.events != nil {
		s.events.close()
	}
}

func (s *Server) notifyDocUpdated(r *http.Request, docID, revision int64, updatedAt string) {
	s.events.publish(docEvent{
		DocID:     docID,
		Revision:  revision,
		UpdatedAt: updatedAt,
		Kind:      "updated",
		Source:    clientID(r),
	})
}

func (s *Server) notifySubscribedDeletes(ctx context.Context, r *http.Request) {
	ids := s.events.subscribedIDs()
	if len(ids) == 0 {
		return
	}
	source := clientID(r)
	for _, id := range ids {
		d, err := s.store.GetDocMeta(ctx, id)
		if errors.Is(err, store.ErrNotFound) || (err == nil && d.DeletedAt != "") {
			s.events.publish(docEvent{DocID: id, Kind: "deleted", Source: source})
		}
	}
}

// apiDocEvents streams lightweight revision/deletion notifications for a single document over SSE.
// Subscribers always receive an initial state snapshot immediately on connect/reconnect, so events
// missed across network drops or server restarts are recovered automatically.
func (s *Server) apiDocEvents(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeError(w, err)
		return
	}
	// Subscribe before reading metadata so a save committed during the read is queued rather than missed.
	ch, unsubscribe, ok := s.events.subscribe(id)
	if !ok {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "unavailable", Message: "实时更新连接数已达上限"})
		return
	}
	defer unsubscribe()

	var initial docEvent
	d, err := s.store.GetDocMeta(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) || (err == nil && d.DeletedAt != "") {
		initial = docEvent{DocID: id, Kind: "deleted"}
	} else if err != nil {
		writeError(w, err)
		return
	} else {
		initial = docEvent{DocID: d.ID, Revision: d.Revision, UpdatedAt: d.UpdatedAt, Kind: "sync"}
	}

	control := http.NewResponseController(w)
	_ = control.SetWriteDeadline(time.Time{})

	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	writeFrame := func(frame string) error {
		_ = control.SetWriteDeadline(time.Now().Add(eventWriteTimeout))
		if _, err := fmt.Fprint(w, frame); err != nil {
			return err
		}
		if err := control.Flush(); err != nil && !errors.Is(err, http.ErrNotSupported) {
			return err
		}
		_ = control.SetWriteDeadline(time.Time{})
		return nil
	}
	writeEvent := func(ev docEvent) error {
		data, err := json.Marshal(ev)
		if err != nil {
			return err
		}
		return writeFrame("event: doc\ndata: " + string(data) + "\n\n")
	}

	if err := writeFrame("retry: 3000\n\n"); err != nil {
		return
	}
	if err := writeEvent(initial); err != nil || initial.Kind == "deleted" {
		return
	}

	ticker := time.NewTicker(eventHeartbeat)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-s.events.done:
			return
		case ev := <-ch:
			if err := writeEvent(ev); err != nil || ev.Kind == "deleted" {
				return
			}
		case <-ticker.C:
			if err := writeFrame(": ping\n\n"); err != nil {
				return
			}
		}
	}
}
