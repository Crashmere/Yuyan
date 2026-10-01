package doc

import (
	"encoding/json"
	"fmt"
	"strings"
)

// ChangeSummary describes this snapshot relative to the preceding snapshot. It is derived on
// read, so old histories gain summaries without changing stored documents or the database.
type ChangeSummary struct {
	Labels   []string `json:"labels"`
	Sections []string `json:"sections"`
}

// canonical removes absent/default attributes, which older imports may omit while the editor
// writes them explicitly. It never mutates the stored document.
func canonical(n Node) Node {
	a := make(map[string]any)
	for k, v := range n.Attrs {
		if v == nil || v == false || (v == "" && !(k == "title" && n.Type == "codeBlock")) {
			continue
		}
		if (k == "colspan" || k == "rowspan" || k == "start") && fmt.Sprint(v) == "1" {
			continue
		}
		a[k] = v
	}
	n.Attrs = a
	if n.Marks != nil {
		n.Marks = append([]Mark(nil), n.Marks...)
		for i, m := range n.Marks {
			n.Marks[i].Attrs = canonical(Node{Attrs: m.Attrs}).Attrs
		}
	}
	n.Content = append([]Node(nil), n.Content...)
	for i := range n.Content {
		n.Content[i] = canonical(n.Content[i])
	}
	return n
}

func encoded(v any) string {
	data, _ := json.Marshal(v)
	return string(data)
}

func SameContent(a, b Node) bool { return encoded(canonical(a)) == encoded(canonical(b)) }

type changeBlock struct {
	node    Node
	section string
	context string // enclosing list, quote or callout formatting
	key     string
}

// Media are compared independently, including inline images inside tables and callouts. A
// paragraph containing only an image is not also reported as added/deleted body text.
func changeBlocks(root Node) []changeBlock {
	var out []changeBlock
	var headings []string
	var levels []int
	section := func() string {
		if len(headings) == 0 {
			return "文档开头"
		}
		return strings.Join(headings, " › ")
	}
	var stripMedia func(Node) Node
	stripMedia = func(n Node) Node {
		children := []Node(nil)
		for _, c := range n.Content {
			if c.Type != "attachment" && c.Type != "image" && c.Type != "inlineMath" && c.Type != "blockMath" {
				children = append(children, stripMedia(c))
			}
		}
		n.Content = children
		return n
	}
	add := func(n Node, context string) {
		out = append(out, changeBlock{n, section(), context, encoded(n) + context})
	}
	var media func(Node, string)
	media = func(n Node, context string) {
		if n.Type == "attachment" || n.Type == "image" || n.Type == "inlineMath" || n.Type == "blockMath" {
			add(n, context)
			return
		}
		for _, c := range n.Content {
			media(c, context)
		}
	}
	var walk func(Node, string)
	walk = func(n Node, context string) {
		switch n.Type {
		case "heading":
			level := n.AttrInt("level", 1)
			for len(levels) > 0 && levels[len(levels)-1] >= level {
				levels, headings = levels[:len(levels)-1], headings[:len(headings)-1]
			}
			title := strings.TrimSpace(TextContent(n))
			if title == "" {
				title = "无文字标题"
			}
			levels, headings = append(levels, level), append(headings, title)
			add(stripMedia(n), context)
			media(n, context)
		case "paragraph", "calloutTitle", "foldTitle", "table", "codeBlock", "horizontalRule":
			clean := stripMedia(n)
			if n.Type != "paragraph" || len(clean.Content) > 0 {
				add(clean, context)
			}
			media(n, context)
		case "attachment", "image", "inlineMath", "blockMath":
			add(n, context)
		case "imageBoard":
			add(Node{Type: n.Type, Attrs: n.Attrs}, context)
			media(n, context)
		case "columns":
			add(Node{Type: n.Type, Attrs: map[string]any{"widths": n.Attrs["widths"], "count": len(n.Content)}}, context)
			for _, child := range n.Content {
				walk(child, context+n.Type)
			}
		case "foldBlock", "highlightBlock":
			add(Node{Type: n.Type, Attrs: n.Attrs}, context)
			for _, child := range n.Content {
				walk(child, context+n.Type)
			}
		default:
			if n.Type != "doc" {
				context += encoded(Node{Type: n.Type, Attrs: n.Attrs})
			}
			for _, c := range n.Content {
				walk(c, context)
			}
		}
	}
	walk(canonical(root), "")
	return out
}

// SummarizeChanges matches unchanged blocks first, then stable identities (image source and
// heading text), then remaining blocks by type and section. It makes no semantic/AI claims:
// ambiguous replacements become ordinary content edits; image sources remain add/remove events.
func SummarizeChanges(beforeTitle string, before Node, afterTitle string, after Node) ChangeSummary {
	result := ChangeSummary{Labels: []string{}, Sections: []string{}}
	counts := map[string]int{}
	var order []string
	sections := map[string]bool{}
	add := func(label string, places ...string) {
		if counts[label] == 0 {
			order = append(order, label)
		}
		counts[label]++
		for _, p := range places {
			if p != "" && !sections[p] {
				sections[p] = true
				result.Sections = append(result.Sections, p)
			}
		}
	}
	if beforeTitle != afterTitle {
		add("修改文档标题")
	}
	a, b := changeBlocks(before), changeBlocks(after)
	matches := make([]int, len(b))
	used := make([]bool, len(a))
	for i := range matches {
		matches[i] = -1
	}
	match := func(key func(changeBlock) string) {
		queues := map[string][]int{}
		for i, block := range a {
			if k := key(block); !used[i] && k != "" {
				queues[k] = append(queues[k], i)
			}
		}
		for j, block := range b {
			if matches[j] >= 0 {
				continue
			}
			k := key(block)
			if q := queues[k]; k != "" && len(q) > 0 {
				matches[j], used[q[0]], queues[k] = q[0], true, q[1:]
			}
		}
	}
	match(func(v changeBlock) string { return v.key + ":" + v.section })
	match(func(v changeBlock) string { return v.key })
	match(func(v changeBlock) string {
		switch v.node.Type {
		case "attachment", "image":
			return v.node.Type + ":" + v.node.Attr("src")
		case "heading":
			return "heading:" + TextContent(v.node)
		}
		return ""
	})
	for _, scoped := range []bool{true, false} {
		match(func(v changeBlock) string {
			if v.node.Type == "image" || v.node.Type == "attachment" {
				return ""
			}
			if scoped {
				return v.node.Type + ":" + v.section
			}
			return v.node.Type
		})
	}
	// Relative order, not absolute indices: inserting a paragraph before an image doesn't move
	// that image. An inversion among matched blocks indicates a reorder.
	moved := make([]bool, len(b))
	max := -1
	for j, i := range matches {
		if i >= 0 {
			moved[j] = i < max
			if i > max {
				max = i
			}
		}
	}
	min := len(a)
	for j := len(b) - 1; j >= 0; j-- {
		i := matches[j]
		if i >= 0 {
			moved[j] = moved[j] || i > min
			if i < min {
				min = i
			}
		}
	}
	name := func(n Node) string {
		switch n.Type {
		case "attachment":
			return "附件"
		case "image":
			return "图片"
		case "imageBoard":
			return "图片组合"
		case "table":
			return "表格"
		case "heading":
			return "标题"
		case "codeBlock":
			if n.Attr("language") == "mermaid" {
				return "图表"
			}
			return "代码块"
		case "inlineMath", "blockMath":
			return "公式"
		case "horizontalRule":
			return "分隔线"
		case "foldBlock":
			return "折叠块"
		case "foldTitle":
			return "折叠块标题"
		case "highlightBlock":
			return "高亮块"
		case "columns":
			return "分栏"
		default:
			return "正文"
		}
	}
	for j, block := range b {
		i := matches[j]
		if i < 0 {
			add("新增"+name(block.node), block.section)
			continue
		}
		old, n := a[i].node, block.node
		places := []string{block.section}
		if moved[j] {
			places = append(places, a[i].section)
			add("调整"+name(n)+"位置", places...)
		}
		if a[i].key == block.key {
			continue
		}
		attrsChanged := func(keys ...string) bool {
			for _, k := range keys {
				if encoded(old.Attrs[k]) != encoded(n.Attrs[k]) {
					return true
				}
			}
			return false
		}
		switch n.Type {
		case "columns":
			if attrsChanged("widths", "count") {
				add("调整分栏布局", places...)
			}
		case "foldBlock":
			if attrsChanged("collapsed") {
				add("调整折叠块状态", places...)
			}
		case "highlightBlock":
			if attrsChanged("backgroundColor") {
				add("调整高亮块底色", places...)
			}
		case "foldTitle":
			if TextContent(old) != TextContent(n) {
				add("修改折叠块标题", places...)
			} else {
				add("调整折叠块标题格式", places...)
			}
		case "attachment":
			add("修改附件信息", places...)
		case "image":
			if attrsChanged("crop") {
				add("裁切图片", places...)
			}
			if attrsChanged("placement") {
				add("调整组合内图片", places...)
			}
			if attrsChanged("width", "height") {
				add("调整图片大小", places...)
			}
			if attrsChanged("blockAlign") {
				add("调整图片对齐", places...)
			}
			if attrsChanged("shadow") {
				add("调整图片边框", places...)
			}
			if attrsChanged("caption") {
				add("修改图片说明", places...)
			}
			if attrsChanged("alt", "title") {
				add("修改图片替代文字或标题", places...)
			}
		case "imageBoard":
			if attrsChanged("width", "height") {
				add("调整画板大小", places...)
			}
			if attrsChanged("blockAlign") {
				add("调整画板对齐", places...)
			}
		case "table":
			if attrsChanged("blockAlign") {
				add("调整表格对齐", places...)
			}
			if tablePart(old, "size") != tablePart(n, "size") {
				add("调整表格尺寸", places...)
			}
			if tablePart(old, "align") != tablePart(n, "align") {
				add("调整单元格对齐", places...)
			}
			if tablePart(old, "shape") != tablePart(n, "shape") {
				add("调整表格结构", places...)
			}
			if tablePart(old, "background") != tablePart(n, "background") {
				add("调整单元格底色", places...)
			}
			if tablePart(old, "content") != tablePart(n, "content") {
				add("修改表格内容", places...)
			}
		case "heading":
			if attrsChanged("level") {
				add("调整标题等级", places...)
			}
			if TextContent(old) != TextContent(n) {
				add("修改标题", places...)
			} else if encoded(old.Content) != encoded(n.Content) {
				add("调整标题格式", places...)
			}
		case "codeBlock":
			if TextContent(old) != TextContent(n) {
				add("修改"+name(n)+"内容", places...)
			}
			if encoded(old.Attrs) != encoded(n.Attrs) {
				add("调整"+name(n)+"设置", places...)
			}
		case "inlineMath", "blockMath":
			add("修改公式", places...)
		default:
			if TextContent(old) != TextContent(n) {
				add("修改正文", places...)
			} else if a[i].context == block.context {
				add("调整正文格式", places...)
			}
		}
		if a[i].context != block.context {
			add("调整正文结构或格式", places...)
		}
	}
	for i, block := range a {
		if !used[i] {
			add("删除"+name(block.node), block.section)
		}
	}
	for _, label := range order {
		if counts[label] > 1 {
			result.Labels = append(result.Labels, fmt.Sprintf("%s ×%d", label, counts[label]))
		} else {
			result.Labels = append(result.Labels, label)
		}
	}
	if len(result.Labels) == 0 {
		if SameContent(before, after) && beforeTitle == afterTitle {
			result.Labels = append(result.Labels, "内容无变化")
		} else {
			result.Labels = append(result.Labels, "调整空行或文档格式")
		}
	}
	return result
}

// Separate table geometry/alignment from cell contents, so resizing doesn't appear as a text edit.
func tablePart(n Node, part string) string {
	var out []string
	var walk func(Node, string)
	walk = func(v Node, path string) {
		switch part {
		case "size":
			for _, k := range []string{"colwidth", "height"} {
				if a := v.Attrs[k]; a != nil {
					out = append(out, path+k+encoded(a))
				}
			}
		case "align":
			for _, k := range []string{"align", "cellAlign"} {
				if a := v.Attrs[k]; a != nil {
					out = append(out, path+k+encoded(a))
				}
			}
		case "shape":
			if v.Type == "tableRow" || v.Type == "tableCell" || v.Type == "tableHeader" {
				out = append(out, v.Type+encoded(v.Attrs["colspan"])+encoded(v.Attrs["rowspan"]))
			}
		case "background":
			if color := v.Attr("backgroundColor"); color != "" {
				out = append(out, path+color)
			}
		case "content":
			if v.Type == "tableCell" || v.Type == "tableHeader" {
				out = append(out, encoded(v.Content))
				return
			}
		}
		for i, c := range v.Content {
			walk(c, fmt.Sprintf("%s/%d", path, i))
		}
	}
	walk(n, "")
	return encoded(out)
}
