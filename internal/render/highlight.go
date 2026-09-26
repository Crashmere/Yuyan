package render

import (
	"bytes"
	"strings"

	"github.com/alecthomas/chroma/v2"
	chromahtml "github.com/alecthomas/chroma/v2/formatters/html"
	"github.com/alecthomas/chroma/v2/lexers"
	"github.com/alecthomas/chroma/v2/styles"
)

var formatter = chromahtml.New(chromahtml.WithClasses(true), chromahtml.PreventSurroundingPre(true))

var languageAliases = map[string]string{
	"c++": "cpp", "cc": "cpp", "h": "c", "hpp": "cpp",
	"sh": "bash", "shell": "bash", "zsh": "bash", "console": "bash", "shellsession": "bash",
	"js": "javascript", "ts": "typescript", "py": "python", "golang": "go",
	"yml": "yaml", "conf": "ini", "cfg": "ini", "dockerfile": "docker",
	"text": "", "txt": "", "plain": "", "plaintext": "", "代码段": "",
}

// NormalizeLanguage cleans the language tag written after a code fence, e.g. "ini," or "C++".
func NormalizeLanguage(lang string) string {
	lang = strings.ToLower(strings.TrimSpace(lang))
	lang = strings.TrimRight(lang, ",.;:，。；：")
	if v, ok := languageAliases[lang]; ok {
		return v
	}
	return lang
}

func highlight(lang, code string) (string, bool) {
	if lang == "" {
		return "", false
	}
	lexer := lexers.Get(lang)
	if lexer == nil {
		return "", false
	}
	it, err := chroma.Coalesce(lexer).Tokenise(nil, code)
	if err != nil {
		return "", false
	}
	var buf bytes.Buffer
	if err := formatter.Format(&buf, styles.Get("github"), it); err != nil {
		return "", false
	}
	return buf.String(), true
}

// ChromaCSS returns the highlight stylesheet: GitHub light or GitHub dark, chosen in the app
// (data-theme) or following the system. Each set applies only in its own mode, because the two
// styles colour different token classes: light rules left active in dark mode painted
// punctuation almost in the background colour. Chroma's own backgrounds are dropped so code
// blocks keep the page colours.
func ChromaCSS() string {
	var light, dark bytes.Buffer
	_ = formatter.WriteCSS(&light, styles.Get("github"))
	_ = formatter.WriteCSS(&dark, styles.Get("github-dark"))
	return scopeCSS(light.String(), `:root[data-theme="light"] `) +
		"@media (prefers-color-scheme: light) {\n" + scopeCSS(light.String(), `:root:not([data-theme="dark"]) `) + "}\n" +
		scopeCSS(dark.String(), `:root[data-theme="dark"] `) +
		"@media (prefers-color-scheme: dark) {\n" + scopeCSS(dark.String(), `:root:not([data-theme="light"]) `) + "}\n"
}

// scopeCSS prefixes every rule of Chroma's one-rule-per-line output and removes the background rules.
func scopeCSS(css, prefix string) string {
	var b strings.Builder
	for _, line := range strings.Split(css, "\n") {
		if strings.Contains(line, "/* Background */") || strings.Contains(line, "/* PreWrapper */") {
			continue
		}
		if i := strings.Index(line, "*/ "); i >= 0 && strings.Contains(line, "{") {
			line = line[i+3:]
		}
		if strings.TrimSpace(line) == "" {
			continue
		}
		b.WriteString(prefix + line + "\n")
	}
	return b.String()
}
