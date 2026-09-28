import { attention } from 'micromark-core-commonmark'
import type { Code, Construct, Event, Token } from 'micromark-util-types'
import type { Processor } from 'unified'

// CommonMark rejects **标签：**正文 and 正文**“引文”**正文 because punctuation is
// not a word boundary in Chinese. Relax runs containing strong markers; keep micromark's
// delimiter pairing, escapes, code/math isolation and all other emphasis rules.
const strongAttention: Construct = {
  ...attention,
  resolveAll(events, context) {
    const split: Event[] = []
    for (let i = 0; i < events.length; i++) {
      const [kind, token, owner] = events[i]
      if (kind === 'enter' && token.type === 'attentionSequence' && token._open && token._close
        && context.sliceSerialize(token) === '****' && events[i + 1]?.[1] === token) {
        // Adjacent bold spans: **标签：****解释**. Treat the middle run as a close
        // then an open, avoiding CommonMark's multiple-of-three ambiguity rule.
        const middle = { ...token.start, offset: token.start.offset + 2,
          column: token.start.column + 2, _bufferIndex: token.start._bufferIndex + 2 }
        const close = { ...token, end: { ...middle }, _open: false }
        const open = { ...token, start: middle, _close: false }
        split.push(['enter', close, owner], ['exit', close, owner], ['enter', open, owner], ['exit', open, owner])
        i++
      } else split.push(events[i])
    }
    // Some enclosing micromark constructs retain the event array by reference.
    events.length = 0
    for (const event of split) events.push(event)
    return attention.resolveAll!(events, context)
  },
  tokenize(effects, ok, nok) {
    const before = this.previous
    let sequence: Token | undefined
    return attention.tokenize.call(this, {
      ...effects,
      exit(type) {
        const token = effects.exit(type)
        if (type === 'attentionSequence') sequence = token
        return token
      },
    }, (after) => {
      // Include *** (bold + italic) and **** between adjacent bold spans so a
      // relaxed opener cannot accidentally pair across their strict closer.
      if (sequence && this.sliceSerialize(sequence).length >= 2) {
        sequence._open = nonSpace(after)
        sequence._close = nonSpace(before)
      }
      return ok(after)
    }, nok)
  },
}

function nonSpace(code: Code): boolean {
  // Negative codes are micromark's virtual whitespace and line endings.
  return code !== null && code >= 0 && !/\s/u.test(String.fromCodePoint(code))
}

export function remarkStrong(this: Processor) {
  const data = this.data()
  ;(data.micromarkExtensions ??= []).push({ text: { 42: strongAttention }, insideSpan: { null: [strongAttention] } })
}
