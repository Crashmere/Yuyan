// Pinyin initials of Chinese text, from the browser's Chinese collation instead of a dictionary:
// characters sort by their pinyin, so each initial covers the characters from where its group
// starts. A few characters with several readings get one of them.
const letters = 'abcdefghjklmnopqrstwxyz'
const collator = new Intl.Collator('zh-Hans-CN')
const cache = new Map<string, string>()

function initialFrom(starts: string[], ch: string): string {
  for (let i = starts.length - 1; i >= 0; i--) {
    if (collator.compare(ch, starts[i]) >= 0) return letters[i]
  }
  return ch
}

// The collation marks where each group starts with U+FDD0 and the letter, for alphabetic indexes.
// Hand-picked first characters go wrong when the collation data changes (in ICU 78, 痳 sorts
// as lín, so 路 came out as m), so they are only used where the marks are missing.
const marks = [...letters].map((l) => '\uFDD0' + l.toUpperCase())
const starts = [...'啊八擦大饿发嘎哈鸡卡拉妈拿欧怕七然撒他挖西压杂'].every((ch, i) => initialFrom(marks, ch) === letters[i])
  ? marks
  : [...'阿八嚓哒妸发旮哈讥咔垃痳拏噢妑七呥扨它穵夕丫帀']

function initial(ch: string): string {
  let letter = cache.get(ch)
  if (letter === undefined) {
    letter = initialFrom(starts, ch)
    cache.set(ch, letter)
  }
  return letter
}

export function initials(text: string): string {
  let out = ''
  for (const ch of text) out += /\p{Script=Han}/u.test(ch) ? initial(ch) : ch.toLowerCase()
  return out
}
