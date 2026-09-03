import { describe, expect, it } from "vitest";
import { markdownAncestorFontSize, markdownNodeContainsType } from "./markdown-ast";

describe("markdownNodeContainsType", () => {
  it("matches the node itself", () => {
    expect(markdownNodeContainsType({ type: "image", children: [] }, "image")).toBe(true);
  });

  it("matches descendants", () => {
    const paragraph = {
      type: "paragraph",
      children: [
        { type: "text", children: [] },
        {
          type: "link",
          children: [{ type: "image", children: [] }],
        },
      ],
    };

    expect(markdownNodeContainsType(paragraph, "image")).toBe(true);
  });

  it("returns false when the type is absent", () => {
    const paragraph = {
      type: "paragraph",
      children: [
        { type: "text", children: [] },
        { type: "strong", children: [{ type: "text", children: [] }] },
      ],
    };

    expect(markdownNodeContainsType(paragraph, "image")).toBe(false);
  });
});

describe("markdownAncestorFontSize", () => {
  it("takes the nearest ancestor that declares a size", () => {
    const styles = { heading1: { fontSize: 30 }, body: { fontSize: 15 } };
    expect(markdownAncestorFontSize([{ type: "heading1" }, { type: "body" }], styles, 99)).toBe(30);
  });

  it("walks past ancestors with no size of their own", () => {
    const styles = { paragraph: { marginBottom: 12 }, body: { fontSize: 15 } };
    expect(markdownAncestorFontSize([{ type: "paragraph" }, { type: "body" }], styles, 99)).toBe(
      15,
    );
  });

  it("falls back when no ancestor declares a size", () => {
    expect(markdownAncestorFontSize([{ type: "paragraph" }], { paragraph: {} }, 99)).toBe(99);
  });
});
