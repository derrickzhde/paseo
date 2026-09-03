import { useEffect, useMemo, useState, type ReactElement } from "react";
import { ScrollView, Text } from "react-native";
import { SvgXml } from "react-native-svg";
import { markdownCopyMathFormulaDataSet } from "@/assistant-selection-copy/markup";
import { getLoadedMathEngine, loadMathEngine, type MathEngine } from "@/utils/math-svg";
import { computeMathLayout, inlineMathBaselineShift } from "./layout";

export interface MathFormulaProps {
  tex: string;
  display: boolean;
  fontSize: number;
  color?: string;
  source: string;
}

export function MathFormula({
  tex,
  display,
  fontSize,
  color,
  source,
}: MathFormulaProps): ReactElement {
  const [engine, setEngine] = useState<MathEngine | null>(() => getLoadedMathEngine());
  const sourceTextStyle = useMemo(() => ({ fontSize, color }), [fontSize, color]);
  const blockContentContainerStyle = useMemo(
    () => ({ flexGrow: 1, justifyContent: "center" as const }),
    [],
  );
  const mathCopyDataSet = useMemo(() => markdownCopyMathFormulaDataSet(source), [source]);
  const rendered = useMemo(
    () => (engine === null ? null : engine.render(tex, display)),
    [engine, tex, display],
  );
  const layout = rendered === null ? null : computeMathLayout(rendered, fontSize);
  const inlineSvgStyle = useMemo(
    () => ({ transform: [{ translateY: inlineMathBaselineShift(layout?.depth ?? 0, fontSize) }] }),
    [layout?.depth, fontSize],
  );

  useEffect(() => {
    if (engine !== null) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const loadedEngine = await loadMathEngine();
      if (!cancelled) {
        setEngine(loadedEngine);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [engine]);

  if (engine === null) {
    return <Text style={sourceTextStyle}>{source}</Text>;
  }

  if (rendered === null || layout === null) {
    return <Text style={sourceTextStyle}>{source}</Text>;
  }

  if (display) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={blockContentContainerStyle}
        dataSet={mathCopyDataSet}
      >
        <SvgXml
          xml={rendered.svg}
          width={layout.width}
          height={layout.height}
          color={color}
          accessibilityLabel={source}
        />
      </ScrollView>
    );
  }

  // RN Text aligns inline replaced elements with their bottom edge on the text
  // baseline, so an untransformed formula floats above the text by its own depth.
  // MathJax depthEx is the distance from the math baseline to the SVG bottom
  // edge, so translateY by depth puts the formula's baseline on the text
  // baseline — the alignment MathJax asks for with vertical-align: -depthEx ex.
  // A flat offset cannot do this: it sinks shallow formulas (E = mc^2, \sqrt 2)
  // by most of an em while deep ones (\sum, \int) still land about right.
  //
  // react-native-svg hoists a style transform onto the host view, so this moves
  // the whole SVG view rather than its contents: nothing is cropped inside the
  // SVG, but the ink now sits below the attachment box the text laid out for it.
  return (
    <Text style={sourceTextStyle} dataSet={mathCopyDataSet}>
      <SvgXml
        xml={rendered.svg}
        width={layout.width}
        height={layout.height}
        color={color}
        accessibilityLabel={source}
        style={inlineSvgStyle}
      />
    </Text>
  );
}
