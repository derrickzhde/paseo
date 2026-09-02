import { StyleSheet, type StyleProp, type TextStyle } from "react-native";
import { FONT_SIZE } from "@/styles/theme";

// fontSize fallback mirrors createMarkdownStyles `body` in markdown-styles.ts:34.
const DEFAULT_MATH_FONT_SIZE = FONT_SIZE.content;

export function resolveMathTextStyle(styles: Array<StyleProp<TextStyle> | undefined>): {
  fontSize: number;
  color: string | undefined;
} {
  const flattened = StyleSheet.flatten(styles.filter(Boolean)) ?? {};
  // All three call sites pass themed styles.text, so color is defined in practice.
  // undefined only if a future caller omits color; then inherit like plain text.
  return {
    fontSize: typeof flattened.fontSize === "number" ? flattened.fontSize : DEFAULT_MATH_FONT_SIZE,
    color: typeof flattened.color === "string" ? flattened.color : undefined,
  };
}
