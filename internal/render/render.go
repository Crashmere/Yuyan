// Package render turns stored Tiptap JSON into HTML. The markup mirrors each extension's
// renderHTML in web/src/schema so that reading pages and the editor share one stylesheet.
package render

import (
	"html"
	"strconv"
	"strings"
	"unicode"

	"github.com/Crashmere/Yuyan/internal/doc"
)

type Options struct {
	// BasePath prefixes app-relative links such as /docs/12 and /assets/<id>.png.
	BasePath string
	// Parity disables page-only additions (heading ids, highlighting, lazy images, read-only
	// checkboxes) so the output can be compared with Tiptap's static renderer.
	Parity bool
}

type Heading struct {
	Level int    `json:"level"`
	Text  string `json:"text"`
	ID    string `json:"id"`
}

type Result struct {
	HTML       string
	TOC        []Heading
	HasMath    bool
	HasMermaid bool
}

type renderer struct {
	opt Options
	b   strings.Builder
	res Result
	ids map[string]int
}

func Render(n doc.Node, opt Options) Result {
	if opt.BasePath == "" {
		opt.BasePath = "/"
	}
	r := &renderer{opt: opt, ids: map[string]int{}}
	r.children(n)
	r.res.HTML = r.b.String()
	return r.res
}

func (r *renderer) children(n doc.Node) {
	for _, c := range n.Content {
		r.node(c)
	}
}

func (r *renderer) wrap(tag string, attrs [][2]string, n doc.Node) {
	r.open(tag, attrs)
	r.children(n)
	r.b.WriteString("</" + tag + ">")
}

func (r *renderer) open(tag string, attrs [][2]string) {
	r.b.WriteString("<" + tag)
	for _, a := range attrs {
		r.b.WriteString(" " + a[0] + `="` + html.EscapeString(a[1]) + `"`)
	}
	r.b.WriteString(">")
}

func (r *renderer) node(n doc.Node) {
	switch n.Type {
	case "paragraph":
		var attrs [][2]string
		if a := alignment(n.Attr("textAlign")); a != "" {
			attrs = append(attrs, [2]string{"style", "text-align: " + a})
		}
		r.wrap("p", attrs, n)
	case "heading":
		level := n.AttrInt("level", 1)
		if level < 1 || level > 6 {
			level = 1
		}
		tag := "h" + strconv.Itoa(level)
		var attrs [][2]string
		if !r.opt.Parity {
			text := strings.TrimSpace(doc.TextContent(n))
			id := r.slug(text)
			attrs = append(attrs, [2]string{"id", id})
			if level <= 4 && text != "" {
				r.res.TOC = append(r.res.TOC, Heading{Level: level, Text: text, ID: id})
			}
		}
		r.wrap(tag, attrs, n)
	case "text":
		r.text(n)
	case "hardBreak":
		r.b.WriteString("<br>")
	case "horizontalRule":
		r.b.WriteString("<hr>")
	case "blockquote":
		r.wrap("blockquote", nil, n)
	case "bulletList":
		r.wrap("ul", nil, n)
	case "orderedList":
		var attrs [][2]string
		if start := n.AttrInt("start", 1); start != 1 {
			attrs = append(attrs, [2]string{"start", strconv.Itoa(start)})
		}
		if t := n.Attr("type"); t != "" && t != "1" {
			attrs = append(attrs, [2]string{"type", t})
		}
		r.wrap("ol", attrs, n)
	case "listItem":
		r.wrap("li", nil, n)
	case "taskList":
		r.wrap("ul", [][2]string{{"data-type", "taskList"}}, n)
	case "taskItem":
		checked := n.AttrBool("checked")
		r.open("li", [][2]string{{"data-checked", strconv.FormatBool(checked)}, {"data-type", "taskItem"}})
		r.b.WriteString(`<label><input type="checkbox"`)
		if checked {
			r.b.WriteString(` checked="checked"`)
		}
		if !r.opt.Parity {
			r.b.WriteString(` disabled`)
		}
		r.b.WriteString(`><span></span></label><div>`)
		r.children(n)
		r.b.WriteString("</div></li>")
	case "codeBlock":
		r.codeBlock(n)
	case "image":
		r.image(n)
	case "table":
		style, cols := tableColumns(n)
		var attrs [][2]string
		if a := alignment(n.Attr("blockAlign")); a != "" {
			attrs = append(attrs, [2]string{"data-align", a})
			if style != "" {
				style += "; "
			}
			style += alignmentMargins(a)
		}
		if style != "" {
			attrs = append(attrs, [2]string{"style", style})
		}
		r.open("table", attrs)
		if cols != "" {
			r.b.WriteString("<colgroup>" + cols + "</colgroup>")
		}
		r.b.WriteString("<tbody>")
		r.children(n)
		r.b.WriteString("</tbody></table>")
	case "tableRow":
		var attrs [][2]string
		if h, ok := n.Attrs["height"].(float64); ok && h > 0 {
			attrs = append(attrs, [2]string{"style", "height: " + px(h)})
		}
		r.wrap("tr", attrs, n)
	case "tableHeader", "tableCell":
		tag := "td"
		if n.Type == "tableHeader" {
			tag = "th"
		}
		attrs := [][2]string{
			{"colspan", strconv.Itoa(n.AttrInt("colspan", 1))},
			{"rowspan", strconv.Itoa(n.AttrInt("rowspan", 1))},
		}
		if w := colwidth(n); w != "" {
			attrs = append(attrs, [2]string{"colwidth", w})
		}
		a := alignment(n.Attr("align"))
		if cell := alignment(n.Attr("cellAlign")); cell != "" {
			attrs = append(attrs, [2]string{"data-cell-align", cell}, [2]string{"data-column-align", a})
			a = cell
		}
		if a != "" {
			attrs = append(attrs, [2]string{"style", "text-align: " + a})
		}
		r.wrap(tag, attrs, n)
	case "callout":
		class := "callout"
		fold := n.Attr("fold")
		if fold == "-" {
			class += " is-collapsed"
		}
		attrs := [][2]string{{"class", class}, {"data-callout", calloutType(n)}}
		if fold == "+" || fold == "-" {
			attrs = append(attrs, [2]string{"data-callout-fold", fold})
		}
		r.wrap("div", attrs, n)
	case "calloutTitle":
		r.wrap("div", [][2]string{{"class", "callout-title"}}, n)
	case "calloutContent":
		r.wrap("div", [][2]string{{"class", "callout-content"}}, n)
	case "inlineMath":
		r.res.HasMath = true
		r.open("span", [][2]string{{"data-latex", n.Attr("latex")}, {"data-type", "inline-math"}})
		r.b.WriteString("</span>")
	case "blockMath":
		r.res.HasMath = true
		r.open("div", [][2]string{{"data-latex", n.Attr("latex")}, {"data-type", "block-math"}})
		r.b.WriteString("</div>")
	default:
		r.open("div", [][2]string{{"class", "yy-unknown"}, {"data-type", n.Type}})
		r.b.WriteString(html.EscapeString("不支持的内容：" + n.Type))
		r.b.WriteString("</div>")
	}
}

func calloutType(n doc.Node) string {
	t := strings.ToLower(strings.TrimSpace(n.Attr("type")))
	if t == "" {
		return "note"
	}
	return t
}

// cellMinWidth is Tiptap's default minimum column width, used by its column group.
const cellMinWidth = 25

// tableColumns writes the column group Tiptap gives a table whose columns have widths (createColGroup
// in @tiptap/extension-table) and the table's width, or its minimum width while some columns have
// none. Without any widths the table has neither.
func tableColumns(n doc.Node) (style, cols string) {
	if len(n.Content) == 0 {
		return "", ""
	}
	var b strings.Builder
	total, fixed, widths := 0.0, true, false
	for _, cell := range n.Content[0].Content {
		list, _ := cell.Attrs["colwidth"].([]any)
		for j := 0; j < cell.AttrInt("colspan", 1); j++ {
			w := 0.0
			if j < len(list) {
				w, _ = list[j].(float64)
			}
			if w > 0 {
				widths = true
				total += w
				b.WriteString(`<col style="width: ` + px(max(w, cellMinWidth)) + `">`)
			} else {
				fixed = false
				total += cellMinWidth
				b.WriteString(`<col style="min-width: ` + px(cellMinWidth) + `">`)
			}
		}
	}
	switch {
	case !widths:
		return "", ""
	case fixed:
		return "width: " + px(total), b.String()
	default:
		return "min-width: " + px(total), b.String()
	}
}

// px writes a length as JavaScript would print the number.
func px(v float64) string {
	return strconv.FormatFloat(v, 'f', -1, 64) + "px"
}

func colwidth(n doc.Node) string {
	v, ok := n.Attrs["colwidth"].([]any)
	if !ok || len(v) == 0 {
		return ""
	}
	parts := make([]string, 0, len(v))
	for _, x := range v {
		if f, ok := x.(float64); ok {
			parts = append(parts, strconv.Itoa(int(f)))
		}
	}
	return strings.Join(parts, ",")
}

// text renders one text node. Like Tiptap's static renderer, each mark wraps the previous ones,
// so the last mark in the list is the outermost element.
func (r *renderer) text(n doc.Node) {
	var closers []string
	for i := len(n.Marks) - 1; i >= 0; i-- {
		m := n.Marks[i]
		switch m.Type {
		case "bold":
			r.b.WriteString("<strong>")
			closers = append(closers, "</strong>")
		case "italic":
			r.b.WriteString("<em>")
			closers = append(closers, "</em>")
		case "strike":
			r.b.WriteString("<s>")
			closers = append(closers, "</s>")
		case "code":
			r.b.WriteString("<code>")
			closers = append(closers, "</code>")
		case "underline":
			r.b.WriteString("<u>")
			closers = append(closers, "</u>")
		case "highlight":
			r.b.WriteString("<mark>")
			closers = append(closers, "</mark>")
		case "link":
			href := m.Attr("href")
			attrs := [][2]string{{"href", r.url(href)}}
			if !r.opt.Parity && isExternal(href) {
				attrs = append(attrs, [2]string{"target", "_blank"}, [2]string{"rel", "noopener noreferrer"})
			}
			r.open("a", attrs)
			closers = append(closers, "</a>")
		}
	}
	r.b.WriteString(html.EscapeString(n.Text))
	for i := len(closers) - 1; i >= 0; i-- {
		r.b.WriteString(closers[i])
	}
}

func isExternal(href string) bool {
	return strings.HasPrefix(href, "http://") || strings.HasPrefix(href, "https://")
}

// url prefixes app-relative links; everything else is left as written.
func (r *renderer) url(href string) string {
	if r.opt.Parity {
		return href
	}
	for _, p := range []string{"/docs/", "/assets/", "/books/"} {
		if strings.HasPrefix(href, p) {
			return strings.TrimSuffix(r.opt.BasePath, "/") + href
		}
	}
	return href
}

func (r *renderer) image(n doc.Node) {
	attrs := [][2]string{{"src", r.url(n.Attr("src"))}}
	for _, k := range []string{"alt", "title", "width", "height"} {
		if v := n.Attr(k); v != "" {
			attrs = append(attrs, [2]string{k, v})
		}
	}
	if a := alignment(n.Attr("blockAlign")); a != "" {
		attrs = append(attrs, [2]string{"data-align", a}, [2]string{"style", "display: block; " + alignmentMargins(a)})
	}
	if !r.opt.Parity {
		attrs = append(attrs, [2]string{"loading", "lazy"}, [2]string{"decoding", "async"})
	}
	r.open("img", attrs)
}

func alignment(value string) string {
	if value == "left" || value == "center" || value == "right" {
		return value
	}
	return ""
}

func alignmentMargins(align string) string {
	left, right := "auto", "auto"
	if align == "left" {
		left = "0"
	}
	if align == "right" {
		right = "0"
	}
	return "margin-left: " + left + "; margin-right: " + right
}

// codeBlock writes a code block; one with a title bar (a title attribute, possibly empty) is
// wrapped with its title and collapsed state, as web/src/schema/codeBlock.ts renders it.
func (r *renderer) codeBlock(n doc.Node) {
	if title, ok := n.Attrs["title"].(string); ok {
		class := "code-block"
		if collapsed, _ := n.Attrs["collapsed"].(bool); collapsed {
			class += " is-collapsed"
		}
		r.open("div", [][2]string{{"class", class}})
		r.b.WriteString(`<div class="code-title">` + html.EscapeString(title) + "</div>")
		r.code(n)
		r.b.WriteString("</div>")
		return
	}
	r.code(n)
}

func (r *renderer) code(n doc.Node) {
	lang := NormalizeLanguage(n.Attr("language"))
	code := doc.TextContent(n)
	var codeAttrs [][2]string
	if lang != "" {
		codeAttrs = append(codeAttrs, [2]string{"class", "language-" + lang})
	}
	if lang == "mermaid" {
		r.res.HasMermaid = true
	}
	if r.opt.Parity || lang == "mermaid" {
		r.b.WriteString("<pre>")
		r.open("code", codeAttrs)
		r.b.WriteString(html.EscapeString(code))
		r.b.WriteString("</code></pre>")
		return
	}
	highlighted, ok := highlight(lang, code)
	if ok {
		r.b.WriteString(`<pre class="chroma">`)
	} else {
		r.b.WriteString("<pre>")
		highlighted = html.EscapeString(code)
	}
	r.open("code", codeAttrs)
	r.b.WriteString(highlighted)
	r.b.WriteString("</code></pre>")
}

// slug makes a heading id that keeps CJK characters and is unique within the page.
func (r *renderer) slug(text string) string {
	var b strings.Builder
	dash := false
	for _, c := range strings.ToLower(text) {
		switch {
		case unicode.IsLetter(c) || unicode.IsDigit(c):
			b.WriteRune(c)
			dash = false
		case unicode.IsSpace(c) || c == '-' || c == '_':
			if !dash && b.Len() > 0 {
				b.WriteByte('-')
				dash = true
			}
		}
	}
	s := strings.Trim(b.String(), "-")
	if s == "" {
		s = "section"
	}
	if n := r.ids[s]; n > 0 {
		r.ids[s] = n + 1
		s = s + "-" + strconv.Itoa(n)
	} else {
		r.ids[s] = 1
	}
	return s
}
