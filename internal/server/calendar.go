package server

import (
	"errors"
	"net/http"

	"github.com/Crashmere/Yuyan/internal/store"
)

func (s *Server) calendarPeriods(r *http.Request) (any, error) {
	return s.store.CalendarPeriods(r.Context())
}

type calendarPeriodWrite struct {
	store.CalendarPeriodInput
	BaseRevision int64 `json:"baseRevision"`
}

func (s *Server) apiCreateCalendarPeriod(w http.ResponseWriter, r *http.Request) error {
	var in store.CalendarPeriodInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	p, err := s.store.CreateCalendarPeriod(r.Context(), in)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, p)
	return nil
}

func (s *Server) apiUpdateCalendarPeriod(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	var in calendarPeriodWrite
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	if in.BaseRevision < 1 {
		return badRequest("baseRevision 需要是正整数")
	}
	p, err := s.store.UpdateCalendarPeriod(r.Context(), id, in.BaseRevision, in.CalendarPeriodInput)
	if errors.Is(err, store.ErrConflict) {
		return conflictError{revision: p.Revision}
	}
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, p)
	return nil
}

func (s *Server) apiDeleteCalendarPeriod(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	var in struct {
		BaseRevision int64 `json:"baseRevision"`
	}
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	if in.BaseRevision < 1 {
		return badRequest("baseRevision 需要是正整数")
	}
	p, err := s.store.DeleteCalendarPeriod(r.Context(), id, in.BaseRevision)
	if errors.Is(err, store.ErrConflict) {
		return conflictError{revision: p.Revision}
	}
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
