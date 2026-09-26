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

// ChromaCSS returns the highlight stylesheet: GitHub light, and GitHub dark for dark mode.
func ChromaCSS() string {
	var light, dark bytes.Buffer
	_ = formatter.WriteCSS(&light, styles.Get("github"))
	_ = formatter.WriteCSS(&dark, styles.Get("github-dark"))
	return light.String() + "\n@media (prefers-color-scheme: dark) {\n" + dark.String() + "\n}\n"
}
