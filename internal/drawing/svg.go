package drawing

import (
	"encoding/xml"
	"errors"
	"io"
	"math"
	"regexp"
	"strconv"
	"strings"
)

var svgTags = words("svg g defs mask clipPath path rect circle ellipse line polyline polygon text tspan title desc")
var svgAttrs = words("xmlns viewBox width height x y x1 y1 x2 y2 cx cy r rx ry d points fill stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset fill-rule clip-rule clip-path mask maskUnits maskContentUnits opacity fill-opacity stroke-opacity transform font-family font-size font-weight font-style text-anchor direction dominant-baseline white-space letter-spacing id version")
var svgFragment = regexp.MustCompile(`^url\(#[a-zA-Z0-9_-]+\)$`)

func words(s string) map[string]bool {
	m := map[string]bool{}
	for _, w := range strings.Fields(s) {
		m[w] = true
	}
	return m
}

// A deliberately small SVG vocabulary matches our vector-only exports. No CSS,
// images, external URLs, scripts, entities, animation or foreignObject.
func validateSVG(p Preview) error {
	d := xml.NewDecoder(strings.NewReader(p.Data))
	depth, count := 0, 0
	root := false
	bad := errors.New("unsupported or unsafe SVG preview")
	for {
		t, err := d.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return bad
		}
		switch t := t.(type) {
		case xml.StartElement:
			depth++
			count++
			if depth > 64 || count > 150000 || !svgTags[t.Name.Local] || (t.Name.Space != "" && t.Name.Space != "http://www.w3.org/2000/svg") {
				return bad
			}
			if depth == 1 {
				if root || t.Name.Local != "svg" {
					return bad
				}
				values := map[string]string{}
				for _, a := range t.Attr {
					values[a.Name.Local] = a.Value
				}
				w, errW := strconv.ParseFloat(values["width"], 64)
				h, errH := strconv.ParseFloat(values["height"], 64)
				if errW != nil || errH != nil || w <= 0 || h <= 0 || math.IsNaN(w) || math.IsNaN(h) || math.Ceil(w) != float64(p.Width) || math.Ceil(h) != float64(p.Height) {
					return bad
				}
				box := strings.Fields(values["viewBox"])
				if len(box) != 4 {
					return bad
				}
				for i, expected := range []float64{0, 0, w, h} {
					v, err := strconv.ParseFloat(box[i], 64)
					if err != nil || math.IsNaN(v) || v != expected {
						return bad
					}
				}
				root = true
			}
			for _, a := range t.Attr {
				if !svgAttrs[a.Name.Local] || (a.Name.Space != "" && a.Name.Space != "http://www.w3.org/2000/xmlns/") {
					return bad
				}
				v := strings.ToLower(a.Value)
				if a.Name.Local == "xmlns" {
					if a.Value != "http://www.w3.org/2000/svg" {
						return bad
					}
					continue
				}
				if strings.ContainsAny(v, "<>&") || strings.Contains(v, ":") || strings.Contains(v, "\\") || (strings.Contains(v, "url") && !svgFragment.MatchString(a.Value)) {
					return bad
				}
			}
		case xml.EndElement:
			depth--
		case xml.CharData:
			if depth == 0 && strings.TrimSpace(string(t)) != "" {
				return bad
			}
		case xml.Comment:
		default:
			return bad
		}
	}
	if !root || depth != 0 {
		return bad
	}
	return nil
}
