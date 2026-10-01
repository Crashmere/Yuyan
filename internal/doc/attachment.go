package doc

import (
	"fmt"
	"math"
	"regexp"
	"strings"
	"unicode"
)

var AttachmentSource = regexp.MustCompile(`^/attachments/[0-9a-f]{32}$`)

func validAttachment(n Node) bool {
	src, srcOK := n.Attrs["src"].(string)
	name, nameOK := n.Attrs["name"].(string)
	size, sizeOK := n.Attrs["size"].(float64)
	mime, mimeOK := n.Attrs["mime"].(string)
	return srcOK && AttachmentSource.MatchString(src) && nameOK && name == AttachmentName(name) &&
		sizeOK && size >= 0 && size <= 25<<20 && size == math.Trunc(size) &&
		mimeOK && len(mime) <= 255 && len(n.Content) == 0 && n.Text == ""
}

func AttachmentName(name string) string {
	name = strings.ReplaceAll(name, "\\", "/")
	parts := strings.Split(name, "/")
	name = strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || r == '\u202e' || r == '\u202d' {
			return -1
		}
		return r
	}, parts[len(parts)-1]))
	runes := []rune(name)
	if len(runes) > 200 {
		name = string(runes[:200])
	}
	if name == "" || name == "." || name == ".." {
		return "附件"
	}
	return name
}

func AttachmentSize(size int) string {
	if size < 1024 {
		return fmt.Sprintf("%d B", size)
	}
	if size < 1024*1024 {
		return fmt.Sprintf("%.1f KB", float64(size)/1024)
	}
	return fmt.Sprintf("%.1f MB", float64(size)/(1024*1024))
}

func AttachmentType(name string) string {
	_, ext, ok := strings.Cut(name, ".")
	if ok {
		parts := strings.Split(ext, ".")
		ext = parts[len(parts)-1]
	}
	if !ok || len([]rune(ext)) > 8 || ext == "" {
		return "FILE"
	}
	return strings.ToUpper(ext)
}
