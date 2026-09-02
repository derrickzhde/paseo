export interface MathSvg {
  svg: string;
  widthEx: number;
  heightEx: number;
  depthEx: number;
}

export interface MathEngine {
  render(tex: string, display: boolean): MathSvg | null;
}

const MAX_TEX_LENGTH = 4096;
const CACHE_LIMIT = 500;
// Volume cap is a secondary gate; the primary gate is MAX_TEX_LENGTH (4096 chars).
// Real formulas top out around a 10×10 pmatrix at ~178 KiB; 512 KiB is ~3× that headroom.
// Degenerate inputs (515-term sum, 4096 repeated letters) start at ~1259 KiB.
const MAX_SVG_BYTES = 512 * 1024;

let enginePromise: Promise<MathEngine> | null = null;

export function loadMathEngine(): Promise<MathEngine> {
  if (!enginePromise) {
    enginePromise = createMathEngine();
  }
  return enginePromise;
}

async function createMathEngine(): Promise<MathEngine> {
  const [
    mathjaxModule,
    texModule,
    _amsConfigurationModule,
    svgModule,
    liteAdaptorModule,
    htmlHandlerModule,
  ] = await Promise.all([
    import("mathjax-full/js/mathjax.js"),
    import("mathjax-full/js/input/tex.js"),
    import("mathjax-full/js/input/tex/ams/AmsConfiguration.js"),
    import("mathjax-full/js/output/svg.js"),
    import("mathjax-full/js/adaptors/liteAdaptor.js"),
    import("mathjax-full/js/handlers/html.js"),
  ]);
  void _amsConfigurationModule;
  const { mathjax } = mathjaxModule;
  const { TeX } = texModule;
  const { SVG } = svgModule;
  const { liteAdaptor } = liteAdaptorModule;
  const { RegisterHTMLHandler } = htmlHandlerModule;

  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);

  const texJax = new TeX({
    packages: ["base", "ams"],
    // Typical formulas expand a handful of macros; 1000 blocks nested \newcommand bombs
    // while leaving room for AMS constructs like matrices and operator names.
    maxMacros: 1000,
    // MathJax default is 5120 bytes; 8192 fits the 4096-char input cap plus delimiter
    // and grouping overhead without allowing unbounded parse-buffer growth.
    maxBuffer: 8192,
  });
  const svgJax = new SVG({ fontCache: "none" });
  const document = mathjax.document("", { InputJax: texJax, OutputJax: svgJax });

  const cache = new Map<string, MathSvg>();
  const cacheOrder: string[] = [];

  return {
    render(tex: string, display: boolean): MathSvg | null {
      // Empty or whitespace-only input has no formula content; callers fall back to source.
      if (tex.length === 0 || tex.trim().length === 0) {
        return null;
      }
      if (tex.length > MAX_TEX_LENGTH) {
        return null;
      }

      const cacheKey = `${display ? "d" : "i"}:${tex}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        return cached;
      }

      let node: ReturnType<typeof document.convert>;
      try {
        node = document.convert(tex, { display });
      } catch {
        return null;
      }

      const containerHtml = adaptor.innerHTML(node);
      if (containerHtml.includes("merror") || containerHtml.includes("data-mjx-error")) {
        return null;
      }

      const svgString = extractTopLevelSvg(containerHtml);
      if (!svgString) {
        return null;
      }

      const dimensions = parseSvgDimensions(svgString);
      if (!dimensions) {
        return null;
      }

      const sanitizedSvg = sanitizeMathSvgString(svgString);
      if (sanitizedSvg.length > MAX_SVG_BYTES) {
        return null;
      }
      const result: MathSvg = {
        svg: sanitizedSvg,
        widthEx: dimensions.widthEx,
        heightEx: dimensions.heightEx,
        depthEx: dimensions.depthEx,
      };

      if (cache.size >= CACHE_LIMIT) {
        const oldestKey = cacheOrder.shift();
        if (oldestKey !== undefined) {
          cache.delete(oldestKey);
        }
      }
      cache.set(cacheKey, result);
      cacheOrder.push(cacheKey);

      return result;
    },
  };
}

interface SvgDimensions {
  widthEx: number;
  heightEx: number;
  depthEx: number;
}

// MathJax puts exactly one top-level <svg> in the adaptor container; nested <svg>
// elements are stretchy delimiter paths inside it. Slice from first open to last close.
function extractTopLevelSvg(html: string): string | null {
  const start = html.indexOf("<svg");
  if (start === -1) {
    return null;
  }
  const end = html.lastIndexOf("</svg>");
  if (end === -1 || end < start) {
    return null;
  }
  return html.slice(start, end + "</svg>".length);
}

function parseSvgDimensions(svg: string): SvgDimensions | null {
  const openTagMatch = svg.match(/^<svg\b[^>]*>/i);
  if (!openTagMatch) {
    return null;
  }
  const openTag = openTagMatch[0];

  const widthEx = parseExAttribute(openTag, "width");
  const heightEx = parseExAttribute(openTag, "height");
  const depthEx = parseVerticalAlignDepth(openTag);

  if (widthEx === null || heightEx === null || depthEx === null) {
    return null;
  }

  return { widthEx, heightEx, depthEx };
}

function parseExAttribute(tag: string, attributeName: string): number | null {
  const match = tag.match(new RegExp(String.raw`\b${attributeName}\s*=\s*"([\d.]+)ex"`, "i"));
  if (!match) {
    return null;
  }
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : null;
}

function parseVerticalAlignDepth(tag: string): number | null {
  const styleMatch = tag.match(/\bstyle\s*=\s*"([^"]*)"/i);
  if (!styleMatch) {
    return null;
  }
  const verticalAlignMatch = styleMatch[1].match(/vertical-align\s*:\s*(-?[\d.]+)ex/i);
  if (!verticalAlignMatch) {
    return null;
  }
  const value = Number.parseFloat(verticalAlignMatch[1]);
  return Number.isFinite(value) ? Math.abs(value) : null;
}

/** Exported for unit tests that feed handcrafted malicious SVG strings. */
export function sanitizeMathSvgString(svg: string): string {
  let sanitized = svg;

  sanitized = removeElements(sanitized, "script");
  sanitized = removeElements(sanitized, "foreignObject");
  sanitized = removeEventHandlerAttributes(sanitized);
  sanitized = removeHrefAttributes(sanitized);
  sanitized = removeRootSvgStyleAttribute(sanitized);

  return sanitized;
}

function removeElements(svg: string, elementName: string): string {
  const paired = new RegExp(String.raw`<${elementName}\b[^>]*>[\s\S]*?<\/${elementName}\s*>`, "gi");
  let result = svg.replace(paired, "");

  const selfClosing = new RegExp(String.raw`<${elementName}\b[^>]*\/\s*>`, "gi");
  result = result.replace(selfClosing, "");

  const unclosed = new RegExp(
    String.raw`<${elementName}\b[^>]*>(?:(?!<\/${elementName}\s*>)[\s\S])*?(?=<\/svg>|$)`,
    "gi",
  );
  result = result.replace(unclosed, "");

  return result;
}

function removeEventHandlerAttributes(svg: string): string {
  return svg.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

function removeHrefAttributes(svg: string): string {
  return svg.replace(/\s+(?:xlink:)?href\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

function removeRootSvgStyleAttribute(svg: string): string {
  return svg.replace(/(<svg\b[^>]*)\s+style\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, "$1");
}
