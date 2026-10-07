package doc

import "github.com/Crashmere/Yuyan/internal/drawing"

func validDrawing(n Node) bool {
	if len(n.Content) != 0 || len(n.Marks) != 0 || !drawing.Source.MatchString(n.Attr("src")) || n.AttrInt("version", 0) != 1 {
		return false
	}
	if n.AttrInt("width", 0) < 100 || n.AttrInt("width", 0) > 2400 {
		return false
	}
	if n.AttrInt("previewWidth", 0) < 1 || n.AttrInt("previewHeight", 0) < 1 {
		return false
	}
	if n.Attr("previewMime") != "image/svg+xml" && n.Attr("previewMime") != "image/png" {
		return false
	}
	if len(n.Attr("text")) > 200000 || len(n.Attr("caption")) > 20000 {
		return false
	}
	switch n.Attr("blockAlign") {
	case "left", "center", "right":
	default:
		return false
	}
	return true
}

func HasDrawing(n Node) bool {
	if n.Type == "drawing" {
		return true
	}
	for _, child := range n.Content {
		if HasDrawing(child) {
			return true
		}
	}
	return false
}
