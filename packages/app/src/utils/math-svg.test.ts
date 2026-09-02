import { beforeAll, describe, expect, it } from "vitest";
import { loadMathEngine, sanitizeMathSvgString, type MathEngine } from "./math-svg";

const DIMENSION_TOLERANCE = 0.01;

const AMS_FORMULA_CASES = [
  { tex: String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`, display: false },
  { tex: String.raw`\begin{bmatrix}1&0\\0&1\end{bmatrix}`, display: false },
  { tex: String.raw`\begin{vmatrix}a&b\\c&d\end{vmatrix}`, display: false },
  { tex: String.raw`\begin{matrix}a&b\\c&d\end{matrix}`, display: false },
  {
    tex: String.raw`\begin{aligned}f(x)&=\int_0^1 g(t)dt\\&=\sum_{k=0}^{\infty}a_k x^k\end{aligned}`,
    display: true,
  },
  { tex: String.raw`\begin{align}a&=b\\c&=d\end{align}`, display: true },
  { tex: String.raw`\begin{cases}x&x>0\\-x&x\le 0\end{cases}`, display: false },
  { tex: String.raw`\begin{array}{cc}a&b\\c&d\end{array}`, display: false },
  { tex: String.raw`\text{当 }x>0\text{ 时}`, display: false },
  { tex: String.raw`\mathbb{R}, \mathcal{L}, \mathfrak{g}`, display: false },
  { tex: String.raw`\xrightarrow{f} \overset{a}{\to} \underset{b}{\to}`, display: false },
  { tex: String.raw`\lVert x \rVert, \lvert y \rvert`, display: false },
  { tex: String.raw`\operatorname{argmax}`, display: false },
] as const;

function buildFiveLineDerivation(): string {
  const lines = [
    String.raw`\frac{\partial L}{\partial x} &= \frac{\partial L}{\partial y}\frac{\partial y}{\partial x}`,
    String.raw`&= \delta_y \cdot w`,
    String.raw`\frac{\partial L}{\partial w} &= \delta_y \cdot x`,
    String.raw`&= \delta_x \cdot x`,
    String.raw`\frac{\partial L}{\partial b} &= \delta_y`,
  ];
  return String.raw`\begin{aligned}${lines.join("\\\\")}\end{aligned}`;
}

function buildGaussianIntegralDerivation(): string {
  return String.raw`\begin{aligned}I^2&=\int_{-\infty}^{\infty}e^{-x^2}dx\int_{-\infty}^{\infty}e^{-y^2}dy\\&=\int_0^{2\pi}\int_0^{\infty}e^{-r^2}r\,dr\,d\theta\\&=\pi\end{aligned}`;
}

function buildBackpropDerivation(): string {
  return String.raw`\begin{aligned}\frac{\partial L}{\partial w}&=\frac{\partial L}{\partial y}\frac{\partial y}{\partial w}\\&=\delta \cdot x\\\frac{\partial L}{\partial b}&=\delta\\\frac{\partial L}{\partial x}&=\frac{\partial L}{\partial y}\frac{\partial y}{\partial x}\\&=\delta \cdot w\end{aligned}`;
}

function buildAlignedDerivation(lineCount: number): string {
  const lines = Array.from({ length: lineCount }, (_, index) => {
    const step = String.raw`\sum_{k=0}^{${index + 1}} a_{${index},k} x^k`;
    return index === 0 ? `${step} &= ${step} + b_${index}` : `&= ${step} + b_${index}`;
  });
  return String.raw`\begin{aligned}${lines.join("\\\\")}\end{aligned}`;
}

function buildPolynomial(termCount: number): string {
  return Array.from({ length: termCount }, (_, index) => `${index + 1}x^{${index}}`).join("+");
}

function buildTenByTenMatrix(): string {
  const rows = Array.from({ length: 10 }, (_row, rowIndex) =>
    Array.from({ length: 10 }, (_column, columnIndex) => `a_{${rowIndex}${columnIndex}}`).join("&"),
  );
  return String.raw`\begin{pmatrix}${rows.join("\\\\")}\end{pmatrix}`;
}

const REAL_WORLD_FORMULA_CASES = [
  { name: "5-line derivation", tex: buildFiveLineDerivation(), display: true },
  { name: "Gaussian integral derivation", tex: buildGaussianIntegralDerivation(), display: true },
  { name: "backpropagation derivation", tex: buildBackpropDerivation(), display: true },
  { name: "20-term polynomial", tex: buildPolynomial(20), display: false },
  { name: "10-line derivation", tex: buildAlignedDerivation(10), display: true },
  { name: "40-term polynomial", tex: buildPolynomial(40), display: false },
  { name: "20-line derivation", tex: buildAlignedDerivation(20), display: true },
  { name: "10x10 matrix", tex: buildTenByTenMatrix(), display: false },
] as const;

function buildLargeSumBomb(termCount: number): string {
  return Array.from({ length: termCount }, (_, index) => `x_{${index}}`).join("+");
}

function build4096CharInput(): string {
  return `x${"%\n".repeat(2047)}%`;
}

const DIMENSION_CASES = [
  { tex: "E=mc^2", display: false, widthEx: 8.699, heightEx: 2.072, depthEx: 0.186 },
  { tex: String.raw`\frac{a}{b}`, display: false, widthEx: 1.842, heightEx: 2.395, depthEx: 0.798 },
  { tex: "x_1", display: false, widthEx: 2.282, heightEx: 1.339, depthEx: 0.339 },
  { tex: String.raw`\sqrt{2}`, display: false, widthEx: 3.061, heightEx: 2.398, depthEx: 0.225 },
  {
    tex: String.raw`\alpha+\beta`,
    display: false,
    widthEx: 5.494,
    heightEx: 2.034,
    depthEx: 0.439,
  },
  {
    tex: String.raw`\int_0^1 f(x)\,dx`,
    display: true,
    widthEx: 10.805,
    heightEx: 5.59,
    depthEx: 2.063,
  },
] as const;

function expectNear(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(DIMENSION_TOLERANCE);
}

function countSvgOpenTags(svg: string): number {
  return (svg.match(/<svg/gi) ?? []).length;
}

function countSvgCloseTags(svg: string): number {
  return (svg.match(/<\/svg>/gi) ?? []).length;
}

const SVG_STRUCTURE_CASES = [
  { tex: "E=mc^2", display: false },
  { tex: String.raw`\frac{a}{b}`, display: false },
  { tex: String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`, display: false },
  { tex: String.raw`\left(\frac{a}{b}\right)`, display: false },
  { tex: String.raw`\int_{-\infty}^{\infty}e^{-x^2}dx`, display: false },
  { tex: String.raw`\begin{cases}x&x>0\\-x&x\le 0\end{cases}`, display: false },
  { tex: buildTenByTenMatrix(), display: false },
] as const;

describe("math-svg", () => {
  let engine: MathEngine;

  beforeAll(async () => {
    engine = await loadMathEngine();
  });

  describe("SVG extraction", () => {
    it.each(SVG_STRUCTURE_CASES)("returns balanced top-level svg markup", ({ tex, display }) => {
      const result = engine.render(tex, display);
      expect(result).not.toBeNull();
      const { svg } = result!;
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg.endsWith("</svg>")).toBe(true);
      expect(countSvgOpenTags(svg)).toBe(countSvgCloseTags(svg));
    });

    it("returns the full svg payload for a 10x10 matrix", () => {
      const result = engine.render(buildTenByTenMatrix(), false);
      expect(result).not.toBeNull();
      expect(result!.svg.length).toBeGreaterThan(100_000);
    });
  });

  describe("AMS environments and commands", () => {
    it.each(AMS_FORMULA_CASES)("renders $tex (display=$display)", ({ tex, display }) => {
      expect(engine.render(tex, display)).not.toBeNull();
    });
  });

  describe("output size limits", () => {
    it.each(REAL_WORLD_FORMULA_CASES)("renders real-world formula: $name", ({ tex, display }) => {
      expect(engine.render(tex, display)).not.toBeNull();
    });

    // Do not reject 200 nested fractions by SVG size: a 10×10 pmatrix (~178 KiB) can exceed
    // a 200-deep \frac chain (~186 KiB). The 4096-char input cap is the primary gate; nested
    // fractions at 2001 chars render in ~31 ms with volume comparable to legitimate content.
    it("rejects large sums that inflate SVG output", () => {
      expect(engine.render(buildLargeSumBomb(515), false)).toBeNull();
    });

    it("rejects 4096 repeated letters that inflate SVG output", () => {
      expect(engine.render("a".repeat(4096), false)).toBeNull();
    });
  });

  describe("dimensions", () => {
    it.each(DIMENSION_CASES)(
      "measures $tex (display=$display)",
      ({ tex, display, widthEx, heightEx, depthEx }) => {
        const result = engine.render(tex, display);
        expect(result).not.toBeNull();
        expectNear(result!.widthEx, widthEx);
        expectNear(result!.heightEx, heightEx);
        expectNear(result!.depthEx, depthEx);
      },
    );
  });

  describe("failure and boundaries", () => {
    it("returns null for malformed TeX", () => {
      expect(engine.render(String.raw`\frac{a}{`, false)).toBeNull();
    });

    it("returns null for input longer than 4096 characters", () => {
      expect(engine.render("a".repeat(4097), false)).toBeNull();
    });

    it("accepts input with exactly 4096 characters", () => {
      const input = build4096CharInput();
      expect(input).toHaveLength(4096);
      expect(engine.render(input, false)).not.toBeNull();
    });

    // Empty/whitespace TeX has no formula content; callers fall back to source text.
    it("returns null for empty string", () => {
      expect(engine.render("", false)).toBeNull();
    });

    it("returns null for whitespace-only input", () => {
      expect(engine.render("   \t\n  ", false)).toBeNull();
    });
  });

  describe("security", () => {
    it("rejects \\href TeX without emitting javascript URLs", () => {
      const result = engine.render(String.raw`\href{javascript:alert(1)}{x}`, false);
      expect(result).toBeNull();
    });

    it("sanitized SVG output does not contain script tags", () => {
      const result = engine.render("E=mc^2", false);
      expect(result).not.toBeNull();
      expect(result!.svg.toLowerCase()).not.toContain("<script");
    });

    it("strips href attributes from SVG markup", () => {
      const malicious = [
        '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)">x</a></svg>',
        "<svg xmlns=\"http://www.w3.org/2000/svg\"><a HREF='javascript:alert(1)'>x</a></svg>",
        '<svg xmlns="http://www.w3.org/2000/svg"><use xlink:href="#evil"/></svg>',
        '<svg xmlns="http://www.w3.org/2000/svg"><use XLINK:HREF="#evil"/></svg>',
      ];

      for (const svg of malicious) {
        const sanitized = sanitizeMathSvgString(svg);
        expect(sanitized.toLowerCase()).not.toContain("href");
        expect(sanitized.toLowerCase()).not.toContain("javascript:");
      }
    });

    it("strips event handler attributes from SVG markup", () => {
      const malicious = [
        '<svg xmlns="http://www.w3.org/2000/svg" OnClick="alert(1)"><rect/></svg>',
        "<svg xmlns=\"http://www.w3.org/2000/svg\"><rect onmouseover='alert(1)'/></svg>",
      ];

      for (const svg of malicious) {
        const sanitized = sanitizeMathSvgString(svg);
        expect(sanitized.toLowerCase()).not.toMatch(/\son[a-z]+\s*=/);
      }
    });

    it("removes foreignObject elements from SVG markup", () => {
      const malicious =
        '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></body></foreignObject></svg>';
      const sanitized = sanitizeMathSvgString(malicious);
      expect(sanitized.toLowerCase()).not.toContain("<foreignobject");
    });

    it("removes script elements including multiline tags", () => {
      const malicious =
        '<svg xmlns="http://www.w3.org/2000/svg"><script\ntype="text/javascript">\nalert(1)\n</script></svg>';
      const sanitized = sanitizeMathSvgString(malicious);
      expect(sanitized.toLowerCase()).not.toContain("<script");
    });

    it("removes self-closing script and foreignObject tags", () => {
      expect(sanitizeMathSvgString("<svg><script/></svg>").toLowerCase()).not.toContain("<script");
      expect(sanitizeMathSvgString("<svg><foreignObject/></svg>").toLowerCase()).not.toContain(
        "<foreignobject",
      );
    });

    it("removes unclosed script tags", () => {
      const sanitized = sanitizeMathSvgString("<svg><script>alert(1)</svg>");
      expect(sanitized.toLowerCase()).not.toContain("<script");
    });

    it("removes root style attribute after sanitization", () => {
      const svg =
        '<svg style="vertical-align: -0.5ex;" xmlns="http://www.w3.org/2000/svg" width="1ex" height="1ex"></svg>';
      const sanitized = sanitizeMathSvgString(svg);
      expect(sanitized).not.toMatch(/\bstyle\s*=/i);
    });
  });

  describe("cache", () => {
    it("returns the same object reference for repeated (tex, display) calls", () => {
      const first = engine.render("E=mc^2", false);
      const second = engine.render("E=mc^2", false);
      expect(first).not.toBeNull();
      expect(second).toBe(first);
    });

    it("returns different results when display mode differs", () => {
      const inline = engine.render(String.raw`\int_0^1 f(x)\,dx`, false);
      const block = engine.render(String.raw`\int_0^1 f(x)\,dx`, true);
      expect(inline).not.toBeNull();
      expect(block).not.toBeNull();
      expect(block).not.toBe(inline);
    });

    it("evicts the oldest cache entry after 501 unique renders", async () => {
      const cachedEngine = await loadMathEngine();
      const firstTex = `cache-evict-first-${Date.now()}`;
      const firstResult = cachedEngine.render(firstTex, false);
      expect(firstResult).not.toBeNull();

      for (let index = 0; index < 600; index += 1) {
        cachedEngine.render(`cache-evict-${firstTex}-${index}`, false);
      }

      const firstAfterEviction = cachedEngine.render(firstTex, false);
      expect(firstAfterEviction).not.toBeNull();
      expect(firstAfterEviction).not.toBe(firstResult);
    });
  });

  describe("display vs inline sizing", () => {
    it("produces different dimensions for the same TeX in inline and display mode", () => {
      const tex = String.raw`\sum_{i=1}^n i`;
      const inline = engine.render(tex, false);
      const block = engine.render(tex, true);
      expect(inline).not.toBeNull();
      expect(block).not.toBeNull();
      expect(inline!.widthEx).not.toBe(block!.widthEx);
    });
  });
});

describe("loadMathEngine", () => {
  it("reuses the same engine promise across calls", async () => {
    const first = loadMathEngine();
    const second = loadMathEngine();
    expect(await first).toBe(await second);
  });
});
