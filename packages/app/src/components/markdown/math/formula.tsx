import { useEffect, useMemo, useState, type ReactElement } from "react";
import { ScrollView, Text } from "react-native";
import { SvgXml } from "react-native-svg";
import { getLoadedMathEngine, loadMathEngine, type MathEngine } from "@/utils/math-svg";
import { computeMathLayout } from "./layout";

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
  const inlineOuterTextStyle = useMemo(() => ({ fontSize, color }), [fontSize, color]);
  const rendered = useMemo(
    () => (engine === null ? null : engine.render(tex, display)),
    [engine, tex, display],
  );
  const layout = rendered === null ? null : computeMathLayout(rendered, fontSize);
  const inlineSvgStyle = useMemo(
    () => ({ transform: [{ translateY: layout?.depth ?? 0 }] }),
    [layout?.depth],
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
  // baseline. MathJax depthEx is the distance from the math baseline to the SVG
  // bottom edge (depth px). translateY by depth moves the bottom edge from the
  // text baseline to depth px below it, matching MathJax vertical-align: -depthEx ex.
  return (
    <Text style={inlineOuterTextStyle}>
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
