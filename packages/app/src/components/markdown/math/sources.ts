import { createContext } from "react";
import type { AdaptedMathFormula } from "@/utils/markdown-math";

/** Placeholder id → original formula. Lives only for the current render. */
export const MathFormulaSources = createContext<ReadonlyMap<string, AdaptedMathFormula>>(new Map());

/** Restore TeX only after ordinary Markdown source normalization has finished. */
export function restoreNativeMathSource(
  markdown: string,
  formulas: ReadonlyMap<string, AdaptedMathFormula>,
): string {
  return markdown.replace(/paseomath\d+/g, (id) => {
    const formula = formulas.get(id);
    if (!formula) return id;
    // Preserve TeX escapes while keeping raw dollars inside the math span.
    return formula.tex.replace(/(\\*)\$/g, (match, slashes: string) =>
      slashes.length % 2 === 0 ? `\\${match}` : match,
    );
  });
}
