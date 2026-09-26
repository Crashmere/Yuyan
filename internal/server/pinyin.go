package server

import (
	"slices"
	"strings"
	"unicode"

	"github.com/mozillazg/go-pinyin"
)

var pinyinArgs = func() pinyin.Args {
	a := pinyin.NewArgs()
	a.Heteronym = true
	return a
}()

// pinyinOf spells text for the search panel, which matches titles by pinyin typed in full, by
// initials or mixed. Units are separated by spaces: one per Chinese character, giving its toneless
// readings separated by "/" (ü written both as v and as u), and one per run of ASCII letters and
// digits, in lower case. Other characters only separate units.
func pinyinOf(text string) string {
	var units []string
	var word strings.Builder
	flush := func() {
		if word.Len() > 0 {
			units = append(units, word.String())
			word.Reset()
		}
	}
	for _, r := range text {
		switch {
		case r <= unicode.MaxASCII && (unicode.IsLetter(r) || unicode.IsDigit(r)):
			word.WriteRune(unicode.ToLower(r))
		case unicode.Is(unicode.Han, r):
			flush()
			var readings []string
			for _, p := range pinyin.SinglePinyin(r, pinyinArgs) {
				for _, v := range []string{p, strings.ReplaceAll(p, "v", "u")} {
					if !slices.Contains(readings, v) {
						readings = append(readings, v)
					}
				}
			}
			if len(readings) == 0 {
				readings = []string{string(r)}
			}
			units = append(units, strings.Join(readings, "/"))
		default:
			flush()
		}
	}
	flush()
	return strings.Join(units, " ")
}
