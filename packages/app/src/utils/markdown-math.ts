import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";

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
  type?: string;
}

interface SourceRange {
  start: number;
  end: number;
  /** `state.src` the offsets were measured against. Inline rules see a fragment. */
  src: string;
}

interface CapturedMath extends SourceRange {
  tex: string;
  source: string;
  display: boolean;
}

interface MathCapture {
  root: string;
  spans: CapturedMath[];
  protectedRanges: SourceRange[];
}

interface OriginFrame {
  src: string;
  /** Document index of each `src` character. Length equals `src.length`. */
  positions: number[];
  inlineState: { pos: number } | null;
}

interface MappingToken {
  type: string;
  content: string;
  map?: [number, number] | null;
  children?: Token[];
}

interface MappingState {
  src: string;
  tokens: MappingToken[];
  bMarks: number[];
  eMarks: number[];
  tShift: number[];
  bsCount: number[];
  blkIndent: number;
}

let frames: OriginFrame[] = [];
let pendingPositions: number[] | null = null;
const inlineOrigins = new WeakMap<object, number[]>();

let activeCapture: MathCapture | null = null;

function toAbsolute(
  src: string,
  start: number,
  end: number,
): { start: number; end: number } | null {
  const root = activeCapture?.root;
  if (!root || start < 0 || start >= end) return null;
  const frame = frames.at(-1);
  if (!frame) {
    if (src !== root || end > root.length) return null;
    return { start, end };
  }
  if (frame.src !== src || end > frame.positions.length) return null;
  const absStart = frame.positions[start];
  const absEnd = frame.positions[end - 1];
  if (absStart === undefined || absEnd === undefined || absStart < 0 || absEnd < 0) return null;
  return { start: absStart, end: absEnd + 1 };
}

function recordSpan(
  src: string,
  start: number,
  end: number,
  tex: string,
  source: string,
  display: boolean,
): void {
  if (!activeCapture) return;
  const absolute = toAbsolute(src, start, end);
  if (!absolute) return;
  activeCapture.spans.push({
    src: activeCapture.root,
    start: absolute.start,
    end: absolute.end,
    tex,
    source,
    display,
  });
}

function recordProtected(src: string, start: number, end: number): void {
  if (!activeCapture) return;
  const absolute = toAbsolute(src, start, end);
  if (!absolute) return;
  activeCapture.protectedRanges.push({
    src: activeCapture.root,
    start: absolute.start,
    end: absolute.end,
  });
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
  recordSpan(state.src, openPos, closePos + closeDelimiter.length, content, markup, block);
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
  openPos: number,
  closePos: number,
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
  recordSpan(state.src, openPos, closePos + closeDelimiter.length, content, markup, true);
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

  pushBlockMathToken(
    state,
    startLine,
    closing.closeLine,
    BLOCK_DOLLAR,
    BLOCK_DOLLAR,
    openPos,
    closing.closePos,
  );
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

  pushBlockMathToken(
    state,
    startLine,
    closing.closeLine,
    BLOCK_BRACKET_OPEN,
    BLOCK_BRACKET_CLOSE,
    openPos,
    closing.closePos,
  );
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
  installSourceGuards(md);
  installPositionMapping(md);
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

interface InlineRuleState {
  src: string;
  pos: number;
}

interface NamedRule {
  name: string;
  fn: (state: InlineRuleState, silent: boolean) => boolean;
}

const SOURCE_GUARDS = Symbol("paseoMathSourceGuards");

function installSourceGuards(md: MarkdownIt): void {
  const marked = md as MarkdownIt & { [SOURCE_GUARDS]?: boolean };
  if (marked[SOURCE_GUARDS]) return;
  marked[SOURCE_GUARDS] = true;
  wrapInlineRule(md, "backticks", (state, start, end) => {
    recordProtected(state.src, start, end);
  });
  wrapInlineRule(md, "autolink", (state, start, end) => {
    recordProtected(state.src, start, end);
  });
  wrapInlineRule(md, "link", protectDestination);
  wrapInlineRule(md, "image", protectDestination);
}

function wrapInlineRule(
  md: MarkdownIt,
  name: string,
  afterMatch: (state: InlineRuleState, start: number, end: number) => void,
): void {
  const rules = (md.inline.ruler as unknown as { __rules__: NamedRule[] }).__rules__;
  const rule = rules?.find((item) => item.name === name);
  if (!rule) return;
  const original = rule.fn;
  rule.fn = (state, silent) => {
    const start = state.pos;
    const matched = original(state, silent);
    if (matched && !silent) afterMatch(state, start, state.pos);
    return matched;
  };
}

function protectDestination(state: InlineRuleState, start: number, end: number): void {
  const marker = state.src.slice(start, end).lastIndexOf("](");
  if (marker < 0 || !activeCapture) return;
  const destinationStart = start + marker + 2;
  const destinationEnd = state.src[end - 1] === ")" ? end - 1 : end;
  if (destinationEnd > destinationStart) {
    recordProtected(state.src, destinationStart, destinationEnd);
  }
}

const POSITION_MAPPING = Symbol("paseoMathPositionMapping");

function installPositionMapping(md: MarkdownIt): void {
  const marked = md as MarkdownIt & { [POSITION_MAPPING]?: boolean };
  if (marked[POSITION_MAPPING]) return;
  marked[POSITION_MAPPING] = true;
  wrapBlockRule(md, "paragraph", captureFlowContent);
  wrapBlockRule(md, "lheading", captureFlowContent);
  wrapBlockRule(md, "heading", captureHeading);
  wrapBlockRule(md, "table", captureTable);
  replaceCoreInline(md);
  wrapInlineParse(md);
}

function wrapBlockRule(
  md: MarkdownIt,
  name: string,
  capture: (state: MappingState, before: number) => void,
): void {
  const ruler = md.block.ruler as unknown as {
    __rules__: Array<{ name: string; fn: (...args: never[]) => boolean }>;
    __cache__: unknown;
  };
  const rule = ruler.__rules__.find((item) => item.name === name);
  if (!rule) return;
  const original = rule.fn;
  rule.fn = ((state: MappingState, startLine: number, endLine: number, silent: boolean) => {
    const before = state.tokens.length;
    const matched = original(state as never, startLine as never, endLine as never, silent as never);
    if (matched && !silent && activeCapture) capture(state, before);
    return matched;
  }) as typeof original;
  ruler.__cache__ = null;
}

function captureFlowContent(state: MappingState, before: number): void {
  for (const token of state.tokens.slice(before)) {
    if (token.type !== "inline" || !token.map) continue;
    const mapped = mapGetLines(state, token.map[0], token.map[1], state.blkIndent, false);
    const trimmed = trimMapped(mapped.text, mapped.positions);
    if (trimmed.text === token.content) inlineOrigins.set(token, trimmed.positions);
  }
}

function captureHeading(state: MappingState, before: number): void {
  for (const token of state.tokens.slice(before)) {
    if (token.type !== "inline" || !token.map) continue;
    const line = token.map[0];
    let pos = state.bMarks[line] + state.tShift[line];
    const max = state.eMarks[line];
    while (pos < max && state.src.charCodeAt(pos) === 0x23) pos++;
    const slice = state.src.slice(pos, max);
    // ATX headings can have a closing run of # characters after the content.
    const content = token.content;
    const lead = slice.length - slice.trimStart().length;
    if (!slice.startsWith(content, lead)) continue;
    const positions: number[] = [];
    for (let index = 0; index < content.length; index++) positions.push(pos + lead + index);
    inlineOrigins.set(token, positions);
  }
}

function captureTable(state: MappingState, before: number): void {
  const fresh = state.tokens.slice(before);
  const tableOpen = fresh.find((token) => token.type === "table_open");
  const inlines = fresh.filter((token) => token.type === "inline");
  if (!tableOpen?.map) return;
  const [startLine, endLine] = tableOpen.map;
  const header = cellsFromLine(state, startLine);
  if (!header) {
    protectLineRange(state.src, startLine, endLine);
    return;
  }
  let inlineIndex = 0;
  const take = (text: string, positions: number[]): boolean => {
    const token = inlines[inlineIndex++];
    if (!token || token.content !== text) return false;
    inlineOrigins.set(token, positions);
    return true;
  };
  for (const cell of header) {
    if (!take(cell.text, cell.positions)) {
      protectLineRange(state.src, startLine, endLine);
      return;
    }
  }
  for (let line = startLine + 2; line < endLine; line++) {
    const cells = cellsFromLine(state, line) ?? [];
    for (let column = 0; column < header.length; column++) {
      const cell = cells[column] ?? { text: "", positions: [] };
      if (!take(cell.text, cell.positions)) {
        protectLineRange(state.src, startLine, endLine);
        return;
      }
    }
  }
}

function protectLineRange(source: string, startLine: number, endLine: number): void {
  if (!activeCapture) return;
  const lines = lineStarts(source);
  const start = lines[startLine] ?? 0;
  const end = endLine < lines.length ? lines[endLine] : source.length;
  if (end > start) {
    activeCapture.protectedRanges.push({ src: activeCapture.root, start, end });
  }
}

function cellsFromLine(
  state: MappingState,
  line: number,
): Array<{ text: string; positions: number[] }> | null {
  const start = state.bMarks[line] + state.blkIndent;
  const end = state.eMarks[line];
  const text = state.src.slice(start, end);
  const positions = Array.from({ length: text.length }, (_, index) => start + index);
  const trimmed = trimMapped(text, positions);
  if (!trimmed.text.includes("|")) return null;
  let cellText = trimmed.text;
  let cellPositions = trimmed.positions;
  if (cellText.startsWith("|")) {
    cellText = cellText.slice(1);
    cellPositions = cellPositions.slice(1);
  }
  if (cellText.endsWith("|")) {
    cellText = cellText.slice(0, -1);
    cellPositions = cellPositions.slice(0, -1);
  }
  return splitTableCells(cellText, cellPositions).map((cell) =>
    trimMapped(cell.text, cell.positions),
  );
}

function splitTableCells(
  text: string,
  positions: number[],
): Array<{ text: string; positions: number[] }> {
  const parts: Array<{ text: string; positions: number[] }> = [];
  let pos = 0;
  const max = text.length;
  let escapes = 0;
  let lastPos = 0;
  let backTicked = false;
  let lastBackTick = 0;
  let ch = text.charCodeAt(pos);
  while (pos < max) {
    if (ch === 0x60) {
      if (backTicked) {
        backTicked = false;
        lastBackTick = pos;
      } else if (escapes % 2 === 0) {
        backTicked = true;
        lastBackTick = pos;
      }
    } else if (ch === 0x7c && escapes % 2 === 0 && !backTicked) {
      parts.push({ text: text.slice(lastPos, pos), positions: positions.slice(lastPos, pos) });
      lastPos = pos + 1;
    }
    escapes = ch === 0x5c ? escapes + 1 : 0;
    pos++;
    if (pos === max && backTicked) {
      backTicked = false;
      pos = lastBackTick + 1;
    }
    ch = text.charCodeAt(pos);
  }
  parts.push({ text: text.slice(lastPos), positions: positions.slice(lastPos) });
  return parts;
}

function mapGetLines(
  state: MappingState,
  begin: number,
  end: number,
  indent: number,
  keepLastLF: boolean,
): { text: string; positions: number[] } {
  let text = "";
  const positions: number[] = [];
  for (let line = begin; line < end; line++) {
    let lineIndent = 0;
    const lineStart = state.bMarks[line] ?? 0;
    let first = lineStart;
    const lineEnd = state.eMarks[line] ?? state.src.length;
    const last = line + 1 < end || keepLastLF ? lineEnd + 1 : lineEnd;
    while (first < last && lineIndent < indent) {
      const ch = state.src.charCodeAt(first);
      if (ch === 0x09) {
        lineIndent += 4 - ((lineIndent + (state.bsCount[line] ?? 0)) % 4);
      } else if (ch === 0x20 || first - lineStart < (state.tShift[line] ?? 0)) {
        lineIndent++;
      } else {
        break;
      }
      first++;
    }
    if (lineIndent > indent) {
      for (let extra = 0; extra < lineIndent - indent; extra++) {
        text += " ";
        positions.push(-1);
      }
    }
    for (let pos = first; pos < last; pos++) {
      text += state.src[pos] ?? "";
      positions.push(pos);
    }
  }
  return { text, positions };
}

function trimMapped(text: string, positions: number[]): { text: string; positions: number[] } {
  const trimmed = text.trim();
  if (!trimmed) return { text: "", positions: [] };
  if (trimmed === text) return { text, positions };
  const start = text.indexOf(trimmed);
  return { text: trimmed, positions: positions.slice(start, start + trimmed.length) };
}

function replaceCoreInline(md: MarkdownIt): void {
  const ruler = md.core.ruler as unknown as {
    __rules__: Array<{ name: string; fn: (state: CoreInlineState) => void }>;
    __cache__: unknown;
  };
  const rule = ruler.__rules__.find((item) => item.name === "inline");
  if (!rule) return;
  rule.fn = (state) => {
    for (const token of state.tokens) {
      if (token.type !== "inline") continue;
      const positions = inlineOrigins.get(token) ?? null;
      if (!positions && token.map && activeCapture) {
        protectLineRange(activeCapture.root, token.map[0], token.map[1]);
      }
      pendingPositions = positions;
      try {
        state.md.inline.parse(token.content, state.md, state.env, token.children ?? []);
      } finally {
        pendingPositions = null;
      }
    }
  };
  ruler.__cache__ = null;
}

interface CoreInlineState {
  tokens: MappingToken[];
  md: MarkdownIt;
  env: Record<string, unknown>;
}

function wrapInlineParse(md: MarkdownIt): void {
  const inline = md.inline as unknown as {
    parse: (src: string, md: MarkdownIt, env: unknown, outTokens: unknown[]) => void;
    tokenize: (state: { pos: number }) => void;
  };
  const originalParse = inline.parse.bind(inline);
  const originalTokenize = inline.tokenize.bind(inline);
  inline.parse = (src, mdInstance, env, outTokens) => {
    const parent = frames.at(-1);
    let positions: number[] | null = null;
    if (!parent) {
      positions = pendingPositions;
    } else if (src === parent.src) {
      positions = parent.positions;
    } else {
      const offset = locateNestedFragment(parent, src);
      positions = offset < 0 ? null : parent.positions.slice(offset, offset + src.length);
    }
    frames.push({ src, positions: positions ?? [], inlineState: null });
    try {
      originalParse(src, mdInstance, env, outTokens);
    } finally {
      frames.pop();
    }
  };
  inline.tokenize = (state) => {
    const frame = frames.at(-1);
    if (frame) frame.inlineState = state;
    originalTokenize(state);
  };
}

function locateNestedFragment(parent: OriginFrame, src: string): number {
  const from = parent.inlineState?.pos ?? 0;
  let cursor = Math.max(0, from);
  while (cursor <= parent.src.length) {
    const offset = parent.src.indexOf(src, cursor);
    if (offset < 0) return -1;
    if (offset > 0 && parent.src.charCodeAt(offset - 1) === 0x5b) return offset;
    cursor = offset + 1;
  }
  return -1;
}

export interface AdaptedMathFormula {
  tex: string;
  source: string;
  display: boolean;
}

export interface AdaptedMathSource {
  markdown: string;
  formulas: ReadonlyMap<string, AdaptedMathFormula>;
}

const mathSourceParser = new MarkdownIt({ html: false, linkify: false }).use(markdownMathPlugin);
const protectionParser = new MarkdownIt({ html: false, linkify: false });
installSourceGuards(protectionParser);
installPositionMapping(protectionParser);

/** Rewrite fork math delimiters into enriched `$` / `$$` spans. */
export function adaptMathSource(markdown: string, target: "native" | "web"): AdaptedMathSource {
  if (!markdown.includes("$") && !markdown.includes("\\(") && !markdown.includes("\\[")) {
    return { markdown, formulas: new Map() };
  }
  // Match markdown-it's normalization before recording character positions.
  markdown = markdown.replace(/\r\n?/g, "\n").replaceAll("\0", "\ufffd");
  const capture: MathCapture = { root: markdown, spans: [], protectedRanges: [] };
  activeCapture = capture;
  let tokens: TokenLike[] = [];
  try {
    // Code is measured before math rules run. A later `\(` must not close inside a span.
    capture.protectedRanges.push(
      ...blockCodeRanges(markdown, protectionParser.parse(markdown, {}) as TokenLike[]),
    );
    tokens = mathSourceParser.parse(markdown, {}) as TokenLike[];
  } finally {
    activeCapture = null;
    frames = [];
    pendingPositions = null;
  }
  capture.protectedRanges.push(...blockCodeRanges(markdown, tokens));
  const protectedRanges = capture.protectedRanges;
  const spans = capture.spans.filter((span) => !overlaps(span, protectedRanges));

  const formulas = new Map<string, AdaptedMathFormula>();
  const edits: Array<{ start: number; end: number; text: string }> = [];
  let placeholderIndex = 0;
  const usedIds = new Set<string>();
  for (const span of [...spans].sort((left, right) => left.start - right.start)) {
    let id = "";
    if (target === "web") {
      id = nextPlaceholder(markdown, usedIds, placeholderIndex);
      placeholderIndex = Number(id.slice("paseomath".length)) + 1;
      formulas.set(id, { tex: span.tex, source: span.source, display: span.display });
    }
    const body = target === "web" ? id : escapeBareDollars(span.tex);
    edits.push({
      start: span.start,
      end: span.end,
      text: span.display ? `$$${body}$$` : `$${body}$`,
    });
  }

  const occupied = [...spans, ...protectedRanges];
  for (let index = 0; index < markdown.length; index++) {
    if (
      markdown[index] !== "$" ||
      isEscapedBackslash(markdown, index) ||
      rangeCovers(occupied, index)
    ) {
      continue;
    }
    edits.push({ start: index, end: index + 1, text: "\\$" });
  }

  return { markdown: applyEdits(markdown, edits), formulas };
}

interface TokenLike {
  type: string;
  map?: [number, number] | null;
}

function blockCodeRanges(source: string, tokens: TokenLike[]): SourceRange[] {
  const lines = lineStarts(source);
  const ranges: SourceRange[] = [];
  for (const token of tokens) {
    if ((token.type !== "fence" && token.type !== "code_block") || !token.map) continue;
    const start = lines[token.map[0]] ?? 0;
    const end = token.map[1] < lines.length ? lines[token.map[1]] : source.length;
    ranges.push({ src: source, start, end });
  }
  return ranges;
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function escapeBareDollars(text: string): string {
  let escaped = "";
  for (let index = 0; index < text.length; index++) {
    escaped += text[index] === "$" && !isEscapedBackslash(text, index) ? "\\$" : text[index];
  }
  return escaped;
}

function overlaps(span: SourceRange, ranges: SourceRange[]): boolean {
  return ranges.some((range) => span.start < range.end && range.start < span.end);
}

function rangeCovers(ranges: SourceRange[], index: number): boolean {
  return ranges.some((range) => index >= range.start && index < range.end);
}

function nextPlaceholder(source: string, used: Set<string>, index: number): string {
  let id = `paseomath${index}`;
  while (source.includes(id) || used.has(id)) {
    index += 1;
    id = `paseomath${index}`;
  }
  used.add(id);
  return id;
}

function applyEdits(
  source: string,
  edits: Array<{ start: number; end: number; text: string }>,
): string {
  let result = source;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}
