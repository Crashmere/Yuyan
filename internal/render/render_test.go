package render

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/Crashmere/Yuyan/internal/doc"
	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

func mustParse(t *testing.T, s string) doc.Node {
	t.Helper()
	n, err := doc.Parse([]byte(s))
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func TestPageRendering(t *testing.T) {
	n := mustParse(t, `{"type":"doc","content":[
{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"最短路 Dijkstra"}]},
{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"最短路 Dijkstra"}]},
{"type":"paragraph","content":[
 {"type":"text","text":"见","marks":[{"type":"bold"}]},
 {"type":"text","text":"条款 10","marks":[{"type":"link","attrs":{"href":"/docs/12"}}]},
 {"type":"image","attrs":{"src":"/assets/abc.png","height":150}}]},
{"type":"codeBlock","attrs":{"language":"Java,"},"content":[{"type":"text","text":"int a = 1;"}]},
{"type":"callout","attrs":{"type":"code","fold":"-"},"content":[
 {"type":"calloutTitle","content":[{"type":"text","text":"实现"}]},
 {"type":"calloutContent","content":[{"type":"blockMath","attrs":{"latex":"a^2"}}]}]}
]}`)
	got := Render(n, Options{BasePath: "/yuyan/"})
	for _, want := range []string{
		`<h2 id="最短路-dijkstra">`, `<h2 id="最短路-dijkstra-1">`,
		`<a href="/yuyan/docs/12">`, `src="/yuyan/assets/abc.png"`, `loading="lazy"`, `height="150"`,
		`<pre class="chroma"><code class="language-java">`,
		`class="callout is-collapsed"`, `data-callout="code"`, `data-latex="a^2"`,
	} {
		if !strings.Contains(got.HTML, want) {
			t.Errorf("missing %s in\n%s", want, got.HTML)
		}
	}
	if len(got.TOC) != 2 || !got.HasMath || got.HasMermaid {
		t.Errorf("toc=%v math=%v mermaid=%v", got.TOC, got.HasMath, got.HasMermaid)
	}
}

func TestUnknownNodeDoesNotBreakPage(t *testing.T) {
	n := doc.Node{Type: "doc", Content: []doc.Node{{Type: "futureWidget"}}}
	if got := Render(n, Options{}); !strings.Contains(got.HTML, "yy-unknown") {
		t.Fatal(got.HTML)
	}
}

// TestParity compares the Go renderer with Tiptap's static renderer on the shared fixtures.
// Refresh the snapshots with `make parity` after changing any extension.
func TestParity(t *testing.T) {
	fixtures, err := filepath.Glob("../../web/test/fixtures/*.json")
	if err != nil {
		t.Fatal(err)
	}
	if len(fixtures) == 0 {
		t.Fatal("no parity fixtures found")
	}
	for _, f := range fixtures {
		name := strings.TrimSuffix(filepath.Base(f), ".json")
		t.Run(name, func(t *testing.T) {
			data, err := os.ReadFile(f)
			if err != nil {
				t.Fatal(err)
			}
			want, err := os.ReadFile(filepath.Join("testdata", name+".html"))
			if err != nil {
				t.Fatalf("missing snapshot, run make parity: %v", err)
			}
			got := Render(mustParse(t, string(data)), Options{Parity: true}).HTML
			if a, b := canonical(t, got), canonical(t, string(want)); a != b {
				t.Errorf("Go and Tiptap output differ\n--- go\n%s\n--- tiptap\n%s", a, b)
			}
		})
	}
}

// canonical parses an HTML fragment and prints it with sorted attributes, one element per line.
func canonical(t *testing.T, s string) string {
	t.Helper()
	nodes, err := html.ParseFragment(strings.NewReader(strings.TrimSpace(s)), &html.Node{Type: html.ElementNode, Data: "body", DataAtom: atom.Body})
	if err != nil {
		t.Fatal(err)
	}
	var b strings.Builder
	var walk func(n *html.Node, depth int)
	walk = func(n *html.Node, depth int) {
		indent := strings.Repeat("  ", depth)
		switch n.Type {
		case html.TextNode:
			b.WriteString(indent + "#" + n.Data + "\n")
		case html.ElementNode:
			attrs := make([]string, 0, len(n.Attr))
			for _, a := range n.Attr {
				attrs = append(attrs, a.Key+"="+a.Val)
			}
			sort.Strings(attrs)
			b.WriteString(indent + "<" + n.Data + " " + strings.Join(attrs, " ") + ">\n")
			for c := n.FirstChild; c != nil; c = c.NextSibling {
				walk(c, depth+1)
			}
		}
	}
	for _, n := range nodes {
		walk(n, 0)
	}
	return b.String()
}

func TestChromaCSSFollowsTheTheme(t *testing.T) {
	css := ChromaCSS()
	for _, want := range []string{
		"\n.chroma .k {",
		`:root[data-theme="dark"] .chroma .k {`,
		`:root:not([data-theme="light"]) .chroma .k {`,
	} {
		if !strings.Contains(css, want) {
			t.Errorf("stylesheet lacks %q", want)
		}
	}
	for _, unwanted := range []string{"/* Background */", "/* PreWrapper */", ".bg {"} {
		if strings.Contains(css, unwanted) {
			t.Errorf("stylesheet still contains %q", unwanted)
		}
	}
}
