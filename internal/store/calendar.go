package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// CalendarPeriod is an inclusive state range. Precision records the grain at which the user
// described it; the dates remain canonical so every grain can display the same range.
type CalendarPeriod struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	Note      string `json:"note"`
	StartDate string `json:"startDate"`
	EndDate   string `json:"endDate"`
	Precision string `json:"precision"`
	Color     string `json:"color"`
	Revision  int64  `json:"revision"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type CalendarPeriodInput struct {
	Title     string `json:"title"`
	Note      string `json:"note"`
	StartDate string `json:"startDate"`
	EndDate   string `json:"endDate"`
	Precision string `json:"precision"`
	Color     string `json:"color"`
}

var calendarColors = map[string]bool{
	"emerald": true, "blue": true, "violet": true, "amber": true,
	"rose": true, "cyan": true, "slate": true, "lime": true,
}

func normalizeCalendarPeriod(in CalendarPeriodInput) (CalendarPeriodInput, error) {
	in.Title = strings.TrimSpace(in.Title)
	in.Note = strings.TrimSpace(in.Note)
	if in.Title == "" || len([]rune(in.Title)) > 120 {
		return in, fmt.Errorf("%w: 状态名称需要 1–120 个字符", ErrInvalid)
	}
	if len([]rune(in.Note)) > 2000 {
		return in, fmt.Errorf("%w: 标注不能超过 2,000 个字符", ErrInvalid)
	}
	start, err := calendarDate(in.StartDate)
	if err != nil {
		return in, fmt.Errorf("%w: 起始日期无效", ErrInvalid)
	}
	end, err := calendarDate(in.EndDate)
	if err != nil {
		return in, fmt.Errorf("%w: 结束日期无效", ErrInvalid)
	}
	if start.After(end) {
		return in, fmt.Errorf("%w: 结束日期不能早于起始日期", ErrInvalid)
	}
	if !calendarColors[in.Color] {
		return in, fmt.Errorf("%w: 状态颜色无效", ErrInvalid)
	}
	switch in.Precision {
	case "year":
		if start.Month() != time.January || start.Day() != 1 || end.Month() != time.December || end.Day() != 31 {
			return in, fmt.Errorf("%w: 年度区间需要覆盖完整年份", ErrInvalid)
		}
	case "month":
		last := time.Date(end.Year(), end.Month()+1, 0, 0, 0, 0, 0, time.UTC).Day()
		if start.Day() != 1 || end.Day() != last {
			return in, fmt.Errorf("%w: 月度区间需要覆盖完整月份", ErrInvalid)
		}
	case "day":
	default:
		return in, fmt.Errorf("%w: 时间粒度无效", ErrInvalid)
	}
	return in, nil
}

func calendarDate(value string) (time.Time, error) {
	t, err := time.Parse("2006-01-02", value)
	if err != nil || t.Format("2006-01-02") != value || t.Year() < 1000 || t.Year() > 9999 {
		return time.Time{}, errors.New("invalid calendar date")
	}
	return t, nil
}

func scanCalendarPeriod(row interface{ Scan(...any) error }) (CalendarPeriod, error) {
	var p CalendarPeriod
	err := row.Scan(&p.ID, &p.Title, &p.Note, &p.StartDate, &p.EndDate, &p.Precision, &p.Color, &p.Revision, &p.CreatedAt, &p.UpdatedAt)
	return p, err
}

const calendarPeriodColumns = `id, title, note, start_date, end_date, precision, color, revision, created_at, updated_at`

func (s *Store) CalendarPeriods(ctx context.Context) ([]CalendarPeriod, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT `+calendarPeriodColumns+` FROM calendar_periods ORDER BY start_date, end_date, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CalendarPeriod{}
	for rows.Next() {
		p, err := scanCalendarPeriod(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) CalendarPeriod(ctx context.Context, id int64) (CalendarPeriod, error) {
	p, err := scanCalendarPeriod(s.DB.QueryRowContext(ctx, `SELECT `+calendarPeriodColumns+` FROM calendar_periods WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFound
	}
	return p, err
}

func (s *Store) CreateCalendarPeriod(ctx context.Context, input CalendarPeriodInput) (CalendarPeriod, error) {
	in, err := normalizeCalendarPeriod(input)
	if err != nil {
		return CalendarPeriod{}, err
	}
	stamp := s.stamp()
	result, err := s.DB.ExecContext(ctx, `INSERT INTO calendar_periods(title, note, start_date, end_date, precision, color, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`, in.Title, in.Note, in.StartDate, in.EndDate, in.Precision, in.Color, stamp, stamp)
	if err != nil {
		return CalendarPeriod{}, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return CalendarPeriod{}, err
	}
	return s.CalendarPeriod(ctx, id)
}

func (s *Store) UpdateCalendarPeriod(ctx context.Context, id, baseRevision int64, input CalendarPeriodInput) (CalendarPeriod, error) {
	in, err := normalizeCalendarPeriod(input)
	if err != nil {
		return CalendarPeriod{}, err
	}
	result, err := s.DB.ExecContext(ctx, `UPDATE calendar_periods SET title = ?, note = ?, start_date = ?, end_date = ?, precision = ?, color = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?`, in.Title, in.Note, in.StartDate, in.EndDate, in.Precision, in.Color, s.stamp(), id, baseRevision)
	if err != nil {
		return CalendarPeriod{}, err
	}
	if n, err := result.RowsAffected(); err != nil {
		return CalendarPeriod{}, err
	} else if n == 0 {
		current, getErr := s.CalendarPeriod(ctx, id)
		if getErr != nil {
			return current, getErr
		}
		return current, ErrConflict
	}
	return s.CalendarPeriod(ctx, id)
}

func (s *Store) DeleteCalendarPeriod(ctx context.Context, id, baseRevision int64) (CalendarPeriod, error) {
	result, err := s.DB.ExecContext(ctx, `DELETE FROM calendar_periods WHERE id = ? AND revision = ?`, id, baseRevision)
	if err != nil {
		return CalendarPeriod{}, err
	}
	if n, err := result.RowsAffected(); err != nil {
		return CalendarPeriod{}, err
	} else if n == 0 {
		current, getErr := s.CalendarPeriod(ctx, id)
		if getErr != nil {
			return current, getErr
		}
		return current, ErrConflict
	}
	return CalendarPeriod{ID: id, Revision: baseRevision}, nil
}
