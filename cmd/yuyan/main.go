package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/Crashmere/Yuyan/internal/server"
	"github.com/Crashmere/Yuyan/internal/store"
	"github.com/Crashmere/Yuyan/web"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	if len(os.Args) < 2 {
		return errors.New("usage: yuyan init|check|serve|backup|daily|restore|gc|history-gc [flags]")
	}
	cmd := os.Args[1]
	flags := flag.NewFlagSet(cmd, flag.ContinueOnError)
	dir := flags.String("data", "data", "data directory")
	listen := flags.String("listen", "127.0.0.1:18084", "HTTP address")
	base := flags.String("base", "/yuyan/", "public path prefix used in generated links")
	withPrefix := flags.Bool("with-prefix", false, "also accept the public prefix directly (local testing without Nginx)")
	out := flags.String("out", "", "backup: new backup directory; daily: directory holding daily backups")
	from := flags.String("from", "", "restore: backup directory to restore from")
	dryRun := flags.Bool("dry-run", false, "gc/history-gc: report cleanup candidates without changing data")
	if err := flags.Parse(os.Args[2:]); err != nil {
		return err
	}
	ctx := context.Background()
	switch cmd {
	case "history-gc":
		s, err := store.Open(*dir)
		if err != nil {
			return err
		}
		defer s.Close()
		result, err := s.PruneVersions(ctx, *dryRun)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(result)
	case "gc":
		s, err := store.Open(*dir)
		if err != nil {
			return err
		}
		defer s.Close()
		var result store.AssetGCResult
		if *dryRun {
			result, err = s.InspectAssets(ctx)
		} else {
			result, err = s.CollectAssets(ctx)
		}
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(result)
	case "backup", "daily":
		if *out == "" {
			return errors.New("--out required")
		}
		s, err := store.Open(*dir)
		if err != nil {
			return err
		}
		defer s.Close()
		if cmd == "backup" {
			return s.Backup(ctx, *out)
		}
		if err := os.MkdirAll(*out, 0o700); err != nil {
			return err
		}
		if err := s.Backup(ctx, filepath.Join(*out, "daily-"+time.Now().UTC().Format("20060102T150405Z"))); err != nil {
			return err
		}
		return store.PruneBackups(*out, 14)
	case "restore":
		if *from == "" {
			return errors.New("--from required")
		}
		if err := store.Restore(ctx, *from, *dir); err != nil {
			return err
		}
		fmt.Println("restored into", *dir)
		return nil
	case "init":
		if err := store.Init(*dir); err != nil {
			return err
		}
		fmt.Println("created", *dir)
		return nil
	case "check":
		s, err := store.Open(*dir)
		if err != nil {
			return err
		}
		defer s.Close()
		if err := s.Check(ctx); err != nil {
			return err
		}
		fmt.Println("ok")
		return nil
	case "serve":
		return serve(*dir, *listen, *base, *withPrefix)
	default:
		return fmt.Errorf("unknown command %q", cmd)
	}
}

func serve(dir, listen, base string, withPrefix bool) error {
	s, err := store.Open(dir)
	if err != nil {
		return err
	}
	defer s.Close()
	static, err := fs.Sub(web.Files, "dist")
	if err != nil {
		return err
	}
	srv, err := server.New(s, static, base)
	if err != nil {
		return err
	}
	httpServer := &http.Server{
		Addr:              listen,
		Handler:           srv.Handler(withPrefix),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       2 * time.Minute,
		WriteTimeout:      2 * time.Minute,
		IdleTimeout:       2 * time.Minute,
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	gcDone := make(chan struct{})
	go func() {
		defer close(gcDone)
		s.RunAssetGC(ctx)
	}()
	defer func() {
		stop()
		<-gcDone
	}()
	errc := make(chan error, 1)
	go func() { errc <- httpServer.ListenAndServe() }()
	slog.Info("listening", "addr", listen, "base", base, "withPrefix", withPrefix)
	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return httpServer.Shutdown(shutdown)
}
