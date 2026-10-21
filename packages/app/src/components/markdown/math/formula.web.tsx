import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { MARKDOWN_COPY_MATH_SOURCE_ATTRIBUTE } from "@/assistant-selection-copy/markup";
import { getLoadedMathEngine, loadMathEngine, type MathEngine } from "@/utils/math-svg";

interface MathFormulaProps {
  tex: string;
  display: boolean;
  source: string;
}

const BLOCK_STYLE: CSSProperties = { display: "block", overflowX: "auto", textAlign: "center" };

/** Inherit heading, link, quote and compact text styles from the enriched DOM. */
export function MathFormula({ tex, display, source }: MathFormulaProps) {
  const [engine, setEngine] = useState<MathEngine | null>(() => getLoadedMathEngine());
  const rendered = useMemo(() => engine?.render(tex, display) ?? null, [engine, tex, display]);
  useEffect(() => {
    if (engine) return;
    let cancelled = false;
    void (async () => {
      const loaded = await loadMathEngine();
      if (!cancelled) setEngine(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [engine]);

  // The engine returns sanitized SVG. Use em units so all ancestor text styles
  // apply without measuring the DOM or fixing formulas to the body font size.
  const html = useMemo(
    () => ({
      __html:
        rendered?.svg.replace(/^<svg\b[^>]*>/, (tag) =>
          tag
            .replace(/\bwidth="[^"]*"/, `width="${rendered.widthEx * 0.5}em"`)
            .replace(/\bheight="[^"]*"/, `height="${rendered.heightEx * 0.5}em"`),
        ) ?? "",
    }),
    [rendered],
  );
  const style = useMemo<CSSProperties>(
    () => ({
      display: "inline-block",
      lineHeight: 0,
      verticalAlign: display ? undefined : `${-Math.min((rendered?.depthEx ?? 0) * 0.5, 1.1)}em`,
    }),
    [display, rendered?.depthEx],
  );
  if (!rendered) return <span>{source}</span>;
  const formula = (
    <span role="img" aria-label={source} style={style} dangerouslySetInnerHTML={html} />
  );
  return (
    <span
      {...{ [MARKDOWN_COPY_MATH_SOURCE_ATTRIBUTE]: source }}
      style={display ? BLOCK_STYLE : undefined}
    >
      {formula}
    </span>
  );
}
