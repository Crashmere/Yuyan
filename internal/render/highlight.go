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
	if err := formatter.Format(&buf, styles.Get("github"), chroma.Literator(retag(lang, it.Tokens())...)); err != nil {
		return "", false
	}
	return buf.String(), true
}

var cppTypes = map[string]bool{
	"array": true, "bitset": true, "deque": true, "list": true, "map": true, "multimap": true, "multiset": true,
	"pair": true, "priority_queue": true, "queue": true, "set": true, "stack": true, "string": true, "tuple": true,
	"unordered_map": true, "unordered_set": true, "vector": true,
}

// retag colours tokens the way Yuque does where Chroma's lexers differ: a call such as q.push(i) or
// f(x) is a function, while a variable declared with arguments, as in vector<int> a(n) or
// vector d(n, 0), stays a variable; and the C++ standard containers are types.
func retag(lang string, tokens []chroma.Token) []chroma.Token {
	prev := -1
	for i := range tokens {
		t := &tokens[i]
		if strings.TrimSpace(t.Value) == "" {
			continue
		}
		switch {
		case t.Type == chroma.Name && lang == "cpp" && cppTypes[t.Value]:
			t.Type = chroma.KeywordType
		case t.Type == chroma.Name && calls(tokens, i) && !declares(tokens, prev):
			t.Type = chroma.NameFunction
		case t.Type == chroma.NameFunction && (lang == "c" || lang == "cpp") && !defines(tokens, i):
			t.Type = chroma.Name
		}
		prev = i
	}
	return tokens
}

// defines reports whether the parenthesis after a name opens a parameter list: it is empty, holds
// a type, or something other than ; or , follows it.
func defines(tokens []chroma.Token, i int) bool {
	depth, empty := 0, true
	for j := i + 1; j < len(tokens); j++ {
		t := tokens[j]
		if depth > 0 && t.Type == chroma.KeywordType {
			return true
		}
		if t.Type != chroma.Punctuation {
			empty = empty && (depth == 0 || strings.TrimSpace(t.Value) == "")
			continue
		}
		for k, c := range t.Value {
			if c == '(' {
				depth++
			} else if c == ')' {
				if depth--; depth == 0 {
					if empty {
						return true
					}
					rest := strings.TrimSpace(t.Value[k+1:])
					for n := j + 1; rest == "" && n < len(tokens); n++ {
						rest = strings.TrimSpace(tokens[n].Value)
					}
					return !strings.HasPrefix(rest, ";") && !strings.HasPrefix(rest, ",")
				}
			}
		}
	}
	return true
}

func calls(tokens []chroma.Token, i int) bool {
	for _, t := range tokens[i+1:] {
		if strings.TrimSpace(t.Value) != "" {
			return t.Type == chroma.Punctuation && strings.HasPrefix(t.Value, "(")
		}
	}
	return false
}

func declares(tokens []chroma.Token, prev int) bool {
	if prev < 0 {
		return false
	}
	switch t := tokens[prev]; t.Type {
	case chroma.Name, chroma.KeywordType:
		return true
	case chroma.Operator:
		return t.Value == ">" || t.Value == ">>"
	}
	return false
}

// ChromaCSS returns the highlight stylesheet. Code blocks are dark in both themes, like Yuque's
// One Dark Pro (docs/DESIGN.md 16): Chroma's onedark colours, with types and preprocessor lines in
// cyan, included file names in green and function names not bold, as Yuque shows them. The
// block's own background and text colour come from content.css.
func ChromaCSS() string {
	var b bytes.Buffer
	_ = formatter.WriteCSS(&b, styles.Get("onedark"))
	return scopeCSS(b.String(), "") + yuqueTokens
}

const yuqueTokens = `.chroma .kt { color: #56b6c2 }
.chroma .cp { color: #56b6c2; font-style: normal }
.chroma .cpf { color: #98c379; font-style: normal }
.chroma .nf, .chroma .fm { font-weight: normal }
`

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
