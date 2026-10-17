// Package store keeps knowledge bases, documents, versions and images in SQLite plus files.
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/Crashmere/Yuyan/internal/doc"
	_ "modernc.org/sqlite"
)

const dbFile = "yuyan.db"

var (
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("revision conflict")
	ErrInvalid  = errors.New("invalid request")
)

type Store struct {
	DB        *sql.DB
	dir       string
	now       func() time.Time
	media     mediaIndex
	docCounts docCounts
	search    searchIndex
	sessions  sessionStarts
}

// Columns holding whole documents come last. SQLite stores a row's columns in order and continues a
// long row on overflow pages, so reading any column after a large one walks through all of it;
// listing, counting and filtering need only the small columns. plain_text precedes content because
// search scans it on every query, while only backlinks scan content. Init creates these definitions
// and migrations rebuild older tables into them, so both always agree (migrate.go).
const docsTable = `CREATE TABLE docs (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL REFERENCES books(id),
  parent_id INTEGER REFERENCES docs(id),
  position INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL CHECK (kind IN ('doc', 'group')),
  title TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  source_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  plain_text TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL
)`

const docsIndexes = `
CREATE INDEX docs_tree ON docs(book_id, parent_id, position);
CREATE UNIQUE INDEX docs_source ON docs(source_path) WHERE source_path IS NOT NULL;`

const docVersionsTable = `CREATE TABLE doc_versions (
  id INTEGER PRIMARY KEY,
  doc_id INTEGER NOT NULL REFERENCES docs(id),
  revision INTEGER NOT NULL,
  title TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  content TEXT NOT NULL
)`

const docVersionsIndexes = `
CREATE INDEX doc_versions_doc ON doc_versions(doc_id, id);`

const calendarPeriodsTable = `CREATE TABLE calendar_periods (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  precision TEXT NOT NULL CHECK (precision IN ('year', 'month', 'day')),
  color TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`

const calendarPeriodsIndexes = `
CREATE INDEX calendar_periods_time ON calendar_periods(start_date, end_date, id);`

const schema = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE books (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
` + docsTable + `;` + docsIndexes + `
` + docVersionsTable + `;` + docVersionsIndexes + `
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL UNIQUE,
  ext TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  original_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
` + calendarPeriodsTable + `;` + calendarPeriodsIndexes + `
`

// Init creates an empty data directory. It refuses to touch an existing database.
func Init(dir string) error {
	dbPath := filepath.Join(dir, dbFile)
	if _, err := os.Stat(dbPath); err == nil {
		return fmt.Errorf("%s already exists", dbPath)
	}
	for _, d := range []string{dir, filepath.Join(dir, "assets")} {
		if err := os.MkdirAll(d, 0o700); err != nil {
			return err
		}
	}
	db, err := openDB(dbPath)
	if err != nil {
		return err
	}
	defer db.Close()
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(schema); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO meta(key, value) VALUES ('schema', ?)`, strconv.Itoa(doc.SchemaVersion)); err != nil {
		return err
	}
	if err := setLayout(context.Background(), tx, currentLayout); err != nil {
		return err
	}
	return tx.Commit()
}

// Open requires a database created by Init; a missing database is an error, never an implicit init.
// An older table layout is brought up to date first (migrate.go).
func Open(dir string) (*Store, error) { return open(dir, true) }

// OpenAsIs opens a database this program can use without migrating it, for copying it exactly as it
// is: a backup taken before an upgrade must hold the layout from before.
func OpenAsIs(dir string) (*Store, error) { return open(dir, false) }

func open(dir string, migrateLayout bool) (*Store, error) {
	dbPath := filepath.Join(dir, dbFile)
	if _, err := os.Stat(dbPath); err != nil {
		return nil, fmt.Errorf("database %s missing; run `yuyan init --data %s` for a new instance: %w", dbPath, dir, err)
	}
	db, err := openDB(dbPath)
	if err != nil {
		return nil, err
	}
	if err := prepare(db, migrateLayout); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{DB: db, dir: dir, now: time.Now}, nil
}

// prepare checks the document format and table layout of db, migrating an older layout when asked.
func prepare(db *sql.DB, migrateLayout bool) error {
	ctx := context.Background()
	var v string
	if err := db.QueryRowContext(ctx, `SELECT value FROM meta WHERE key = 'schema'`).Scan(&v); err != nil {
		return fmt.Errorf("read schema version: %w", err)
	}
	if v != strconv.Itoa(doc.SchemaVersion) {
		return fmt.Errorf("database schema %s, program expects %d", v, doc.SchemaVersion)
	}
	layout, minLayout, err := readLayout(ctx, db)
	if err != nil {
		return err
	}
	if minLayout > currentLayout {
		return fmt.Errorf("database layout %d needs a program that supports layout %d or later, this one supports %d; use a newer program or the backup from before the upgrade", layout, minLayout, currentLayout)
	}
	if migrateLayout && layout < currentLayout {
		return migrate(ctx, db, layout)
	}
	return nil
}

func openDB(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", "file:"+filepath.ToSlash(path)+"?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=synchronous(FULL)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func (s *Store) Close() error { return s.DB.Close() }

// Check verifies database integrity and that every recorded image file exists.
func (s *Store) Check(ctx context.Context) error {
	var result string
	if err := s.DB.QueryRowContext(ctx, `PRAGMA integrity_check`).Scan(&result); err != nil {
		return err
	}
	if result != "ok" {
		return fmt.Errorf("integrity check: %s", result)
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT id, ext FROM assets`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id, ext string
		if err := rows.Scan(&id, &ext); err != nil {
			return err
		}
		if _, err := os.Stat(s.AssetPath(id, ext)); err != nil {
			return fmt.Errorf("image %s.%s missing: %w", id, ext, err)
		}
	}
	return rows.Err()
}

func (s *Store) stamp() string { return s.now().UTC().Format("2006-01-02T15:04:05.000Z") }

// Stats reports object counts; the importer uses it to refuse non-empty targets.
func (s *Store) Stats(ctx context.Context) (map[string]int, error) {
	out := map[string]int{}
	for key, q := range map[string]string{
		"books":  `SELECT count(*) FROM books WHERE deleted_at IS NULL`,
		"docs":   `SELECT count(*) FROM docs WHERE deleted_at IS NULL`,
		"assets": `SELECT count(*) FROM assets`,
	} {
		var n int
		if err := s.DB.QueryRowContext(ctx, q).Scan(&n); err != nil {
			return nil, err
		}
		out[key] = n
	}
	return out, nil
}
