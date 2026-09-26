import { common, createLowlight } from 'lowlight'

// Syntax highlighting in the editor. Pages are highlighted by the Go renderer (Chroma), which
// knows more languages; code in other languages is still stored and shown, just not coloured here.
export const lowlight = createLowlight(common)
