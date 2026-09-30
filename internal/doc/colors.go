package doc

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

var hexColor = regexp.MustCompile(`^#[0-9a-f]{6}$`)
var shortHexColor = regexp.MustCompile(`^#[0-9a-f]{3}$`)
var rgbColor = regexp.MustCompile(`^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*1(?:\.0*)?)?\s*\)$`)

// Fixed, named gradients mirror schema/colors.ts. Unknown CSS is never accepted.
func TextGradient(value string) (string, string) {
	var from, to string
	switch value {
	case "ocean":
		from, to = "#14b8a6", "#2563eb"
	case "violet":
		from, to = "#2563eb", "#c026d3"
	case "sunset":
		from, to = "#ec4899", "#f97316"
	case "flame":
		from, to = "#f59e0b", "#dc2626"
	default:
		return "", ""
	}
	return from, "linear-gradient(90deg, " + from + ", " + to + ")"
}

func TextGradientStyle(value string) string {
	from, paint := TextGradient(value)
	if from == "" {
		return ""
	}
	return "color: " + from + "; background-image: " + paint + "; background-clip: text; -webkit-background-clip: text; -webkit-text-fill-color: transparent"
}

// NormalizeColor accepts only solid colours, never arbitrary CSS.
func NormalizeColor(value string) string {
	v := strings.ToLower(strings.TrimSpace(value))
	if hexColor.MatchString(v) {
		return v
	}
	if shortHexColor.MatchString(v) {
		return fmt.Sprintf("#%c%c%c%c%c%c", v[1], v[1], v[2], v[2], v[3], v[3])
	}
	if m := rgbColor.FindStringSubmatch(v); m != nil {
		parts := make([]int, 3)
		for i := range parts {
			n, err := strconv.Atoi(m[i+1])
			if err != nil || n > 255 {
				return ""
			}
			parts[i] = n
		}
		return fmt.Sprintf("#%02x%02x%02x", parts[0], parts[1], parts[2])
	}
	return map[string]string{"black": "#000000", "white": "#ffffff", "red": "#ff0000", "green": "#008000", "blue": "#0000ff", "yellow": "#ffff00", "gray": "#808080", "grey": "#808080", "orange": "#ffa500", "purple": "#800080", "pink": "#ffc0cb", "brown": "#a52a2a", "cyan": "#00ffff", "magenta": "#ff00ff", "teal": "#008080", "navy": "#000080"}[v]
}

// Palette pairs match web/src/schema/colors.ts; custom colours retain their exact value.
func ColorStyle(value string, background bool) string {
	color := NormalizeColor(value)
	if color == "" {
		return ""
	}
	property := "color"
	palette := map[string]string{"#666666": "#b8b8b8", "#c03939": "#f18d8d", "#b86217": "#efb16f", "#957319": "#dfc56f", "#27804b": "#79c69a", "#247c87": "#78c7d2", "#3264c8": "#8bb1f5", "#8450b5": "#c6a0e9"}
	if background {
		property = "background-color"
		palette = map[string]string{"#eeeeee": "#36383d", "#fbe4e4": "#512e34", "#faead8": "#4c3928", "#faf0c9": "#464024", "#fff3a3": "#5e5200", "#e1f2e7": "#263f32", "#dff1f4": "#263d44", "#e5edfb": "#2b3650", "#efe5f8": "#3e3050"}
	}
	style := property + ": " + color
	if dark := palette[color]; dark != "" {
		style += fmt.Sprintf("; %s: light-dark(%s, %s)", property, color, dark)
	}
	return style
}
