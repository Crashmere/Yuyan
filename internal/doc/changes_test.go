package doc

import (
	"reflect"
	"testing"
)

func textBlock(kind, text string) Node {
	return Node{Type: kind, Content: []Node{{Type: "text", Text: text}}}
}
func document(nodes ...Node) Node { return Node{Type: "doc", Content: nodes} }
func heading(text string, level float64) Node {
	n := textBlock("heading", text)
	n.Attrs = map[string]any{"level": level}
	return n
}
func picture(src string, attrs map[string]any) Node {
	if attrs == nil {
		attrs = map[string]any{}
	}
	attrs["src"] = src
	return Node{Type: "image", Attrs: attrs}
}
func table(text string, attrs map[string]any) Node {
	return Node{Type: "table", Content: []Node{{Type: "tableRow", Content: []Node{{Type: "tableCell", Attrs: attrs, Content: []Node{textBlock("paragraph", text)}}}}}}
}

func TestChangeSummaries(t *testing.T) {
	p := func(s string) Node { return textBlock("paragraph", s) }
	h := heading("安装", 1)
	sub := heading("配置", 2)
	img := picture("/assets/a.png", nil)
	resized := picture("/assets/a.png", map[string]any{"width": float64(200), "height": float64(100), "blockAlign": "center"})
	bold := p("内容")
	bold.Content[0].Marks = []Mark{{Type: "bold"}}
	code := textBlock("codeBlock", "a()")
	newCode := textBlock("codeBlock", "b()")
	chart := newCode
	chart.Attrs = map[string]any{"language": "mermaid"}
	cases := []struct {
		name             string
		before, after    Node
		labels, sections []string
	}{
		{"paragraph under nested heading", document(h, sub, p("旧内容")), document(h, sub, p("新内容")), []string{"修改正文"}, []string{"安装 › 配置"}},
		{"rename heading only", document(h, p("内容")), document(heading("部署", 1), p("内容")), []string{"修改标题"}, []string{"部署"}},
		{"heading level", document(h, sub), document(h, heading("配置", 3)), []string{"调整标题等级"}, []string{"安装 › 配置"}},
		{"image size and alignment", document(h, Node{Type: "paragraph", Content: []Node{img}}), document(h, Node{Type: "paragraph", Content: []Node{resized}}), []string{"调整图片大小", "调整图片对齐"}, []string{"安装"}},
		{"image insertion without phantom body edit", document(h), document(h, Node{Type: "paragraph", Content: []Node{img, img}}), []string{"新增图片 ×2"}, []string{"安装"}},
		{"image removal", document(h, img), document(h), []string{"删除图片"}, []string{"安装"}},
		{"insert before image is not a move", document(h, img), document(h, p("新段落"), img), []string{"新增正文"}, []string{"安装"}},
		{"image reordered", document(h, img, p("内容")), document(h, p("内容"), img), []string{"调整正文位置", "调整图片位置"}, []string{"安装"}},
		{"table cell content", document(h, table("旧", nil)), document(h, table("新", nil)), []string{"修改表格内容"}, []string{"安装"}},
		{"table column size only", document(table("旧", nil)), document(table("旧", map[string]any{"colwidth": []any{float64(200)}})), []string{"调整表格尺寸"}, []string{"文档开头"}},
		{"table alignment only", document(table("旧", nil)), document(table("旧", map[string]any{"cellAlign": "center"})), []string{"调整单元格对齐"}, []string{"文档开头"}},
		{"text formatting", document(p("内容")), document(bold), []string{"调整正文格式"}, []string{"文档开头"}},
		{"list type", document(Node{Type: "bulletList", Content: []Node{{Type: "listItem", Content: []Node{p("内容")}}}}), document(Node{Type: "orderedList", Content: []Node{{Type: "listItem", Content: []Node{p("内容")}}}}), []string{"调整正文结构或格式"}, []string{"文档开头"}},
		{"code", document(code), document(newCode), []string{"修改代码块内容"}, []string{"文档开头"}},
		{"mermaid", document(chart), document(), []string{"删除图表"}, []string{"文档开头"}},
		{"unchanged", document(h, p("内容")), document(h, p("内容")), []string{"内容无变化"}, []string{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			before := encoded(tc.before)
			got := SummarizeChanges("文档", tc.before, "文档", tc.after)
			if !reflect.DeepEqual(got.Labels, tc.labels) || !reflect.DeepEqual(got.Sections, tc.sections) {
				t.Fatalf("got %+v, want %v / %v", got, tc.labels, tc.sections)
			}
			if before != encoded(tc.before) {
				t.Fatal("summary mutated input")
			}
		})
	}
}

func TestDefaultAttributesAndTitleOnly(t *testing.T) {
	a := document(table("相同", nil))
	b := document(table("相同", map[string]any{"colspan": float64(1), "rowspan": float64(1), "colwidth": nil, "cellAlign": nil}))
	if !SameContent(a, b) {
		t.Fatal("default attributes should not change the content")
	}
	got := SummarizeChanges("旧名", a, "新名", b)
	if !reflect.DeepEqual(got.Labels, []string{"修改文档标题"}) || len(got.Sections) != 0 {
		t.Fatalf("title-only edit: %+v", got)
	}
}
