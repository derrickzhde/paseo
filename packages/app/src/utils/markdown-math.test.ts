import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import MarkdownIt from "markdown-it";
import { createMarkdownParser } from "./markdown-parser";
import { markdownMathPlugin } from "./markdown-math";

interface MathToken {
  type: string;
  content: string;
  markup?: string;
}

interface ParsedToken {
  type: string;
  content: string;
  markup?: string;
  block?: boolean;
  children?: ParsedToken[] | null;
}

function collectMathTokens(tokens: ParsedToken[]): MathToken[] {
  return tokens.flatMap((token) => {
    const nested =
      token.children && token.children.length > 0 ? collectMathTokens(token.children) : [];
    if (token.type === "math_inline" || token.type === "math_block") {
      return [
        {
          type: token.type,
          content: token.content,
          markup: token.markup,
        },
        ...nested,
      ];
    }
    return nested;
  });
}

function parseMathTokens(markdown: string): MathToken[] {
  const parser = new MarkdownIt({ html: false, linkify: false }).use(markdownMathPlugin);
  return collectMathTokens(parser.parse(markdown, {}));
}

function createBaselineParsers() {
  const base = new MarkdownIt({ html: false, linkify: true });
  const withMath = new MarkdownIt({ html: false, linkify: true }).use(markdownMathPlugin);
  return { base, withMath };
}

function findTopLevelMathBlocks(tokens: ParsedToken[]): ParsedToken[] {
  return tokens.filter((token) => token.type === "math_block");
}

function measureParse(parser: MarkdownIt, input: string): number {
  const start = performance.now();
  parser.parse(input, {});
  return performance.now() - start;
}

function buildUnclosedBracketInput(lineCount: number): string {
  return Array.from({ length: lineCount }, (_, index) => String.raw`\[ line ${index}`).join("\n");
}

function buildUnclosedDollarInput(lineCount: number): string {
  return ["$$", ...Array.from({ length: lineCount }, (_, index) => `line ${index}`)].join("\n");
}

function buildImageMathOscillationInput(repeatCount: number): string {
  return Array.from({ length: repeatCount }, () => String.raw`![\(z\)](x) \(a\)`).join(" ");
}

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

function walkSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...walkSourceFiles(fullPath));
      continue;
    }
    if (SOURCE_EXTENSIONS.has(extname(entry))) {
      files.push(fullPath);
    }
  }
  return files;
}

interface MarkdownRulesFactory {
  file: string;
  name: string;
  body: string;
}

// Source scan only: importing message.tsx for runtime rules checks pulls in the full
// RN/Expo/Reanimated dependency chain, which is disproportionate for a guard test.
function findMarkdownRulesFactories(): MarkdownRulesFactory[] {
  const appSrcRoot = resolve(import.meta.dirname, "..");
  const factories: MarkdownRulesFactory[] = [];

  for (const filePath of walkSourceFiles(appSrcRoot)) {
    const source = readFileSync(filePath, "utf8");
    const starts = [...source.matchAll(/export function (create\w*MarkdownRules)/g)];
    for (const [index, match] of starts.entries()) {
      const factoryStart = match.index ?? 0;
      factories.push({
        file: relative(appSrcRoot, filePath),
        name: match[1],
        body: source.slice(factoryStart, starts[index + 1]?.index),
      });
    }
  }

  return factories;
}

function sliceRule(factory: MarkdownRulesFactory, ruleName: string): string {
  const start = factory.body.indexOf(`${ruleName}: (`);
  expect(start, `${factory.file}::${factory.name} 缺少 ${ruleName} 规则`).toBeGreaterThan(-1);
  return factory.body.slice(start);
}

function buildVariableParagraphMathSource(
  expressions: string[],
  wrapExpression: (expression: string) => string,
): string {
  return expressions
    .map((expression, index) => {
      const padding = "长".repeat(8 + index * 11);
      return `${padding} ${wrapExpression(expression)} 完`;
    })
    .join("\n\n");
}

function expectMathContents(source: string, expectedContents: string[]): void {
  const tokens = parseMathTokens(source);
  expect(tokens).toHaveLength(expectedContents.length);
  expect(tokens.map((token) => token.content)).toEqual(expectedContents);
}

describe("markdownMathPlugin", () => {
  it("recognizes inline \\( … \\) delimiters", () => {
    const tokens = parseMathTokens(String.raw`prefix \(E=mc^2\) suffix`);

    expect(tokens).toEqual([
      {
        type: "math_inline",
        content: "E=mc^2",
        markup: String.raw`\(E=mc^2\)`,
      },
    ]);
  });

  it("recognizes block \\[ … \\] delimiters", () => {
    const tokens = parseMathTokens(String.raw`\[\int_0^1 x\,dx\]`);

    expect(tokens).toEqual([
      {
        type: "math_block",
        content: String.raw`\int_0^1 x\,dx`,
        markup: String.raw`\[\int_0^1 x\,dx\]`,
      },
    ]);
  });

  it("recognizes block $$ … $$ delimiters", () => {
    const tokens = parseMathTokens("$$\n\\alpha + \\beta\n$$");

    expect(tokens).toEqual([
      {
        type: "math_block",
        content: "\n\\alpha + \\beta\n",
        markup: "$$\n\\alpha + \\beta\n$$",
      },
    ]);
  });

  it("does not treat single $ as math", () => {
    const dollarCases = ["价格是 $5 和 $10", "echo $HOME:$PATH"];

    for (const source of dollarCases) {
      expect(parseMathTokens(source)).toEqual([]);
    }
  });

  it("does not parse math inside fenced code blocks", () => {
    const source = ["```", String.raw`\[x\]`, "$$x$$", "```"].join("\n");

    expect(parseMathTokens(source)).toEqual([]);
  });

  it("does not parse math inside inline code", () => {
    expect(parseMathTokens("`\\(x\\)`")).toEqual([]);
  });

  it("leaves unclosed block delimiters as plain text", () => {
    const source = String.raw`\[ 未完成`;

    expect(parseMathTokens(source)).toEqual([]);
    expect(new MarkdownIt({ html: false }).use(markdownMathPlugin).render(source)).toBe(
      "<p>[ 未完成</p>\n",
    );
  });

  it("matches baseline HTML when no paired math delimiters are present", () => {
    const { base, withMath } = createBaselineParsers();
    const sources = [
      String.raw`\( 未完成`,
      String.raw`a \(b c`,
      String.raw`答案是 \[ \frac{a}{b}`,
      "echo $HOME:$PATH 和 $5",
      String.raw`[链接](https://x.com/a\(b\)c)`,
      String.raw`a \\(b\\) c`,
      String.raw`    \[x\]`,
      ["```", String.raw`\[x\]`, "$$x$$", "```"].join("\n"),
    ];

    for (const source of sources) {
      expect(withMath.render(source)).toBe(base.render(source));
    }
  });

  it("keeps trailing text after same-line block delimiters", () => {
    const parser = new MarkdownIt({ html: false }).use(markdownMathPlugin);

    expect(parser.render("$$a$$ 后面的字")).toContain("后面的字");
    expect(parser.render(String.raw`\[a\] 后面的字`)).toContain("后面的字");
    expect(parser.render("$$a$$")).toBe(`${escapeHtml("$$a$$")}\n`);
  });

  it("marks standalone block math tokens with block: true", () => {
    const tokens = new MarkdownIt({ html: false })
      .use(markdownMathPlugin)
      .parse("前段\n\n$$\nx = 1\n$$\n\n后段", {});

    expect(tokens.filter((token) => token.type === "math_block")).toEqual([
      expect.objectContaining({
        type: "math_block",
        block: true,
      }),
    ]);
  });

  it("marks inline-position math_block tokens with block: false", () => {
    const tokens = new MarkdownIt({ html: false }).use(markdownMathPlugin).parse("前 $$x$$ 后", {});

    const inlineToken = tokens.find((token) => token.type === "inline");
    const inlineMathBlocks = (inlineToken?.children ?? []).filter(
      (token) => token.type === "math_block",
    );
    expect(inlineMathBlocks).toEqual([
      expect.objectContaining({
        type: "math_block",
        block: false,
      }),
    ]);
  });

  it("parses multiline block math as a top-level block token", () => {
    const source = "结果如下：\n$$\nx = 1\n$$";
    const tokens = new MarkdownIt({ html: false }).use(markdownMathPlugin).parse(source, {});

    expect(findTopLevelMathBlocks(tokens)).toEqual([
      expect.objectContaining({
        type: "math_block",
        block: true,
        content: "\nx = 1\n",
      }),
    ]);
  });

  it("renders math HTML with the original TeX source", () => {
    const parser = new MarkdownIt({ html: false }).use(markdownMathPlugin);

    expect(parser.render(String.raw`see \(x^2\) now`)).toBe(
      `<p>${escapeHtml(String.raw`see \(x^2\) now`)}</p>\n`,
    );
    expect(parser.render(String.raw`\[\sum_i x_i\]`)).toBe(
      `${escapeHtml(String.raw`\[\sum_i x_i\]`)}\n`,
    );
    expect(parser.render("$$a+b$$")).toBe(`${escapeHtml("$$a+b$$")}\n`);
  });

  it("is wired through createMarkdownParser", () => {
    const parser = createMarkdownParser({ linkify: false });
    const tokens = collectMathTokens(parser.parse(String.raw`inline \(a\) and block $$b$$`, {}));

    expect(tokens.map((token) => token.type)).toEqual(["math_inline", "math_block"]);
  });

  it("registers math rules on every markdown render surface", () => {
    const factories = findMarkdownRulesFactories();
    expect(factories.length, "新增或删除 markdown 规则表时必须同步维护公式规则").toBe(3);

    for (const factory of factories) {
      expect(factory.body, `${factory.file}::${factory.name}`).toContain("math_inline:");
      expect(factory.body, `${factory.file}::${factory.name}`).toContain("math_block:");
    }
  });

  // Formula paragraphs use a View host on iOS: inline attachment baselines cannot
  // be expressed by the UITextView wrapper without overlapping adjacent lines.
  it("gives formula paragraphs the View host", () => {
    const factories = findMarkdownRulesFactories().filter((factory) =>
      factory.body.includes("MarkdownParagraphView"),
    );
    expect(factories.length, "使用 iOS 文本容器的规则表数量变了，请复查公式路径").toBe(2);

    for (const factory of factories) {
      expect(
        sliceRule(factory, "math_block"),
        `${factory.file}::${factory.name} 块级公式需要 View 容器`,
      ).toMatch(/<MarkdownParagraphView[^>]*\scontainsImage[\s>]/);
      expect(
        sliceRule(factory, "paragraph"),
        `${factory.file}::${factory.name} 含公式段落需要 View 容器`,
      ).toContain("containsImage={paragraphNeedsViewHost(node)}");
      expect(
        sliceRule(factory, "textgroup"),
        `${factory.file}::${factory.name} 含公式的 textgroup 需要重置行高`,
      ).toContain("if (textGroupContainsMath(node))");
      expect(
        sliceRule(factory, "textgroup"),
        `${factory.file}::${factory.name} 公式 textgroup 需要平台专用行高处理`,
      ).toContain("MarkdownMathTextGroupProvider");
    }
  });

  // Inline formulas survive on iOS only because react-native-uitextview turns a
  // non-text child into a text attachment, which landed in 2.6.0. On 2.2.0 — what
  // 0.7.4 shipped — the SVG is dropped and every formula renders blank.
  it("requires a react-native-uitextview that lays out inline views", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };
    const range = manifest.dependencies["react-native-uitextview"];
    const [major, minor] = range.replace(/^\D*/, "").split(".").map(Number);

    expect(
      major > 2 || (major === 2 && minor >= 6),
      `react-native-uitextview ${range} 没有行内视图支持，iOS 公式会变空白`,
    ).toBe(true);
  });

  it("does not break markdown links when parentheses appear inside link labels", () => {
    const { base, withMath } = createBaselineParsers();
    const cases = [
      String.raw`[label \(](url) tail \)`,
      String.raw`见 [文档 \(](https://x.com) 说明 \)`,
    ];

    for (const source of cases) {
      expect(withMath.render(source)).toBe(base.render(source));
    }
  });

  it("recognizes inline math inside link labels", () => {
    const parser = new MarkdownIt({ html: false, linkify: false }).use(markdownMathPlugin);
    const source = String.raw`[见 \(x\) 文档](url)`;

    expect(collectMathTokens(parser.parse(source, {}))).toEqual([
      {
        type: "math_inline",
        content: "x",
        markup: String.raw`\(x\)`,
      },
    ]);
    expect(parser.render(source)).toBe(
      `<p><a href="url">${escapeHtml(String.raw`见 \(x\) 文档`)}</a></p>\n`,
    );
  });

  it("keeps links and inline math in the same paragraph", () => {
    const parser = new MarkdownIt({ html: false, linkify: false }).use(markdownMathPlugin);
    const source = String.raw`[a](u1) 和 \(x\) 和 [b](u2)`;

    expect(collectMathTokens(parser.parse(source, {}))).toEqual([
      {
        type: "math_inline",
        content: "x",
        markup: String.raw`\(x\)`,
      },
    ]);
    expect(parser.render(source)).toBe(
      `<p><a href="u1">a</a> 和 ${escapeHtml(String.raw`\(x\)`)} 和 <a href="u2">b</a></p>\n`,
    );
  });

  it("parses image alt text and body math without cache thrashing", () => {
    const baseline = new MarkdownIt({ html: false, linkify: false });
    const withMath = createMarkdownParser({ linkify: false });

    for (const repeatCount of [500, 2000, 8000, 16000]) {
      const input = buildImageMathOscillationInput(repeatCount);
      const baselineMs = measureParse(baseline, input);
      const withMathMs = measureParse(withMath, input);
      expect(withMathMs).toBeLessThan(baselineMs * 5 + 50);
    }
  });

  it("parses inline math in every paragraph when paragraph lengths differ", () => {
    const expressions = ["p0", "p1", "p2", "p3", "p4"];

    expectMathContents(
      buildVariableParagraphMathSource(expressions, (expression) => String.raw`\(${expression}\)`),
      expressions,
    );
    expectMathContents(
      buildVariableParagraphMathSource(expressions, (expression) => `$$${expression}$$`),
      expressions,
    );
    expectMathContents(
      buildVariableParagraphMathSource(expressions, (expression) => String.raw`\[${expression}\]`),
      expressions,
    );
  });

  it("does not reuse close-position indexes across paragraphs", () => {
    const cases = [
      {
        source: "这是很长很长很长很长很长很长的第一段 \\(a\\) 结束了\n\n短 \\(b\\) 完",
        contents: ["a", "b"],
      },
      {
        source: "短 \\(a\\) 完\n\n这是很长很长很长很长很长很长的第二段 \\(b\\) 结束了",
        contents: ["a", "b"],
      },
      {
        source: "第一段 \\(a\\) 完\n\n第二段稍长一点点 \\(b\\) 完\n\n三 \\(c\\) 完",
        contents: ["a", "b", "c"],
      },
      {
        source: "第一段很长很长很长很长 $$a$$ 完\n\n二 $$b$$ 完",
        contents: ["a", "b"],
      },
      {
        source: String.raw`第一段很长很长很长很长 \[a\] 完\n\n二 \[b\] 完`,
        contents: ["a", "b"],
      },
    ];

    for (const { source, contents } of cases) {
      expectMathContents(source, contents);
    }
  });

  it("strips container prefixes from block math content", () => {
    const parser = new MarkdownIt({ html: false }).use(markdownMathPlugin);
    const blockquote = "> \\[\n> x = 1\n> \\]";
    const list = "- \\[\n  x = 1\n  \\]";

    expect(collectMathTokens(parser.parse(blockquote, {}))[0]?.content).toBe("\nx = 1\n");
    expect(parser.render(blockquote)).not.toContain("&gt;");
    expect(collectMathTokens(parser.parse(list, {}))[0]?.content).toBe("\nx = 1\n");
  });

  it("parses unclosed block delimiters without pathological slowdown", () => {
    const baseline = new MarkdownIt({ html: false, linkify: false });
    const withMath = createMarkdownParser({ linkify: false });

    for (const lineCount of [250, 500, 1000, 2000]) {
      for (const input of [
        buildUnclosedBracketInput(lineCount),
        buildUnclosedDollarInput(lineCount),
      ]) {
        const baselineMs = measureParse(baseline, input);
        const withMathMs = measureParse(withMath, input);
        expect(withMathMs).toBeLessThan(baselineMs * 5 + 50);
      }
    }
  });

  it("does not append a newline for inline-position math_block HTML", () => {
    const parser = new MarkdownIt({ html: false }).use(markdownMathPlugin);

    expect(parser.render(String.raw`before \[x\] after`)).toBe(
      `<p>${escapeHtml(String.raw`before \[x\] after`)}</p>\n`,
    );
  });
});

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
