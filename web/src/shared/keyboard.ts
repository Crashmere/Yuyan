// Option can produce a different character (or a dead key) on macOS. Match the physical
// letter while leaving composition, AltGr and other modifier combinations to their owners.
export function altLetter(event: KeyboardEvent, letter: string, shift = false): boolean {
  return !event.defaultPrevented && !event.isComposing && event.keyCode !== 229
    && event.altKey && !event.ctrlKey && !event.metaKey && event.shiftKey === shift && !event.getModifierState('AltGraph')
    && (event.code ? event.code === `Key${letter.toUpperCase()}` : event.key.toLowerCase() === letter.toLowerCase())
}
