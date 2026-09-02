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
  if (!selection) {
    throw new Error("Expected browser selection");
  }
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

describe("restoreMarkdownElements math copy markers", () => {
  it("replaces a marked formula element with its TeX source", () => {
    const message = mountMessage((root) => {
      const paragraph = document.createElement("div");
      paragraph.setAttribute("data-paseo-markdown-tag", "p");
      paragraph.append("设 ");
      const formula = document.createElement("span");
      formula.setAttribute(MARKDOWN_COPY_MATH_SOURCE_ATTRIBUTE, String.raw`\(x\)`);
      formula.append(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
      paragraph.append(formula, " 为变量");
      root.append(paragraph);
    });
    const paragraph = message.firstElementChild;
    if (!paragraph) {
      throw new Error("Expected paragraph fixture");
    }

    expect(copiedMarkdown(selectNodeContents(paragraph))).toBe(String.raw`设 \(x\) 为变量`);
  });

  it("restores multiple formulas in one paragraph", () => {
    const message = mountMessage((root) => {
      const paragraph = document.createElement("div");
      paragraph.setAttribute("data-paseo-markdown-tag", "p");
      for (const [index, source] of [String.raw`\(a\)`, String.raw`\(b\)`].entries()) {
        if (index > 0) {
          paragraph.append(" 和 ");
        }
        const formula = document.createElement("span");
        formula.setAttribute(MARKDOWN_COPY_MATH_SOURCE_ATTRIBUTE, source);
        formula.append(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
        paragraph.append(formula);
      }
      root.append(paragraph);
    });
    const paragraph = message.firstElementChild;
    if (!paragraph) {
      throw new Error("Expected paragraph fixture");
    }

    expect(copiedMarkdown(selectNodeContents(paragraph))).toBe(String.raw`\(a\) 和 \(b\)`);
  });

  it("restores block formulas", () => {
    const blockSource = "$$\nx = 1\n$$";
    const message = mountMessage((root) => {
      const block = document.createElement("div");
      block.setAttribute(MARKDOWN_COPY_MATH_SOURCE_ATTRIBUTE, blockSource);
      block.append(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
      root.append(block);
    });
    const block = message.firstElementChild;
    if (!block) {
      throw new Error("Expected block formula fixture");
    }

    expect(copiedMarkdown(selectNodeContents(block))).toBe(blockSource);
  });

  it("leaves unmarked content unchanged", () => {
    const message = mountMessage((root) => {
      root.innerHTML =
        '<div data-paseo-markdown-tag="p">Prefix <span data-paseo-markdown-tag="strong">bold</span> suffix.</div>';
    });
    const paragraph = message.firstElementChild;
    if (!paragraph) {
      throw new Error("Expected paragraph fixture");
    }

    expect(copiedMarkdown(selectNodeContents(paragraph))).toBe("Prefix **bold** suffix.");
  });
});
