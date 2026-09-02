/**
 * @vitest-environment jsdom
 */
import * as React from "react";
import { createElement, type ReactNode } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { type StyleProp, type TextStyle } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MARKDOWN_COPY_MATH_SOURCE_ATTRIBUTE } from "@/assistant-selection-copy/markup";
import type { MathEngine, MathSvg } from "@/utils/math-svg";
import { MathFormula } from "./formula";

vi.stubGlobal("React", React);

const mockRender = vi.fn<(tex: string, display: boolean) => MathSvg | null>();
const mockGetLoadedMathEngine = vi.fn<() => MathEngine | null>();
const mockLoadMathEngine = vi.fn<() => Promise<MathEngine>>();

vi.mock("@/utils/math-svg", () => ({
  getLoadedMathEngine: () => mockGetLoadedMathEngine(),
  loadMathEngine: () => mockLoadMathEngine(),
}));

vi.mock("react-native-svg", () => ({
  SvgXml: ({
    accessibilityLabel,
    color,
    height,
    style,
    width,
    xml,
  }: {
    accessibilityLabel?: string;
    color?: string;
    height?: number;
    style?: StyleProp<TextStyle>;
    width?: number;
    xml: string;
  }) =>
    createElement("svg", {
      "data-accessibility-label": accessibilityLabel,
      "data-color": color,
      "data-height": height,
      "data-width": width,
      "data-xml": xml,
      style: flattenStyle(style),
    }),
}));

vi.mock("react-native", () => ({
  ScrollView: ({
    children,
    contentContainerStyle,
    dataSet,
    horizontal,
    showsHorizontalScrollIndicator,
  }: {
    children?: ReactNode;
    contentContainerStyle?: StyleProp<TextStyle>;
    dataSet?: Record<string, string>;
    horizontal?: boolean;
    showsHorizontalScrollIndicator?: boolean;
  }) =>
    createElement(
      "div",
      {
        "data-content-container-style": JSON.stringify(contentContainerStyle ?? null),
        "data-horizontal": String(horizontal),
        "data-shows-horizontal-scroll-indicator": String(showsHorizontalScrollIndicator),
        "data-testid": "math-scroll-view",
        ...dataSetToAttributes(dataSet),
      },
      children,
    ),
  Text: ({
    children,
    dataSet,
    style,
  }: {
    children?: ReactNode;
    dataSet?: Record<string, string>;
    style?: StyleProp<TextStyle>;
  }) =>
    createElement(
      "span",
      { style: flattenStyle(style), ...dataSetToAttributes(dataSet) },
      children,
    ),
}));

function flattenStyle(style: StyleProp<TextStyle> | undefined): TextStyle {
  return Object.assign({}, ...(Array.isArray(style) ? style.filter(Boolean) : [style]));
}

function dataSetToAttributes(dataSet?: Record<string, string>): Record<string, string> {
  if (!dataSet) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(dataSet).map(([key, value]) => [
      `data-${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`,
      value,
    ]),
  );
}

const SAMPLE_SVG = '<svg width="1.842ex" height="2.395ex"></svg>';
const SAMPLE_RESULT: MathSvg = {
  svg: SAMPLE_SVG,
  widthEx: 1.842,
  heightEx: 2.395,
  depthEx: 0.798,
};

function createMockEngine(): MathEngine {
  return { render: mockRender };
}

const defaultProps = {
  tex: String.raw`\frac{a}{b}`,
  display: false,
  fontSize: 16,
  color: "rgb(255, 0, 0)",
  source: "$\\frac{a}{b}$",
} as const;

describe("MathFormula", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mockRender.mockReset();
    mockGetLoadedMathEngine.mockReset();
    mockLoadMathEngine.mockReset();
    mockGetLoadedMathEngine.mockReturnValue(null);
    mockLoadMathEngine.mockReturnValue(new Promise(() => {}));
  });

  it("renders source text while the engine is not ready", () => {
    const view = render(createElement(MathFormula, defaultProps));

    expect(view.getByText(defaultProps.source)).toBeTruthy();
    expect(view.container.querySelector("svg")).toBeNull();
    expect(mockLoadMathEngine).toHaveBeenCalledOnce();
  });

  it("renders SVG with layout dimensions and color when the engine is ready", () => {
    const engine = createMockEngine();
    mockGetLoadedMathEngine.mockReturnValue(engine);
    mockRender.mockReturnValue(SAMPLE_RESULT);

    const view = render(createElement(MathFormula, defaultProps));
    const svg = view.container.querySelector("svg");

    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("data-xml")).toBe(SAMPLE_SVG);
    expect(svg?.getAttribute("data-width")).toBe("14.74");
    expect(svg?.getAttribute("data-height")).toBe("19.16");
    expect(svg?.getAttribute("data-color")).toBe(defaultProps.color);
    expect(svg?.getAttribute("data-accessibility-label")).toBe(defaultProps.source);
    expect(view.queryByText(defaultProps.source)).toBeNull();
    expect(mockLoadMathEngine).not.toHaveBeenCalled();
  });

  it("omits color from source Text when the engine is not ready and color is undefined", () => {
    const view = render(
      createElement(MathFormula, {
        ...defaultProps,
        color: undefined,
      }),
    );
    const sourceText = view.getByText(defaultProps.source);

    expect(view.container.querySelector("svg")).toBeNull();
    expect((sourceText as HTMLElement).style.color).toBe("");
  });

  it("passes undefined color through to SvgXml without error when the engine is ready", () => {
    const engine = createMockEngine();
    mockGetLoadedMathEngine.mockReturnValue(engine);
    mockRender.mockReturnValue(SAMPLE_RESULT);

    const view = render(
      createElement(MathFormula, {
        tex: defaultProps.tex,
        display: false,
        fontSize: defaultProps.fontSize,
        source: defaultProps.source,
      }),
    );
    const svg = view.container.querySelector("svg");

    expect(svg).not.toBeNull();
    expect(svg?.hasAttribute("data-color")).toBe(false);
    expect(view.queryByText(defaultProps.source)).toBeNull();
  });

  it("renders source text when render returns null", () => {
    const engine = createMockEngine();
    mockGetLoadedMathEngine.mockReturnValue(engine);
    mockRender.mockReturnValue(null);

    const view = render(createElement(MathFormula, defaultProps));

    expect(view.getByText(defaultProps.source)).toBeTruthy();
    expect(view.container.querySelector("svg")).toBeNull();
  });

  it("uses a horizontal ScrollView for display formulas but not inline formulas", () => {
    const engine = createMockEngine();
    mockGetLoadedMathEngine.mockReturnValue(engine);
    mockRender.mockReturnValue(SAMPLE_RESULT);

    const inlineView = render(createElement(MathFormula, defaultProps));
    expect(inlineView.queryByTestId("math-scroll-view")).toBeNull();

    const blockView = render(createElement(MathFormula, { ...defaultProps, display: true }));
    const scrollView = blockView.getByTestId("math-scroll-view");
    expect(scrollView.getAttribute("data-horizontal")).toBe("true");
    expect(scrollView.getAttribute("data-shows-horizontal-scroll-indicator")).toBe("false");
    expect(scrollView.getAttribute("data-content-container-style")).toBe(
      JSON.stringify({ flexGrow: 1, justifyContent: "center" }),
    );
  });

  it("does not set state after unmount while waiting for the engine", async () => {
    let resolveEngine: (engine: MathEngine) => void = () => {};
    const pendingEngine = new Promise<MathEngine>((resolve) => {
      resolveEngine = resolve;
    });
    mockLoadMathEngine.mockReturnValue(pendingEngine);

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const view = render(createElement(MathFormula, defaultProps));
    view.unmount();

    await act(async () => {
      resolveEngine(createMockEngine());
      await pendingEngine;
    });

    expect(
      consoleError.mock.calls.some(([message]) => String(message).includes("not wrapped in act")),
    ).toBe(false);

    consoleError.mockRestore();
  });

  it("renders SVG after the engine becomes ready asynchronously", async () => {
    const engine = createMockEngine();
    let resolveEngine: (value: MathEngine) => void = () => {};
    mockLoadMathEngine.mockReturnValue(
      new Promise<MathEngine>((resolve) => {
        resolveEngine = resolve;
      }),
    );
    mockRender.mockReturnValue(SAMPLE_RESULT);

    const view = render(createElement(MathFormula, defaultProps));
    expect(view.getByText(defaultProps.source)).toBeTruthy();

    await act(async () => {
      resolveEngine(engine);
    });

    await waitFor(() => {
      expect(view.container.querySelector("svg")).not.toBeNull();
    });
  });

  it("marks the outer inline element for copy restoration when SVG renders", () => {
    const engine = createMockEngine();
    mockGetLoadedMathEngine.mockReturnValue(engine);
    mockRender.mockReturnValue(SAMPLE_RESULT);

    const view = render(createElement(MathFormula, defaultProps));
    const outer = view.container.querySelector("span");

    expect(outer?.getAttribute(MARKDOWN_COPY_MATH_SOURCE_ATTRIBUTE)).toBe(defaultProps.source);
  });

  it("marks the outer block container for copy restoration when SVG renders", () => {
    const engine = createMockEngine();
    mockGetLoadedMathEngine.mockReturnValue(engine);
    mockRender.mockReturnValue(SAMPLE_RESULT);

    const view = render(createElement(MathFormula, { ...defaultProps, display: true }));
    const outer = view.getByTestId("math-scroll-view");

    expect(outer.getAttribute(MARKDOWN_COPY_MATH_SOURCE_ATTRIBUTE)).toBe(defaultProps.source);
  });

  it("does not mark text fallback output for copy restoration", () => {
    mockGetLoadedMathEngine.mockReturnValue(null);

    const view = render(createElement(MathFormula, defaultProps));
    const outer = view.container.querySelector("span");

    expect(outer?.hasAttribute(MARKDOWN_COPY_MATH_SOURCE_ATTRIBUTE)).toBe(false);
  });
});
