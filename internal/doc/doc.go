// Package doc holds the stored document model: Tiptap (ProseMirror) JSON.
package doc

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// SchemaVersion is bumped whenever stored JSON needs a migration.
const SchemaVersion = 1

const maxDepth = 64

type Node struct {
	Type    string         `json:"type"`
	Attrs   map[string]any `json:"attrs,omitempty"`
	Content []Node         `json:"content,omitempty"`
	Text    string         `json:"text,omitempty"`
	Marks   []Mark         `json:"marks,omitempty"`
}

type Mark struct {
	Type  string         `json:"type"`
	Attrs map[string]any `json:"attrs,omitempty"`
}

// Node and mark types known to schema version 1. They must match web/src/schema.
var nodeTypes = map[string]bool{
	"doc": true, "paragraph": true, "heading": true, "text": true, "hardBreak": true,
	"horizontalRule": true, "blockquote": true, "bulletList": true, "orderedList": true,
	"listItem": true, "taskList": true, "taskItem": true, "codeBlock": true, "image": true,
	"table": true, "tableRow": true, "tableHeader": true, "tableCell": true,
	"callout": true, "calloutTitle": true, "calloutContent": true,
	"inlineMath": true, "blockMath": true,
}

var markTypes = map[string]bool{
	"bold": true, "italic": true, "strike": true, "code": true, "underline": true,
	"highlight": true, "link": true,
}

func Empty() Node {
	return Node{Type: "doc", Content: []Node{{Type: "paragraph"}}}
}

// Parse decodes stored or submitted JSON and rejects unknown structure.
func Parse(data []byte) (Node, error) {
	var n Node
	if err := json.Unmarshal(data, &n); err != nil {
		return Node{}, fmt.Errorf("invalid document JSON: %w", err)
	}
	if n.Type != "doc" {
		return Node{}, errors.New("document root must be doc")
	}
	if err := validate(n, 0); err != nil {
		return Node{}, err
	}
	return n, nil
}

func validate(n Node, depth int) error {
	if depth > maxDepth {
		return errors.New("document nesting too deep")
	}
	if !nodeTypes[n.Type] {
		return fmt.Errorf("unknown node type %q", n.Type)
	}
	if n.Type == "doc" && depth > 0 {
		return errors.New("nested doc node")
	}
	for _, m := range n.Marks {
		if !markTypes[m.Type] {
			return fmt.Errorf("unknown mark type %q", m.Type)
		}
	}
	for _, c := range n.Content {
		if err := validate(c, depth+1); err != nil {
			return err
		}
	}
	return nil
}

func (n Node) Marshal() ([]byte, error) { return json.Marshal(n) }

func (n Node) Attr(key string) string {
	switch v := n.Attrs[key].(type) {
	case string:
		return v
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(v)
	case nil:
		return ""
	default:
		return fmt.Sprint(v)
	}
}

func (n Node) AttrInt(key string, def int) int {
	switch v := n.Attrs[key].(type) {
	case float64:
		return int(v)
	case string:
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return def
}

func (n Node) AttrBool(key string) bool {
	switch v := n.Attrs[key].(type) {
	case bool:
		return v
	case string:
		return v == "true"
	}
	return false
}

func (m Mark) Attr(key string) string {
	if s, ok := m.Attrs[key].(string); ok {
		return s
	}
	return ""
}

var blockTypes = map[string]bool{
	"paragraph": true, "heading": true, "codeBlock": true, "blockMath": true,
	"horizontalRule": true, "calloutTitle": true, "tableCell": true, "tableHeader": true,
}

// PlainText flattens a document for search: one line per text block.
func PlainText(n Node) string {
	var b strings.Builder
	var walk func(Node)
	walk = func(n Node) {
		switch n.Type {
		case "text":
			b.WriteString(n.Text)
		case "hardBreak":
			b.WriteByte('\n')
		case "inlineMath", "blockMath":
			b.WriteString(n.Attr("latex"))
		case "image":
			b.WriteString(n.Attr("alt"))
		}
		for _, c := range n.Content {
			walk(c)
		}
		if blockTypes[n.Type] {
			b.WriteByte('\n')
		}
	}
	walk(n)
	return strings.TrimSpace(b.String())
}

// TextContent returns the concatenated text of a node, used for headings and titles.
func TextContent(n Node) string {
	if n.Type == "text" {
		return n.Text
	}
	var b strings.Builder
	for _, c := range n.Content {
		b.WriteString(TextContent(c))
	}
	return b.String()
}

// AssetIDs lists image asset ids referenced by the document.
func AssetIDs(n Node) []string {
	var ids []string
	var walk func(Node)
	walk = func(n Node) {
		if n.Type == "image" {
			if id, ok := AssetID(n.Attr("src")); ok {
				ids = append(ids, id)
			}
		}
		for _, c := range n.Content {
			walk(c)
		}
	}
	walk(n)
	return ids
}

// AssetID extracts the id from an app-relative asset path such as /assets/<id>.png.
func AssetID(src string) (string, bool) {
	rest, ok := strings.CutPrefix(src, "/assets/")
	if !ok {
		return "", false
	}
	id, _, _ := strings.Cut(rest, ".")
	return id, id != ""
}
