import { describe, expect, it } from "vitest";
import {
  formatContextPercentage,
  formatSessionCacheHitPercentage,
  formatSessionOutputTokensPerSecond,
} from "./context-window-meter.utils";

describe("context window meter formatting", () => {
  it("localizes percentages without hiding context overflow", () => {
    expect(formatContextPercentage(125, "en")).toBe("125%");
    expect(formatContextPercentage(42, "fr")).toBe("42\u00a0%");
  });

  it("formats the five-minute active output rate with at most one decimal", () => {
    expect(formatSessionOutputTokensPerSecond(12.34, "en")).toBe("12.3");
    expect(formatSessionOutputTokensPerSecond(12.04, "en")).toBe("12");
    expect(formatSessionOutputTokensPerSecond(0, "en")).toBe("0");
    expect(formatSessionOutputTokensPerSecond(12.5, "fr")).toBe("12,5");
    expect(formatSessionOutputTokensPerSecond(undefined, "en")).toBeNull();
    expect(formatSessionOutputTokensPerSecond(Number.NaN, "en")).toBeNull();
  });

  it("formats the session cache hit as a percentage already scaled 0 to 100", () => {
    expect(formatSessionCacheHitPercentage(0, "en")).toBe("0%");
    expect(formatSessionCacheHitPercentage(80.5, "en")).toBe("80.5%");
    expect(formatSessionCacheHitPercentage(80.04, "en")).toBe("80%");
    expect(formatSessionCacheHitPercentage(100, "en")).toBe("100%");
    expect(formatSessionCacheHitPercentage(42, "fr")).toBe("42\u00a0%");
    expect(formatSessionCacheHitPercentage(undefined, "en")).toBeNull();
  });
});
