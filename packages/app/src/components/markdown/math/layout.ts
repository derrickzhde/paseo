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
