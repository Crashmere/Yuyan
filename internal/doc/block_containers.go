package doc

// Mirrors schema/blockContainers.ts. Preset backgrounds adapt to the reading theme.
func HighlightBlockColor(value string) (string, string) {
	palette := map[string]string{
		"#f0f1f2": "#343638", "#e1efff": "#263b52", "#def7fa": "#233e44",
		"#e2f5ed": "#263f37", "#edf6dc": "#354026", "#fff3d8": "#473d25",
		"#feebdf": "#49372d", "#fce6e8": "#482f35", "#fbe5f2": "#452e40", "#eee7fb": "#39304c",
	}
	if dark, ok := palette[value]; ok {
		return value, dark
	}
	return "#e1efff", "#263b52"
}
