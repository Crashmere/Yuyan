// Package web embeds the built frontend (Vite output in web/dist).
package web

import "embed"

//go:embed dist
var Files embed.FS
