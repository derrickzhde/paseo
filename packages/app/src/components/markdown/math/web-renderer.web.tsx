import { useContext } from "react";
import type { MarkdownRenderers, MathRendererProps } from "react-native-enriched-markdown";
import { MathFormula } from "./formula.web";
import { MathFormulaSources } from "./sources";

function WebMathRenderer({ content, displayMode }: MathRendererProps) {
  const formulas = useContext(MathFormulaSources);
  const formula = formulas.get(content);
  const display = formula?.display ?? displayMode;
  const tex = formula?.tex ?? content;
  const source = formula?.source ?? (display ? `$$${content}$$` : `$${content}$`);
  return <MathFormula tex={tex} source={source} display={display} />;
}

export function mathRenderers(renderers: MarkdownRenderers | undefined): MarkdownRenderers {
  return { ...renderers, math: WebMathRenderer };
}
