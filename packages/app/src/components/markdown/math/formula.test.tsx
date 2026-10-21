/** @vitest-environment jsdom */
import * as React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MathFormula } from "./formula.web";
import type { MathEngine, MathSvg } from "@/utils/math-svg";
import { MARKDOWN_COPY_MATH_SOURCE_ATTRIBUTE } from "@/assistant-selection-copy/markup";

vi.stubGlobal("React", React);
const mocks = vi.hoisted(() => ({ loaded: vi.fn(), load: vi.fn(), render: vi.fn() }));
vi.mock("@/utils/math-svg", () => ({
  getLoadedMathEngine: mocks.loaded,
  loadMathEngine: mocks.load,
}));
const props = { tex: "x", source: String.raw`\(x\)`, display: false };
const svg: MathSvg = {
  svg: '<svg width="1.842ex" height="2.395ex"><path fill="currentColor" /></svg>',
  widthEx: 1.842,
  heightEx: 2.395,
  depthEx: 0.798,
};
const engine: MathEngine = { render: mocks.render };

describe("MathFormula", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.loaded.mockReturnValue(engine);
    mocks.render.mockReturnValue(svg);
  });
  it("inherits typography and aligns the SVG by its own depth", () => {
    const view = render(<MathFormula {...props} />);
    const image = view.container.querySelector("svg")!;
    expect(image.getAttribute("width")).toBe("0.921em");
    expect(image.getAttribute("height")).toBe("1.1975em");
    expect(image.parentElement!.style.verticalAlign).toBe("-0.399em");
    expect(image.parentElement!.style.color).toBe("");
    expect(image.parentElement!.style.fontSize).toBe("");
    expect(image.parentElement!.getAttribute("aria-label")).toBe(props.source);
    expect(
      view.container
        .querySelector(`[${MARKDOWN_COPY_MATH_SOURCE_ATTRIBUTE}]`)
        ?.getAttribute(MARKDOWN_COPY_MATH_SOURCE_ATTRIBUTE),
    ).toBe(props.source);
  });
  it("caps unusually deep inline formulas at 1.1 em", () => {
    mocks.render.mockReturnValue({ ...svg, depthEx: 5.32 });
    const view = render(<MathFormula {...props} />);
    expect(view.container.querySelector("svg")!.parentElement!.style.verticalAlign).toBe("-1.1em");
  });
  it("centers display formulas in a horizontally scrollable container", () => {
    const view = render(<MathFormula {...props} display />);
    const outer = view.container.querySelector(
      `[${MARKDOWN_COPY_MATH_SOURCE_ATTRIBUTE}]`,
    ) as HTMLElement;
    expect(outer.style.display).toBe("block");
    expect(outer.style.overflowX).toBe("auto");
    expect(outer.style.textAlign).toBe("center");
    expect(view.container.querySelector("svg")!.parentElement!.style.verticalAlign).toBe("");
  });
  it("shows original source for invalid formulas", () => {
    mocks.render.mockReturnValue(null);
    const view = render(<MathFormula {...props} />);
    expect(view.container.textContent).toBe(props.source);
    expect(view.container.querySelector("svg")).toBeNull();
    expect(view.container.querySelector(`[${MARKDOWN_COPY_MATH_SOURCE_ATTRIBUTE}]`)).toBeNull();
  });
  it("shows source until the asynchronous engine is ready", async () => {
    mocks.loaded.mockReturnValue(null);
    let complete!: (value: MathEngine) => void;
    mocks.load.mockReturnValue(
      new Promise<MathEngine>((resolve) => {
        complete = resolve;
      }),
    );
    const view = render(<MathFormula {...props} />);
    expect(view.container.textContent).toBe(props.source);
    await act(async () => {
      complete(engine);
    });
    expect(view.container.querySelector("svg")).not.toBeNull();
  });
  it("ignores engine completion after unmount", async () => {
    mocks.loaded.mockReturnValue(null);
    let complete!: (value: MathEngine) => void;
    mocks.load.mockReturnValue(
      new Promise<MathEngine>((resolve) => {
        complete = resolve;
      }),
    );
    const view = render(<MathFormula {...props} />);
    view.unmount();
    await act(async () => {
      complete(engine);
    });
    expect(mocks.render).not.toHaveBeenCalled();
  });
});
