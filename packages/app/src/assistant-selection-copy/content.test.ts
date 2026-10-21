/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { MARKDOWN_COPY_MATH_SOURCE_ATTRIBUTE } from "./markup";
import { createAssistantSelectionClipboardContent } from "./content.web";

function mountMessage(build: (message: HTMLElement) => void): HTMLElement {
  const host = document.createElement("div");
  const message = document.createElement("div");
  message.setAttribute("data-testid", "assistant-message");
  build(message);
  host.append(message);
  document.body.append(host);
  return message;
}

function selectNodeContents(element: Element): Selection {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  if (!selection) throw new Error("Expected browser selection");
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

function copiedMarkdown(selection: Selection): string | null {
  return createAssistantSelectionClipboardContent(selection)?.plainText ?? null;
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

describe("math formula copy", () => {
  it("copies the delimiter-inclusive source of each formula, including duplicates", () => {
    const message = mountMessage((root) => {
      const paragraph = document.createElement("div");
      paragraph.setAttribute("data-paseo-markdown-tag", "p");
      for (const source of [String.raw`\(x\)`, String.raw`$$x$$`]) {
        const formula = document.createElement("span");
        formula.setAttribute(MARKDOWN_COPY_MATH_SOURCE_ATTRIBUTE, source);
        formula.append(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
        paragraph.append(formula, " ");
      }
      root.append(paragraph);
    });
    const paragraph = message.firstElementChild;
    if (!paragraph) throw new Error("Expected paragraph fixture");
    expect(copiedMarkdown(selectNodeContents(paragraph))).toBe(String.raw`\(x\) $$x$$`);
  });

  it("copies a block formula selected as a whole element", () => {
    const blockSource = "$$\nx = 1\n$$";
    const message = mountMessage((root) => {
      const block = document.createElement("div");
      block.setAttribute(MARKDOWN_COPY_MATH_SOURCE_ATTRIBUTE, blockSource);
      block.append(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
      root.append(block);
    });
    const block = message.firstElementChild;
    const selection = window.getSelection();
    if (!block || !selection) throw new Error("Expected block formula fixture");
    const range = document.createRange();
    range.selectNode(block);
    selection.removeAllRanges();
    selection.addRange(range);
    expect(copiedMarkdown(selection)).toBe(blockSource);
  });
});
