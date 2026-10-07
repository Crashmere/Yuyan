package render

import (
	"html"
	"strconv"

	"github.com/Crashmere/Yuyan/internal/doc"
)

func (r *renderer) drawing(n doc.Node) {
	width := max(100, min(2400, n.AttrInt("width", 800)))
	margin := "0 auto"
	if n.Attr("blockAlign") == "left" {
		margin = "0 auto 0 0"
	}
	if n.Attr("blockAlign") == "right" {
		margin = "0 0 0 auto"
	}
	r.open("figure", [][2]string{
		{"data-drawing", n.Attr("version")}, {"data-src", r.url(n.Attr("src"))}, {"data-width", strconv.Itoa(width)}, {"data-align", n.Attr("blockAlign")},
		{"data-caption", n.Attr("caption")}, {"data-text", n.Attr("text")}, {"data-preview-width", n.Attr("previewWidth")}, {"data-preview-height", n.Attr("previewHeight")},
		{"data-preview-mime", n.Attr("previewMime")}, {"class", "yy-drawing"}, {"style", "width: " + strconv.Itoa(width) + "px; max-width: 100%; margin: " + margin},
	})
	alt := n.Attr("caption")
	if alt == "" {
		alt = "画板"
	}
	r.open("img", [][2]string{{"src", r.url(n.Attr("src") + "/preview")}, {"width", n.Attr("previewWidth")}, {"height", n.Attr("previewHeight")}, {"alt", alt}, {"loading", "lazy"}, {"style", "width: 100%; max-width: 100%; height: auto"}})
	r.b.WriteString("<figcaption>" + html.EscapeString(n.Attr("caption")) + "</figcaption><span class=\"yy-drawing-text\" hidden=\"\">" + html.EscapeString(n.Attr("text")) + "</span>")
	r.open("a", [][2]string{{"class", "yy-drawing-source"}, {"href", r.url(n.Attr("src") + "/file")}, {"download", "drawing.yuyan.json"}})
	r.b.WriteString("画板源文件</a></figure>")
}
