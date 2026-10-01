package store

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

// Lock the existing directory inode so backups in another process also participate.
// Upload publication and backups share it; collection takes it exclusively. Always
// acquire this before opening a database transaction. Closing the file releases it.
func (s *Store) lockAssets(ctx context.Context, exclusive bool) (*os.File, error) {
	f, err := os.Open(filepath.Join(s.dir, "assets"))
	if err != nil {
		return nil, err
	}
	mode := syscall.LOCK_SH
	if exclusive {
		mode = syscall.LOCK_EX
	}
	for {
		err = syscall.Flock(int(f.Fd()), mode|syscall.LOCK_NB)
		if err == nil {
			return f, nil
		}
		if !errors.Is(err, syscall.EWOULDBLOCK) && !errors.Is(err, syscall.EINTR) {
			f.Close()
			return nil, err
		}
		select {
		case <-ctx.Done():
			f.Close()
			return nil, ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
}
