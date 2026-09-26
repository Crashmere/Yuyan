// Environments such as align only work in KaTeX's display mode; Obsidian's MathJax also accepts
// them inside $...$, so such inline formulas are rendered in display mode.
export function needsDisplay(latex: string): boolean {
  return /\\begin\{(align|alignat|gather|equation|multline|flalign)\*?\}/.test(latex)
}
