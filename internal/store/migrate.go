package store

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"slices"
	"strconv"
	"strings"
	"time"
)

// migrations change the table layout of existing databases, in order. Each step runs in one
// transaction together with the new meta.layout and commits only after a foreign key check, so a
// failure leaves the previous layout and all data as they were. Databases created before the first
// step have no meta.layout and count as layout 1; Init creates the latest layout directly.
//
// meta.min_layout is the oldest program layout that can still use the database. Steps that programs
// of earlier layouts keep working on leave it alone, so a deployment can put the previous program
// back after migrating. A step that breaks them sets breaksOlder, which raises min_layout to that
// step; programs whose last step is older then refuse to open the database.
var migrations = []migration{
	{layout: 2, name: "docs and doc_versions keep large columns last", run: largeColumnsLast},
	// Layout 3 introduced the retired standalone calendar. Earlier layouts can skip its creation.
	{layout: 4, name: "remove standalone calendar periods", breaksOlder: true, run: removeCalendarPeriods},
}

var currentLayout = migrations[len(migrations)-1].layout

type migration struct {
	layout      int
	name        string
	breaksOlder bool
	run         func(context.Context, *sql.Tx) error
}

// minLayoutFor returns the oldest program layout that can use a database at layout.
func minLayoutFor(layout int) int {
	n := 1
	for _, m := range migrations {
		if m.breaksOlder && m.layout <= layout {
			n = m.layout
		}
	}
	return n
}

func setLayout(ctx context.Context, tx *sql.Tx, layout int) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO meta(key, value) VALUES ('layout', ?), ('min_layout', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, strconv.Itoa(layout), strconv.Itoa(minLayoutFor(layout)))
	return err
}

// MigrationPlan is the layout of a database and the steps Open would apply to it.
type MigrationPlan struct {
	From  int      `json:"from"`
	To    int      `json:"to"`
	Steps []string `json:"steps"`
}

// PlanMigrations reports the pending steps for the database in dir without changing it.
func PlanMigrations(dir string) (MigrationPlan, error) {
	s, err := OpenAsIs(dir)
	if err != nil {
		return MigrationPlan{}, err
	}
	defer s.Close()
	from, _, err := readLayout(context.Background(), s.DB)
	if err != nil {
		return MigrationPlan{}, err
	}
	plan := MigrationPlan{From: from, To: currentLayout, Steps: []string{}}
	for _, m := range migrations {
		if m.layout > from {
			plan.Steps = append(plan.Steps, m.name)
		}
	}
	return plan, nil
}

func readLayout(ctx context.Context, db *sql.DB) (layout, minLayout int, err error) {
	rows, err := db.QueryContext(ctx, `SELECT key, value FROM meta WHERE key IN ('layout', 'min_layout')`)
	if err != nil {
		return 0, 0, fmt.Errorf("read database layout: %w", err)
	}
	defer rows.Close()
	layout, minLayout = 1, 1
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return 0, 0, err
		}
		n, err := strconv.Atoi(value)
		if err != nil || n < 1 {
			return 0, 0, fmt.Errorf("invalid database %s %q", key, value)
		}
		if key == "layout" {
			layout = n
		} else {
			minLayout = n
		}
	}
	return layout, minLayout, rows.Err()
}

// migrate applies the steps after layout from on one connection with foreign keys off: rebuilding a
// table drops the old one, which enforcement would refuse, and the pragma does nothing inside a
// transaction. Afterwards the write-ahead log, as large as the rebuilt tables, is truncated.
func migrate(ctx context.Context, db *sql.DB, from int) (err error) {
	conn, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, `PRAGMA foreign_keys = OFF`); err != nil {
		return err
	}
	defer func() {
		if _, e := conn.ExecContext(context.Background(), `PRAGMA foreign_keys = ON`); e != nil && err == nil {
			err = fmt.Errorf("re-enable foreign keys: %w", e)
		}
	}()
	if err := foreignKeyCheck(ctx, conn); err != nil {
		return fmt.Errorf("database is inconsistent before migrating: %w", err)
	}
	for _, m := range migrations {
		if m.layout <= from {
			continue
		}
		start := time.Now()
		if err := migrateStep(ctx, conn, m); err != nil {
			return fmt.Errorf("migrate database to layout %d (%s): %w", m.layout, m.name, err)
		}
		slog.Info("migrated database", "layout", m.layout, "step", m.name, "duration", time.Since(start).Round(time.Millisecond))
	}
	_, err = conn.ExecContext(ctx, `PRAGMA wal_checkpoint(TRUNCATE)`)
	return err
}

func migrateStep(ctx context.Context, conn *sql.Conn, m migration) error {
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := m.run(ctx, tx); err != nil {
		return err
	}
	if err := foreignKeyCheck(ctx, tx); err != nil {
		return err
	}
	if err := setLayout(ctx, tx, m.layout); err != nil {
		return err
	}
	return tx.Commit()
}

func foreignKeyCheck(ctx context.Context, db interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}) error {
	rows, err := db.QueryContext(ctx, `PRAGMA foreign_key_check`)
	if err != nil {
		return err
	}
	defer rows.Close()
	if rows.Next() {
		var table, parent string
		var rowid sql.NullInt64
		var fk int
		if err := rows.Scan(&table, &rowid, &parent, &fk); err != nil {
			return err
		}
		return fmt.Errorf("row %d of %s refers to a missing row of %s", rowid.Int64, table, parent)
	}
	return rows.Err()
}

// largeColumnsLast rebuilds docs and doc_versions into their current definitions: every row, id and
// index stays, only the column order on disk changes. Programs from before name every column, so
// they still run on the new layout.
func largeColumnsLast(ctx context.Context, tx *sql.Tx) error {
	if err := rebuildTable(ctx, tx, "docs", docsTable, docsIndexes); err != nil {
		return err
	}
	return rebuildTable(ctx, tx, "doc_versions", docVersionsTable, docVersionsIndexes)
}

func removeCalendarPeriods(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx, `DROP TABLE IF EXISTS calendar_periods`)
	return err
}

// rebuildTable recreates table name from its definition and indexes, the procedure SQLite documents
// for changes ALTER TABLE cannot make. Every existing column must remain and is copied by name;
// columns new in the definition take their defaults.
func rebuildTable(ctx context.Context, tx *sql.Tx, name, definition, indexes string) error {
	tmp := "new_" + name
	create := strings.Replace(definition, "CREATE TABLE "+name+" (", "CREATE TABLE "+tmp+" (", 1)
	if create == definition {
		return fmt.Errorf("definition of %s does not create it", name)
	}
	old, err := tableColumns(ctx, tx, name)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, create); err != nil {
		return err
	}
	cols, err := tableColumns(ctx, tx, tmp)
	if err != nil {
		return err
	}
	for _, c := range old {
		if !slices.Contains(cols, c) {
			return fmt.Errorf("rebuilding %s would drop column %s", name, c)
		}
	}
	list := `"` + strings.Join(old, `", "`) + `"`
	res, err := tx.ExecContext(ctx, `INSERT INTO `+tmp+` (`+list+`) SELECT `+list+` FROM `+name)
	if err != nil {
		return err
	}
	copied, err := res.RowsAffected()
	if err != nil {
		return err
	}
	var rows int64
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM `+name).Scan(&rows); err != nil {
		return err
	}
	if copied != rows {
		return fmt.Errorf("copied %d of %d rows of %s", copied, rows, name)
	}
	for _, q := range []string{`DROP TABLE ` + name, `ALTER TABLE ` + tmp + ` RENAME TO ` + name, indexes} {
		if _, err := tx.ExecContext(ctx, q); err != nil {
			return err
		}
	}
	return nil
}

func tableColumns(ctx context.Context, tx *sql.Tx, table string) ([]string, error) {
	rows, err := tx.QueryContext(ctx, `SELECT name FROM pragma_table_info(?) ORDER BY cid`, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var cols []string
	for rows.Next() {
		var c string
		if err := rows.Scan(&c); err != nil {
			return nil, err
		}
		cols = append(cols, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(cols) == 0 {
		return nil, fmt.Errorf("table %s not found", table)
	}
	return cols, nil
}
