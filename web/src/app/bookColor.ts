// Each knowledge base gets a steady colour for its icon, picked from its id.
const palette = [
  ['#e8f7ef', '#00a35f'],
  ['#e8f1ff', '#2f6fdf'],
  ['#fff4e5', '#d9730d'],
  ['#f3ebff', '#7d4ee0'],
  ['#ffecef', '#d4385a'],
  ['#e6f7f9', '#138a9e'],
  ['#fff8db', '#b38600'],
  ['#eef0f3', '#56607a'],
]

export function bookColor(id: number): Record<string, string> {
  const [bg, fg] = palette[id % palette.length]
  return { '--book-bg': bg, '--book-fg': fg }
}
