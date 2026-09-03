export interface MathLayout {
  width: number;
  height: number;
  depth: number;
}

// MathJax emits ex units and, without a DOM to measure, falls back to exFactor
// 0.5 itself, so we use the same ratio.
//
// A browser instead resolves ex against the real font. Measured x-height ratios:
// serif 0.459, sans-serif 0.528, system-ui 0.543. The app's UI stack is
// system-ui, so formulas come out roughly 4% smaller than a browser would draw
// them. The baseline offset scales with the same constant, which at 16px is a
// quarter of a pixel. Tune this only against a real screenshot, not by taste.
const MATHJAX_EX_FACTOR = 0.5;

// An inline formula is shifted down by its own depth (see formula.tsx), so its
// ink reaches that far below the text baseline — outside the attachment box the
// text laid out for it. The host text view has to add that much clip room below
// its last line (see markdown-text.ios.tsx), but it only knows its font size,
// not which formulas it holds. Capping the shift at the same factor the room is
// sized from is what ties the two together: ink can never outrun the box.
//
// 1.1em clears every ordinary construct — a 2x2 pmatrix, the deepest thing
// MathJax emits at inline size, sits 1.08em below the baseline; nested
// fractions reach 0.67em. Deeper input (a 4-row inline pmatrix reaches 2.66em)
// renders slightly high rather than clipped, and at that depth it already
// overlaps the neighbouring lines whatever we do.
const INLINE_MAX_SHIFT_EM = 1.1;

export function inlineMathBaselineShift(depth: number, fontSize: number): number {
  return Math.min(depth, fontSize * INLINE_MAX_SHIFT_EM);
}

export function inlineMathClipRoom(fontSize: number): number {
  return fontSize * INLINE_MAX_SHIFT_EM;
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeMathLayout(
  metrics: { widthEx: number; heightEx: number; depthEx: number },
  fontSize: number,
): MathLayout {
  const exToPx = fontSize * MATHJAX_EX_FACTOR;
  return {
    width: roundToTwoDecimals(metrics.widthEx * exToPx),
    height: roundToTwoDecimals(metrics.heightEx * exToPx),
    depth: roundToTwoDecimals(metrics.depthEx * exToPx),
  };
}
