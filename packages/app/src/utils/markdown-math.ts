import type MarkdownIt from "markdown-it";

const INLINE_OPEN = "\\(";
const INLINE_CLOSE = "\\)";
const BLOCK_BRACKET_OPEN = "\\[";
const BLOCK_BRACKET_CLOSE = "\\]";
const BLOCK_DOLLAR = "$$";
const CLOSE_POSITIONS_CACHE_PREFIX = "mathClosePositions:";

interface MarkdownToken {
  block?: boolean;
  content: string;
  map?: [number, number] | null;
  markup?: string;
}

interface InlineState {
  src: string;
  pos: number;
  posMax: number;
  pending: string;
  env: Record<string, unknown>;
  push(type: string, tag: string, nesting: number): MarkdownToken;
}

interface BlockState {
  src: string;
  line: number;
  lineMax: number;
  bMarks: number[];
  eMarks: number[];
  tShift: number[];
  sCount: number[];
  blkIndent: number;
  env: Record<string, unknown>;
  getLines(begin: number, end: number, indent: number, keepLastLF: boolean): string;
  push(type: string, tag: string, nesting: number): MarkdownToken;
}

function isEscapedBackslash(src: string, pos: number): boolean {
  let slashCount = 0;
  for (let index = pos - 1; index >= 0 && src.charCodeAt(index) === 0x5c; index--) {
    slashCount++;
  }
  return slashCount % 2 === 1;
}

function findAllUnescapedDelimiterPositions(src: string, delimiter: string): number[] {
  const positions: number[] = [];
  const delimiterLength = delimiter.length;

  for (let index = 0; index + delimiterLength <= src.length; index++) {
    if (src.startsWith(delimiter, index) && !isEscapedBackslash(src, index)) {
      positions.push(index);
      index += delimiterLength - 1;
    }
  }

  return positions;
}

interface ClosePositionsCacheEntry {
  src: string;
  positions: number[];
  lastUsed: number;
}

// markdown-it reuses the same env while calling md.inline.parse with different src values
// (for example image alt text vs the surrounding paragraph). A two-slot cache covers the
// typical body-src / alt-src alternation without hashing long strings as Map keys would.
interface ClosePositionsCache {
  slots: ClosePositionsCacheEntry[];
  useCounter: number;
}

function getClosePositions(
  env: Record<string, unknown>,
  src: string,
  closeDelimiter: string,
): readonly number[] {
  const cacheKey = `${CLOSE_POSITIONS_CACHE_PREFIX}${closeDelimiter}`;
  let cache = env[cacheKey] as ClosePositionsCache | undefined;
  if (!cache) {
    cache = { slots: [], useCounter: 0 };
    env[cacheKey] = cache;
  }

  for (const slot of cache.slots) {
    if (slot.src === src) {
      slot.lastUsed = ++cache.useCounter;
      return slot.positions;
    }
  }

  const positions = findAllUnescapedDelimiterPositions(src, closeDelimiter);
  const entry: ClosePositionsCacheEntry = {
    src,
    positions,
    lastUsed: ++cache.useCounter,
  };

  if (cache.slots.length < 2) {
    cache.slots.push(entry);
  } else {
    const olderSlotIndex = cache.slots[0].lastUsed < cache.slots[1].lastUsed ? 0 : 1;
    cache.slots[olderSlotIndex] = entry;
  }

  return positions;
}

function findClosingDelimiterInRange(
  positions: readonly number[],
  from: number,
  to: number,
): number {
  let low = 0;
  let high = positions.length - 1;
  let match = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const position = positions[mid];

    if (position < from) {
      low = mid + 1;
      continue;
    }
    if (position >= to) {
      high = mid - 1;
      continue;
    }

    match = position;
    high = mid - 1;
  }

  return match;
}

function findClosingDelimiter(
  env: Record<string, unknown>,
  src: string,
  closeDelimiter: string,
  from: number,
  to: number,
): number {
  return findClosingDelimiterInRange(getClosePositions(env, src, closeDelimiter), from, to);
}

function findClosingDelimiterBounded(
  src: string,
  closeDelimiter: string,
  from: number,
  to: number,
): number {
  const delimiterLength = closeDelimiter.length;

  for (let index = from; index + delimiterLength <= to; index++) {
    if (src.startsWith(closeDelimiter, index) && !isEscapedBackslash(src, index)) {
      return index;
    }
  }

  return -1;
}

function lineIndexAtPosition(
  state: BlockState,
  pos: number,
  startLine: number,
  endLine: number,
): number {
  for (let line = startLine; line < endLine; line++) {
    const lineStart = state.bMarks[line];
    const lineEnd = state.eMarks[line];
    if (pos >= lineStart && pos <= lineEnd) {
      return line;
    }
  }

  return Math.max(startLine, endLine - 1);
}

function findBlockClosing(
  state: BlockState,
  startLine: number,
  endLine: number,
  searchFrom: number,
  closeDelimiter: string,
): { closeLine: number; closePos: number } | null {
  const searchEnd = endLine > 0 ? state.eMarks[endLine - 1] : state.src.length;
  const closePos = findClosingDelimiterInRange(
    getClosePositions(state.env, state.src, closeDelimiter),
    searchFrom,
    searchEnd,
  );
  if (closePos === -1) {
    return null;
  }

  return {
    closeLine: lineIndexAtPosition(state, closePos, startLine, endLine),
    closePos,
  };
}

function pushMathToken(
  state: InlineState,
  type: "math_inline" | "math_block",
  openPos: number,
  openDelimiter: string,
  closePos: number,
  closeDelimiter: string,
  block: boolean,
): void {
  const content = state.src.slice(openPos + openDelimiter.length, closePos);
  const markup = state.src.slice(openPos, closePos + closeDelimiter.length);
  const token = state.push(type, "math", 0);
  token.block = block;
  // markup keeps the user-visible source including delimiters; phase 2 rendering
  // and clipboard fidelity read this field instead of re-wrapping content.
  token.content = content;
  token.markup = markup;
}

function parseInlineMath(
  state: InlineState,
  silent: boolean,
  openDelimiter: string,
  closeDelimiter: string,
  tokenType: "math_inline" | "math_block",
): boolean {
  if (silent) {
    return false;
  }

  const pos = state.pos;
  const max = state.posMax;

  if (!state.src.startsWith(openDelimiter, pos)) {
    return false;
  }

  const closePos = findClosingDelimiter(
    state.env,
    state.src,
    closeDelimiter,
    pos + openDelimiter.length,
    max,
  );
  if (closePos === -1) {
    return false;
  }

  if (!silent) {
    pushMathToken(state, tokenType, pos, openDelimiter, closePos, closeDelimiter, false);
  }
  state.pos = closePos + closeDelimiter.length;
  return true;
}

function parseInlineMathParen(state: InlineState, silent: boolean): boolean {
  return parseInlineMath(state, silent, INLINE_OPEN, INLINE_CLOSE, "math_inline");
}

function parseInlineMathBracket(state: InlineState, silent: boolean): boolean {
  return parseInlineMath(state, silent, BLOCK_BRACKET_OPEN, BLOCK_BRACKET_CLOSE, "math_block");
}

function parseInlineMathDollar(state: InlineState, silent: boolean): boolean {
  const pos = state.pos;
  if (!state.src.startsWith(BLOCK_DOLLAR, pos)) {
    return false;
  }
  return parseInlineMath(state, silent, BLOCK_DOLLAR, BLOCK_DOLLAR, "math_block");
}

function hasNonWhitespaceAfterClose(
  state: BlockState,
  closeLine: number,
  closePos: number,
  closeDelimiter: string,
): boolean {
  const afterClose = closePos + closeDelimiter.length;
  const lineEnd = state.eMarks[closeLine];
  return state.src.slice(afterClose, lineEnd).trim().length > 0;
}

function pushBlockMathToken(
  state: BlockState,
  startLine: number,
  closeLine: number,
  openDelimiter: string,
  closeDelimiter: string,
): void {
  const indent = state.sCount[startLine];
  const stripped = state.getLines(startLine, closeLine + 1, indent, false);
  const closeInStripped = findClosingDelimiterBounded(
    stripped,
    closeDelimiter,
    openDelimiter.length,
    stripped.length,
  );
  if (closeInStripped === -1) {
    return;
  }

  const markup = stripped.slice(0, closeInStripped + closeDelimiter.length);
  const content = stripped.slice(openDelimiter.length, closeInStripped);

  const token = state.push("math_block", "math", 0);
  token.block = true;
  token.map = [startLine, closeLine + 1];
  // markup is the container-stripped, delimiter-inclusive source that phase 2
  // feeds to KaTeX and restores into clipboard output.
  token.content = content;
  token.markup = markup;
}

function parseBlockMathDollar(
  state: BlockState,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  const openPos = state.bMarks[startLine] + state.tShift[startLine];
  const openMax = state.eMarks[startLine];

  if (state.sCount[startLine] - state.blkIndent >= 4) {
    return false;
  }
  if (!state.src.startsWith(BLOCK_DOLLAR, openPos) || openPos + BLOCK_DOLLAR.length > openMax) {
    return false;
  }

  const closing = findBlockClosing(
    state,
    startLine,
    endLine,
    openPos + BLOCK_DOLLAR.length,
    BLOCK_DOLLAR,
  );
  if (!closing) {
    return false;
  }
  if (hasNonWhitespaceAfterClose(state, closing.closeLine, closing.closePos, BLOCK_DOLLAR)) {
    return false;
  }

  if (silent) {
    return true;
  }

  pushBlockMathToken(state, startLine, closing.closeLine, BLOCK_DOLLAR, BLOCK_DOLLAR);
  state.line = closing.closeLine + 1;
  return true;
}

function parseBlockMathBracket(
  state: BlockState,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  const openPos = state.bMarks[startLine] + state.tShift[startLine];
  const openMax = state.eMarks[startLine];

  if (state.sCount[startLine] - state.blkIndent >= 4) {
    return false;
  }
  if (
    !state.src.startsWith(BLOCK_BRACKET_OPEN, openPos) ||
    openPos + BLOCK_BRACKET_OPEN.length > openMax
  ) {
    return false;
  }

  const closing = findBlockClosing(
    state,
    startLine,
    endLine,
    openPos + BLOCK_BRACKET_OPEN.length,
    BLOCK_BRACKET_CLOSE,
  );
  if (!closing) {
    return false;
  }
  if (hasNonWhitespaceAfterClose(state, closing.closeLine, closing.closePos, BLOCK_BRACKET_CLOSE)) {
    return false;
  }

  if (silent) {
    return true;
  }

  pushBlockMathToken(state, startLine, closing.closeLine, BLOCK_BRACKET_OPEN, BLOCK_BRACKET_CLOSE);
  state.line = closing.closeLine + 1;
  return true;
}

function renderMathSource(
  tokens: Array<{ block?: boolean; content: string; markup?: string }>,
  index: number,
): string {
  const token = tokens[index];
  const source = token.markup || token.content;
  return source
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function markdownMathPlugin(md: MarkdownIt): void {
  const blockRuleAlt = ["paragraph", "reference", "blockquote", "list"];

  // Before `escape`: `\(` must win over the core escape rule, which would strip
  // the delimiter and make closed inline math unrecognizable.
  md.inline.ruler.before("escape", "math_inline_paren", parseInlineMathParen);
  md.inline.ruler.before("escape", "math_inline_bracket", parseInlineMathBracket);
  md.inline.ruler.before("escape", "math_inline_dollar", parseInlineMathDollar);

  // Before `paragraph`: standalone `$$` / `\[` blocks should not get folded into
  // a paragraph when the closing delimiter is on a later line.
  md.block.ruler.before("paragraph", "math_block_dollar", parseBlockMathDollar, {
    alt: blockRuleAlt,
  });
  md.block.ruler.before("paragraph", "math_block_bracket", parseBlockMathBracket, {
    alt: blockRuleAlt,
  });

  md.renderer.rules.math_inline = (tokens, index) => renderMathSource(tokens, index);
  md.renderer.rules.math_block = (tokens, index) => {
    const rendered = renderMathSource(tokens, index);
    return tokens[index].block ? `${rendered}\n` : rendered;
  };
}
