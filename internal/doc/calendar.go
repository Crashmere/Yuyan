package doc

import (
	"encoding/json"
	"errors"
	"strings"
	"time"
)

type CalendarPeriod struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	Note      string `json:"note"`
	StartDate string `json:"startDate"`
	EndDate   string `json:"endDate"`
	Precision string `json:"precision"`
	Color     string `json:"color"`
}

type Calendar struct {
	Version int              `json:"version"`
	Title   string           `json:"title"`
	Grain   string           `json:"grain"`
	Center  string           `json:"center"`
	Periods []CalendarPeriod `json:"periods"`
}

func CalendarData(n Node) (Calendar, error) {
	var c Calendar
	data, err := json.Marshal(n.Attrs)
	if err != nil {
		return c, err
	}
	err = json.Unmarshal(data, &c)
	if err != nil {
		return c, err
	}
	invalid := errors.New("invalid calendar")
	for _, key := range []string{"title", "center"} {
		if _, ok := n.Attrs[key].(string); !ok {
			return c, invalid
		}
	}
	rows, ok := n.Attrs["periods"].([]any)
	if !ok {
		return c, invalid
	}
	for _, row := range rows {
		fields, ok := row.(map[string]any)
		if !ok {
			return c, invalid
		}
		for _, key := range []string{"title", "note", "startDate", "endDate", "precision", "color"} {
			if _, ok := fields[key].(string); !ok {
				return c, invalid
			}
		}
	}
	grain := func(value string) bool { return value == "year" || value == "month" || value == "day" }
	date := func(value string) (time.Time, bool) {
		d, err := time.Parse("2006-01-02", value)
		return d, err == nil && d.Format("2006-01-02") == value && d.Year() >= 1000 && d.Year() <= 9999
	}
	if len(n.Content) != 0 || len(n.Marks) != 0 || c.Version != 1 || len([]rune(c.Title)) > 120 || !grain(c.Grain) || c.Periods == nil || len(c.Periods) > 2000 {
		return c, invalid
	}
	if _, ok := date(c.Center); c.Center != "" && !ok {
		return c, invalid
	}
	ids := make(map[int64]bool)
	for _, p := range c.Periods {
		start, validStart := date(p.StartDate)
		end, validEnd := date(p.EndDate)
		if p.ID < 1 || p.ID > 9007199254740991 || ids[p.ID] || strings.TrimSpace(p.Title) == "" || len([]rune(p.Title)) > 120 || len([]rune(p.Note)) > 2000 || !validStart || !validEnd || p.StartDate > p.EndDate || !grain(p.Precision) {
			return c, invalid
		}
		ids[p.ID] = true
		switch p.Color {
		case "emerald", "blue", "violet", "amber", "rose", "cyan", "slate", "lime":
		default:
			return c, invalid
		}
		if p.Precision == "year" && (start.Month() != time.January || start.Day() != 1 || end.Month() != time.December || end.Day() != 31) {
			return c, invalid
		}
		if p.Precision == "month" && (start.Day() != 1 || end.AddDate(0, 0, 1).Day() != 1) {
			return c, invalid
		}
	}
	return c, nil
}

func CalendarText(n Node) string {
	c, _ := CalendarData(n)
	var b strings.Builder
	b.WriteString(c.Title + "\n")
	for _, p := range c.Periods {
		b.WriteString(p.Title + " " + p.StartDate + " – " + p.EndDate + "\n" + p.Note + "\n")
	}
	return b.String()
}
