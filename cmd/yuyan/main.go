package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
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
		return errors.New("usage: yuyan init|check|serve [flags]")
	}
	cmd := os.Args[1]
	flags := flag.NewFlagSet(cmd, flag.ContinueOnError)
	dir := flags.String("data", "data", "data directory")
	listen := flags.String("listen", "127.0.0.1:18084", "HTTP address")
	base := flags.String("base", "/yuyan/", "public path prefix used in generated links")
	withPrefix := flags.Bool("with-prefix", false, "also accept the public prefix directly (local testing without Nginx)")
	if err := flags.Parse(os.Args[2:]); err != nil {
		return err
	}
	switch cmd {
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
		if err := s.Check(context.Background()); err != nil {
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
