package render

import (
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/Crashmere/Yuyan/internal/doc"
)

type imageRect struct{ x, y, width, height float64 }

func imageNumber(v any, fallback float64) float64 {
	n, ok := v.(float64)
	if !ok || math.IsNaN(n) || math.IsInf(n, 0) || n <= 0 {
		return fallback
	}
	return n
}
func imageRound(n float64) float64 { return math.Round(n*1e6) / 1e6 }
func imageNum(n float64) string {
	n = imageRound(n)
	if n == 0 {
		return "0"
	}
	return strconv.FormatFloat(n, 'f', -1, 64)
}
func imageRectangle(value any, crop bool) *imageRect {
	a, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	values := []float64{}
	for _, key := range []string{"x", "y", "width", "height"} {
		n, ok := a[key].(float64)
		if !ok || math.IsNaN(n) || math.IsInf(n, 0) {
			return nil
		}
		values = append(values, n)
	}
	if values[2] <= 0 || values[3] <= 0 {
		return nil
	}
	limit := 1e6
	if crop {
		limit = 0.999999
	}
	x, y := max(0, min(limit, values[0])), max(0, min(limit, values[1]))
	w, h := 1e6, 1e6
	if crop {
		w, h = 1-x, 1-y
	}
	return &imageRect{imageRound(x), imageRound(y), imageRound(max(0.000001, min(w, values[2]))), imageRound(max(0.000001, min(h, values[3])))}
}
func imageRectText(c *imageRect) string {
	return strings.Join([]string{imageNum(c.x), imageNum(c.y), imageNum(c.width), imageNum(c.height)}, ",")
}
func (r *renderer) imageBoard(n doc.Node) {
	w, h := imageNumber(n.Attrs["width"], 800), imageNumber(n.Attrs["height"], 500)
	attrs := [][2]string{{"data-image-board", ""}, {"data-width", imageNum(w)}, {"data-height", imageNum(h)}}
	style := "width: " + imageNum(w) + "px; max-width: 100%"
	if a := alignment(n.Attr("blockAlign")); a != "" {
		attrs = append(attrs, [2]string{"data-align", a})
		style += "; " + alignmentMargins(a)
	}
	attrs = append(attrs, [2]string{"style", style})
	r.open("div", attrs)
	r.open("div", [][2]string{{"data-board-plane", ""}, {"style", fmt.Sprintf("position: relative; width: 100%%; aspect-ratio: %s / %s; overflow: hidden", imageNum(w), imageNum(h))}})
	r.children(n)
	r.b.WriteString("</div></div>")
}
func (r *renderer) framedImage(n doc.Node, crop, placement *imageRect) {
	if crop == nil {
		crop = &imageRect{0, 0, 1, 1}
	}
	sw, sh := imageNumber(n.Attrs["sourceWidth"], 320), imageNumber(n.Attrs["sourceHeight"], 240)
	ratio := sw * crop.width / (sh * crop.height)
	fallbackWidth := sw * crop.width
	if h := imageNumber(n.Attrs["height"], 0); h > 0 {
		fallbackWidth = h * ratio
	}
	w := imageNumber(n.Attrs["width"], fallbackWidth)
	h := imageNumber(n.Attrs["height"], w/ratio)
	style := "display: inline-block; overflow: hidden; vertical-align: middle; border-radius: 4px; line-height: 0; "
	if placement != nil {
		style += fmt.Sprintf("position: absolute; left: %s%%; top: %s%%; width: %s%%; height: %s%%", imageNum(placement.x*100), imageNum(placement.y*100), imageNum(placement.width*100), imageNum(placement.height*100))
	} else {
		style += fmt.Sprintf("position: relative; width: %spx; aspect-ratio: %s / %s; max-width: 100%%", imageNum(w), imageNum(w), imageNum(h))
	}
	wrapper := [][2]string{{"data-image-frame", ""}}
	if placement == nil {
		if a := alignment(n.Attr("blockAlign")); a != "" {
			wrapper = append(wrapper, [2]string{"data-align", a})
			style += "; display: block; " + alignmentMargins(a)
		}
	}
	if n.AttrBool("shadow") {
		wrapper = append(wrapper, [2]string{"data-frame", "shadow"})
		style += "; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.12), 0 4px 16px rgba(0, 0, 0, 0.12)"
	}
	wrapper = append(wrapper, [2]string{"style", style})
	r.open("span", wrapper)
	attrs := [][2]string{{"src", r.url(n.Attr("src"))}}
	for _, k := range []string{"alt", "title", "width", "height"} {
		if v := n.Attr(k); v != "" {
			attrs = append(attrs, [2]string{k, v})
		}
	}
	if crop.x != 0 || crop.y != 0 || crop.width != 1 || crop.height != 1 {
		attrs = append(attrs, [2]string{"data-crop", imageRectText(crop)})
	}
	if placement != nil {
		attrs = append(attrs, [2]string{"data-placement", imageRectText(placement)})
	}
	for _, k := range []string{"sourceWidth", "sourceHeight"} {
		if v := n.Attr(k); v != "" {
			name := "data-source-width"
			if k == "sourceHeight" {
				name = "data-source-height"
			}
			attrs = append(attrs, [2]string{name, v})
		}
	}
	if a := alignment(n.Attr("blockAlign")); a != "" {
		attrs = append(attrs, [2]string{"data-align", a})
	}
	if n.AttrBool("shadow") {
		attrs = append(attrs, [2]string{"data-frame", "shadow"})
	}
	attrs = append(attrs, [2]string{"style", fmt.Sprintf("position: absolute; left: %s%%; top: %s%%; width: %s%% !important; height: %s%% !important; max-width: none !important; margin: 0; border-radius: 0; display: block", imageNum(-crop.x/crop.width*100), imageNum(-crop.y/crop.height*100), imageNum(100/crop.width), imageNum(100/crop.height))})
	if !r.opt.Parity {
		attrs = append(attrs, [2]string{"loading", "lazy"}, [2]string{"decoding", "async"})
	}
	r.open("img", attrs)
	r.b.WriteString("</span>")
}
