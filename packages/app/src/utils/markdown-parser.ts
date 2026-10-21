import MarkdownIt from "markdown-it";
import { markdownMathPlugin } from "./markdown-math";

/**
 * Markdown parser for rich clipboard export.
 *
 * `typographer` stays off. It switches on two markdown-it core rules that
 * rewrite characters the user may copy back into a shell or a file:
 * `replacements` turns `(c)` into ©, `a -- b` into an en dash and `...` into
 * an ellipsis, and `smartquotes` curls straight quotes so `--name="x"` stops
 * being pasteable. Agent output, plans and file previews all have to render
 * the text they were handed.
 *
 * Callers choose whether bare URLs should become links in the exported HTML.
 */
export function createMarkdownParser({ linkify }: { linkify: boolean }): MarkdownIt {
  // Clipboard HTML preserves the same math delimiters as the screen adapter.
  return new MarkdownIt({ html: false, linkify }).use(markdownMathPlugin);
}
