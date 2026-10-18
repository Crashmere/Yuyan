package server

import (
	"fmt"
	"net/http"
	"slices"
	"strings"

	"github.com/Crashmere/Yuyan/internal/doc"
)

// Old tabs can drop unknown atomic nodes while parsing. Check the current stored body,
// not the submitted body, so omitting a component cannot bypass this protection.
func requireDocumentClient(r *http.Request, n doc.Node) error {
	features := strings.FieldsFunc(r.Header.Get("X-Yuyan-Features"), func(c rune) bool { return c == ',' || c == ' ' })
	var walk func(doc.Node) error
	walk = func(n doc.Node) error {
		feature, label := "", ""
		switch n.Type {
		case "drawing":
			feature, label = "drawing-v1", "画板"
		case "calendar":
			feature, label = "calendar-v1", "日历组件"
		}
		if feature != "" && !slices.Contains(features, feature) {
			return fmt.Errorf("%w: 文档包含%s，请刷新页面或更新 yuyan-doc 后再保存", errBadRequest, label)
		}
		for _, child := range n.Content {
			if err := walk(child); err != nil {
				return err
			}
		}
		return nil
	}
	return walk(n)
}
