import { describe, expect, it } from "vitest";
import MarkdownIt from "markdown-it";
import { createMarkdownParser } from "./markdown-parser";
import { adaptMathSource, markdownMathPlugin } from "./markdown-math";
import type { ASTNode } from "react-native-enriched-markdown/src/web/types";

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

function formulaSources(markdown: string): string[] {
  return [...adaptMathSource(markdown, "web").formulas.values()].map((formula) => formula.source);
}

function latexText(node: { content?: string; children?: Array<{ content?: string }> }): string {
  const nested = (node.children ?? []).map((child) => child.content ?? "").join("");
  return (nested || node.content || "").trim();
}

describe("adaptMathSource", () => {
  it("normalizes fork delimiters and keeps a single dollar as currency", () => {
    const source = String.raw`Cost $5. Inline \(x\) and \[y\] on one line.`;
    expect(adaptMathSource(source, "native").markdown).toBe(
      String.raw`Cost \$5. Inline $x$ and $y$ on one line.`,
    );
    expect(adaptMathSource(source, "native").formulas.size).toBe(0);
  });

  it("distinguishes display blocks from inline formulas, including duplicate TeX", () => {
    const source = "\\(x\\)\n\n\\[\nx\n\\]\n\n$$\nx\n$$";
    const web = adaptMathSource(source, "web");
    const formulas = [...web.formulas.entries()];
    expect(formulas.map(([, formula]) => [formula.display, formula.source, formula.tex])).toEqual([
      [false, "\\(x\\)", "x"],
      [true, "\\[\nx\n\\]", "\nx\n"],
      [true, "$$\nx\n$$", "\nx\n"],
    ]);
    expect(new Set(formulas.map(([id]) => id)).size).toBe(3);
    expect(web.markdown).toBe(
      `$${formulas[0]?.[0]}$\n\n$$${formulas[1]?.[0]}$$\n\n$$${formulas[2]?.[0]}$$`,
    );
    expect(adaptMathSource(source, "native").markdown).toBe("$x$\n\n$$\nx\n$$\n\n$$\nx\n$$");
  });

  it("leaves unfinished, escaped, and code-bound delimiters untouched", () => {
    const source = [
      "Unfinished \\(x",
      "Escaped \\\\(x\\\\)",
      "`\\(x\\)` and `$5`",
      "```",
      "\\(x\\)",
      "$5",
      "```",
    ].join("\n");
    expect(adaptMathSource(source, "native").markdown).toBe(source);
    expect(adaptMathSource(source, "web").formulas.size).toBe(0);
  });

  it("keeps the formula that follows an identical delimiter inside inline code", () => {
    const source = "`\\(x\\)`\n\n\\(x\\)";
    expect(adaptMathSource(source, "native").markdown).toBe("`\\(x\\)`\n\n$x$");
    expect(formulaSources(source)).toEqual(["\\(x\\)"]);
  });

  it("maps inline math when a blockquote prefix breaks the fragment", () => {
    const source = "> Start\n> \\(x\\)";
    expect(adaptMathSource(source, "native").markdown).toBe("> Start\n> $x$");
    expect(formulaSources(source)).toEqual(["\\(x\\)"]);
  });

  it("maps the same blockquote fragment at each occurrence", () => {
    const source = "> Start\n> \\(x\\)\n\n> Start\n> \\(x\\)";
    expect(adaptMathSource(source, "native").markdown).toBe("> Start\n> $x$\n\n> Start\n> $x$");
    expect(formulaSources(source)).toEqual(["\\(x\\)", "\\(x\\)"]);
  });

  it("preserves dollars that are already escaped", () => {
    const source = String.raw`Cost \$5 and \$10`;
    expect(adaptMathSource(source, "native").markdown).toBe(source);
    expect(adaptMathSource(source, "web").formulas.size).toBe(0);
  });

  it("keeps already escaped dollars inside TeX byte-identical", () => {
    const source = String.raw`\(\text{\$5}\)`;
    expect(adaptMathSource(source, "native").markdown).toBe(String.raw`$\text{\$5}$`);
    expect(formulaSources(source)).toEqual([String.raw`\(\text{\$5}\)`]);
  });

  it("does not insert whitespace around math glued to letters", () => {
    expect(adaptMathSource(String.raw`a\(x\)b`, "native").markdown).toBe("a$x$b");
  });

  it("keeps indented code, link and image targets, and container markers", () => {
    const source = [
      "    \\(x\\)",
      "",
      "[label \\(a\\)](https://example.com/$id)",
      "",
      "![alt \\(b\\)](https://example.com/$img.png)",
      "",
      "> \\(c\\)",
      "",
      "- \\(d\\)",
      "",
      "| \\(e\\) |",
      "| --- |",
    ].join("\n");
    expect(adaptMathSource(source, "native").markdown).toBe(
      [
        "    \\(x\\)",
        "",
        "[label $a$](https://example.com/$id)",
        "",
        "![alt $b$](https://example.com/$img.png)",
        "",
        "> $c$",
        "",
        "- $d$",
        "",
        "| $e$ |",
        "| --- |",
      ].join("\n"),
    );
  });

  it("maps repeated image alt formulas independently", () => {
    const source = "![\\(x\\)](a.png) ![\\(x\\)](b.png)";
    expect(adaptMathSource(source, "native").markdown).toBe("![$x$](a.png) ![$x$](b.png)");
  });

  it("strips quote markers only from the copied block source", () => {
    const source = "> \\[\n> y\n> \\]\n> after";
    const web = adaptMathSource(source, "web");
    expect(formulaSources(source)).toEqual(["\\[\ny\n\\]"]);
    expect([...web.formulas.values()][0]).toMatchObject({ tex: "\ny\n", display: true });
    expect(web.markdown).toBe(`> $$${[...web.formulas.keys()][0]}$$\n> after`);
  });

  it("parses the normalized source through the enriched math parser", async () => {
    const parseMarkdown = await import("react-native-enriched-markdown/src/web/parseMarkdown").then(
      (module) => module.parseMarkdown,
    );
    const source = "Cost $5. Use \\(x\\).\n\n\\[\ny\n\\]";
    const tree = await parseMarkdown(adaptMathSource(source, "native").markdown, {
      latexMath: true,
      hardSoftBreaks: true,
    });
    const math: Array<{ type: string; content?: string; children?: Array<{ content?: string }> }> =
      [];
    const visit = (node: ASTNode) => {
      if (node.type === "LatexMathInline" || node.type === "LatexMathDisplay") math.push(node);
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree);
    expect(math.map((node) => [node.type, latexText(node)])).toEqual([
      ["LatexMathInline", "x"],
      ["LatexMathDisplay", "y"],
    ]);
    expect(JSON.stringify(tree)).toContain("$5");
    expect(JSON.stringify(tree)).not.toContain('LatexMathInline","content":"5');
  });
});

it("maps formulas after CRLF normalization and heading closing marks", () => {
  expect(adaptMathSource("First \\(x\\)\r\n\r\nSecond \\(y\\)", "native").markdown).toBe(
    "First $x$\n\nSecond $y$",
  );
  expect(adaptMathSource(String.raw`# \(x\) #`, "native").markdown).toBe("# $x$ #");
  expect(adaptMathSource(String.raw`## **\(x\)** ##`, "native").markdown).toBe("## **$x$** ##");
});
