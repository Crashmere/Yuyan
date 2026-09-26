// Package web embeds the built frontend (Vite output in web/dist).
package web

import "embed"

// all: keeps chunks whose names start with "_" (Vite emits some, e.g. from lodash-es).
//
//go:embed all:dist
var Files embed.FS
