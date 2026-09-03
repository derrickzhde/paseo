export interface MarkdownAstNodeWithChildren {
  type: string;
  children: MarkdownAstNodeWithChildren[];
}

export function markdownNodeContainsType(node: MarkdownAstNodeWithChildren, type: string): boolean {
  if (node.type === type) {
    return true;
  }

  return node.children.some((child) => markdownNodeContainsType(child, type));
}

export interface MarkdownAstNodeType {
  type: string;
}

// react-native-markdown-display only assembles inherited text styles for leaf
// nodes, so a textgroup's own style carries no fontSize. Resolve it the way the
// library resolves it for leaves: walk out to the nearest ancestor whose style
// declares one. `ancestors` is the rule's `parent` array, nearest first.
export function markdownAncestorFontSize(
  ancestors: readonly MarkdownAstNodeType[],
  styles: Record<string, Record<string, unknown> | undefined>,
  fallback: number,
): number {
  for (const ancestor of ancestors) {
    const size = styles[ancestor.type]?.fontSize;
    if (typeof size === "number") {
      return size;
    }
  }
  return fallback;
}
