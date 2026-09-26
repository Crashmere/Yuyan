// Pinyin initials of Chinese text, from the browser's Chinese collation instead of a dictionary:
// characters sort by their pinyin, so each initial covers the characters from the first one read
// with it. A few characters with several readings get one of them.
const letters = 'abcdefghjklmnopqrstwxyz'
const firsts = '阿八嚓哒妸发旮哈讥咔垃痳拏噢妑七呥扨它穵夕丫帀'
const collator = new Intl.Collator('zh-Hans-CN')
const cache = new Map<string, string>()

function initial(ch: string): string {
  let letter = cache.get(ch)
  if (letter === undefined) {
    letter = ch
    for (let i = firsts.length - 1; i >= 0; i--) {
      if (collator.compare(ch, firsts[i]) >= 0) {
        letter = letters[i]
        break
      }
    }
    cache.set(ch, letter)
  }
  return letter
}

export function initials(text: string): string {
  let out = ''
  for (const ch of text) out += /\p{Script=Han}/u.test(ch) ? initial(ch) : ch.toLowerCase()
  return out
}
