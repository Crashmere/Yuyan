package doc

import "math"

// ColumnWidths mirrors schema/columns.ts. Invalid weights fall back to equal widths in renderers.
func ColumnWidths(n Node) []int {
	values, ok := n.Attrs["widths"].([]any)
	if !ok || len(values) != len(n.Content) {
		return nil
	}
	widths := make([]int, len(values))
	for i, value := range values {
		v, ok := value.(float64)
		if !ok || math.IsNaN(v) || math.IsInf(v, 0) || v != math.Trunc(v) || v < 1 || v > 1000 {
			return nil
		}
		widths[i] = int(v)
	}
	return widths
}
