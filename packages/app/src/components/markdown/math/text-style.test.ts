import { describe, expect, it } from "vitest";
import { FONT_SIZE } from "@/styles/theme";
import { resolveMathTextStyle } from "./text-style";

describe("resolveMathTextStyle", () => {
  it("merges styles with later entries overriding earlier ones", () => {
    expect(
      resolveMathTextStyle([
        { fontSize: 12, color: "red" },
        { fontSize: 18, color: "blue" },
      ]),
    ).toEqual({
      fontSize: 18,
      color: "blue",
    });
  });

  it("falls back fontSize and leaves color undefined when both are missing", () => {
    expect(resolveMathTextStyle([{}])).toEqual({
      fontSize: FONT_SIZE.content,
      color: undefined,
    });
    expect(resolveMathTextStyle([])).toEqual({
      fontSize: FONT_SIZE.content,
      color: undefined,
    });
  });
});
