package variants

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"runtime/debug"
	"slices"
	"sync"
	"time"
)

// Asset is an original image the cache can make versions of.
type Asset struct {
	ID   string
	Ext  string
	Size int64
}

// Source is the store of originals.
type Source interface {
	AssetPath(id, ext string) string
	// ImageAssets lists the stored images, newest first.
	ImageAssets(ctx context.Context) ([]Asset, error)
	// ExistingAssets reports which of the ids are still stored.
	ExistingAssets(ctx context.Context, ids []string) (map[string]bool, error)
}

// Manifest records the decision for one original: its size in bytes and pixels, and its versions,
// narrowest first. It is written after the files it lists, so a manifest always describes complete
// files.
type Manifest struct {
	Version  int       `json:"v"`
	Source   int64     `json:"source"`
	Width    int       `json:"width,omitempty"`
	Height   int       `json:"height,omitempty"`
	Variants []Variant `json:"variants,omitempty"`
	Note     string    `json:"note,omitempty"`
}

// Variant is one stored version. File, such as "1280.jpg", is served as assets/<id>-<file>.
type Variant struct {
	File   string `json:"file"`
	Width  int    `json:"w"`
	Height int    `json:"h"`
	Bytes  int64  `json:"b"`
}

var (
	manifestName = regexp.MustCompile(`^([0-9a-f]{32})\.json$`)
	fileName     = regexp.MustCompile(`^[1-9][0-9]{0,4}\.(jpg|png)$`)
)

const (
	// The backfill starts this long after the service, which first serves the pages opened by
	// a restart; requested originals do not wait.
	backfillDelay = time.Minute
	sweepEvery    = 10 * time.Minute
	// Work above this many decoded pixels returns its memory to the system afterwards: the
	// service runs within 384 MiB.
	heavyPixels = 4 << 20
)

// Dir is where a data directory keeps its display versions. derived/ holds what can be made again
// from the data, and backups leave it out.
func Dir(data string) string { return filepath.Join(data, "derived", "images") }

// Cache keeps the display versions in one directory of the data volume. It is disposable: a
// missing or emptied directory is rebuilt from the originals.
type Cache struct {
	dir string
	src Source

	mu sync.Mutex
	// files holds the version files of each processed original, narrowest first; empty when it
	// has none.
	files   map[string][]string
	queued  map[string]bool
	urgent  []Asset
	backlog []Asset
	wake    chan struct{}
	// backfilled counts the backlog processed since the last report, and how many got versions.
	backfilled, withFiles int
}

// Open loads the manifests of the current Version and removes everything else in dir: files of
// older versions, unlisted files and interrupted writes.
func Open(dir string, src Source) (*Cache, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	c := &Cache{dir: dir, src: src, files: map[string][]string{}, queued: map[string]bool{}, wake: make(chan struct{}, 1)}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	present := map[string]bool{}
	for _, e := range entries {
		present[e.Name()] = true
	}
	keep := map[string]bool{}
	for _, e := range entries {
		m := manifestName.FindStringSubmatch(e.Name())
		if m == nil {
			continue
		}
		manifest, err := readManifest(filepath.Join(dir, e.Name()))
		if err != nil || manifest.Version != Version {
			continue
		}
		var files []string
		complete := true
		for _, v := range manifest.Variants {
			complete = complete && fileName.MatchString(v.File) && present[m[1]+"-"+v.File]
			files = append(files, v.File)
		}
		if !complete {
			continue
		}
		keep[e.Name()] = true
		for _, f := range files {
			keep[m[1]+"-"+f] = true
		}
		c.files[m[1]] = files
	}
	for name := range present {
		if !keep[name] {
			if err := os.Remove(filepath.Join(dir, name)); err != nil && !errors.Is(err, fs.ErrNotExist) {
				return nil, err
			}
		}
	}
	return c, nil
}

func readManifest(path string) (Manifest, error) {
	var m Manifest
	data, err := os.ReadFile(path)
	if err == nil {
		err = json.Unmarshal(data, &m)
	}
	return m, err
}

// candidate reports whether an original may get versions at all, which needs no file access. A
// file larger than the decode limit would decode larger still, so it is not even read.
func candidate(a Asset) bool {
	switch a.Ext {
	case "png", "jpg", "webp", "bmp":
		return a.Size >= minBytes && a.Size <= maxDecoded
	}
	return false
}

// Files returns the version files of an original, narrowest first, and whether it has been
// processed. A nil Cache has none.
func (c *Cache) Files(id string) (files []string, known bool) {
	if c == nil {
		return nil, true
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	files, known = c.files[id]
	return files, known
}

// Path locates a version file for serving.
func (c *Cache) Path(id, file string) (string, bool) {
	files, _ := c.Files(id)
	if !slices.Contains(files, file) {
		return "", false
	}
	return filepath.Join(c.dir, id+"-"+file), true
}

// Request queues an original ahead of the backfill, for an upload or a page being read. One
// already waiting in the backfill moves ahead too; the backfill skips it once it is processed.
func (c *Cache) Request(a Asset) {
	if c == nil || !candidate(a) {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.files[a.ID]; ok || slices.ContainsFunc(c.urgent, func(u Asset) bool { return u.ID == a.ID }) {
		return
	}
	c.queued[a.ID] = true
	c.urgent = append(c.urgent, a)
	select {
	case c.wake <- struct{}{}:
	default:
	}
}

// Forget drops what is known about an original whose files went missing; the next request makes
// them again.
func (c *Cache) Forget(id string) {
	if c == nil {
		return
	}
	c.mu.Lock()
	delete(c.files, id)
	c.mu.Unlock()
}

// Run makes versions one original at a time until ctx ends: requested ones first, then, after a
// short delay, the backfill of every stored image. It rests as long as each image took, so
// generation uses at most half of the service's single CPU, and pages keep priority.
func (c *Cache) Run(ctx context.Context) {
	sweep := time.NewTicker(sweepEvery)
	defer sweep.Stop()
	backfillAt := time.Now().Add(backfillDelay)
	c.refresh(ctx)
	for ctx.Err() == nil {
		a, backfill, ok := c.next(time.Now().After(backfillAt))
		if !ok {
			var later <-chan time.Time
			if wait := time.Until(backfillAt); wait > 0 && c.pending() {
				later = time.After(wait)
			}
			select {
			case <-ctx.Done():
				return
			case <-c.wake:
			case <-later:
			case <-sweep.C:
				c.refresh(ctx)
			}
			continue
		}
		start := time.Now()
		pixels, kept := c.process(a)
		if pixels > heavyPixels {
			debug.FreeOSMemory()
		}
		if backfill {
			c.backfilled++
			if kept {
				c.withFiles++
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Since(start)):
		}
		select {
		case <-sweep.C:
			c.refresh(ctx)
		default:
		}
	}
}

func (c *Cache) pending() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.backlog) > 0
}

// next takes the next original to process, and whether it comes from the backfill.
func (c *Cache) next(backfill bool) (Asset, bool, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.urgent) > 0 {
		a := c.urgent[0]
		c.urgent = c.urgent[1:]
		return a, false, true
	}
	for backfill && len(c.backlog) > 0 {
		a := c.backlog[0]
		c.backlog = c.backlog[1:]
		if _, done := c.files[a.ID]; done {
			continue
		}
		return a, true, true
	}
	if c.backfilled > 0 {
		slog.Info("display versions: backfill done", "processed", c.backfilled, "withVersions", c.withFiles, "known", len(c.files))
		c.backfilled, c.withFiles = 0, 0
	}
	return Asset{}, false, false
}

// refresh removes the versions of originals no longer stored and queues stored images that have
// none: new after a restore, an import, or uploads by another process.
func (c *Cache) refresh(ctx context.Context) {
	c.mu.Lock()
	ids := make([]string, 0, len(c.files))
	for id := range c.files {
		ids = append(ids, id)
	}
	c.mu.Unlock()
	exists, err := c.src.ExistingAssets(ctx, ids)
	if err != nil {
		if ctx.Err() == nil {
			slog.Error("display versions: check originals", "error", err)
		}
		return
	}
	for _, id := range ids {
		if !exists[id] {
			c.remove(id)
		}
	}
	assets, err := c.src.ImageAssets(ctx)
	if err != nil {
		if ctx.Err() == nil {
			slog.Error("display versions: list originals", "error", err)
		}
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, a := range assets {
		if _, ok := c.files[a.ID]; ok || c.queued[a.ID] || !candidate(a) {
			continue
		}
		c.queued[a.ID] = true
		c.backlog = append(c.backlog, a)
	}
}

// remove deletes the manifest first: a crash in between leaves unlisted files, which Open removes.
func (c *Cache) remove(id string) {
	c.mu.Lock()
	files := c.files[id]
	delete(c.files, id)
	c.mu.Unlock()
	os.Remove(filepath.Join(c.dir, id+".json"))
	for _, f := range files {
		os.Remove(filepath.Join(c.dir, id+"-"+f))
	}
}

// process makes and stores the versions of one original. It returns how many pixels it decoded
// and whether the original now has versions.
func (c *Cache) process(a Asset) (pixels int, kept bool) {
	var files []string
	read := false
	defer func() {
		c.mu.Lock()
		delete(c.queued, a.ID)
		// After a failed write the page shows the original until the next start, rather than
		// queueing the work again on every view.
		if read {
			c.files[a.ID] = files
		}
		c.mu.Unlock()
	}()
	data, err := os.ReadFile(c.src.AssetPath(a.ID, a.Ext))
	if err != nil {
		// Deleted since it was queued.
		if !errors.Is(err, fs.ErrNotExist) {
			slog.Error("display versions: read original", "asset", a.ID, "error", err)
		}
		return 0, false
	}
	read = true
	res, err := Generate(data, a.Ext)
	if err != nil {
		slog.Error("display versions", "asset", a.ID, "error", err)
		res = Result{Note: "error", Pixels: res.Pixels}
	}
	pixels = res.Pixels
	if err := os.MkdirAll(c.dir, 0o700); err != nil {
		slog.Error("display versions: write", "asset", a.ID, "error", err)
		return pixels, false
	}
	m := Manifest{Version: Version, Source: int64(len(data)), Width: res.Width, Height: res.Height, Note: res.Note}
	var written []string
	for i := len(res.Outputs) - 1; i >= 0; i-- {
		o := res.Outputs[i]
		file := fmt.Sprintf("%d.%s", o.Width, res.Type)
		if err := writeFile(filepath.Join(c.dir, a.ID+"-"+file), o.Data); err != nil {
			slog.Error("display versions: write", "asset", a.ID, "error", err)
			return pixels, false
		}
		written = append(written, file)
		m.Variants = append(m.Variants, Variant{File: file, Width: o.Width, Height: o.Height, Bytes: int64(len(o.Data))})
	}
	data, err = json.Marshal(m)
	if err == nil {
		err = writeFile(filepath.Join(c.dir, a.ID+".json"), data)
	}
	if err != nil {
		slog.Error("display versions: write manifest", "asset", a.ID, "error", err)
		return pixels, false
	}
	files = written
	return pixels, len(files) > 0
}

func writeFile(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

// Summary describes the stored versions, for diagnostics. The byte counts compare, for the
// originals that have versions, what a page showing each at full column width loaded before and
// loads now on a phone (about 1280 pixels) and on a 2x desktop screen (about 2200).
type Summary struct {
	Processed    int            `json:"processed"`
	WithVersions int            `json:"withVersions"`
	Notes        map[string]int `json:"notes"`
	SourceBytes  int64          `json:"sourceBytes"`
	PhoneBytes   int64          `json:"phoneBytes"`
	DesktopBytes int64          `json:"desktopBytes"`
	// StoredBytes is the disk space the versions take.
	StoredBytes int64 `json:"storedBytes"`
}

// Summarize reads the manifests in dir without changing anything; the service may be running.
func Summarize(dir string) (Summary, error) {
	s := Summary{Notes: map[string]int{}}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return s, err
	}
	for _, e := range entries {
		if !manifestName.MatchString(e.Name()) {
			continue
		}
		m, err := readManifest(filepath.Join(dir, e.Name()))
		if err != nil || m.Version != Version {
			continue
		}
		s.Processed++
		if m.Note != "" {
			s.Notes[m.Note]++
		}
		if len(m.Variants) == 0 {
			continue
		}
		s.WithVersions++
		s.SourceBytes += m.Source
		s.PhoneBytes += m.loads(1280)
		s.DesktopBytes += m.loads(2200)
		for _, v := range m.Variants {
			s.StoredBytes += v.Bytes
		}
	}
	return s, nil
}

// loads is what a browser needing the given width fetches: the narrowest candidate that is wide
// enough, or the widest there is.
func (m Manifest) loads(width int) int64 {
	width = min(width, m.Width)
	for _, v := range m.Variants {
		if v.Width >= width {
			return v.Bytes
		}
	}
	return m.Source
}
