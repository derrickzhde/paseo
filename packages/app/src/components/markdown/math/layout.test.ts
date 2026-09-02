import { describe, expect, it } from "vitest";
import { computeMathLayout } from "./layout";

const FRAC_A_OVER_B = { widthEx: 1.842, heightEx: 2.395, depthEx: 0.798 };

describe("computeMathLayout", () => {
  it("converts \\frac{a}{b} ex metrics to px at fontSize 16", () => {
    expect(computeMathLayout(FRAC_A_OVER_B, 16)).toEqual({
      width: 14.74,
      height: 19.16,
      depth: 6.38,
    });
  });

  it("scales proportionally with fontSize", () => {
    const at16 = computeMathLayout(FRAC_A_OVER_B, 16);
    const at32 = computeMathLayout(FRAC_A_OVER_B, 32);

    expect(at32.width / at16.width).toBeCloseTo(2, 2);
    expect(at32.height / at16.height).toBeCloseTo(2, 2);
    expect(at32.depth / at16.depth).toBeCloseTo(2, 2);
  });

  it("returns zero depth when depthEx is 0", () => {
    expect(computeMathLayout({ widthEx: 2, heightEx: 1.5, depthEx: 0 }, 16)).toEqual({
      width: 16,
      height: 12,
      depth: 0,
    });
  });

  it("rounds each dimension to two decimal places", () => {
    const layout = computeMathLayout({ widthEx: 1.111, heightEx: 2.222, depthEx: 0.333 }, 16);
    expect(layout.width).toBe(8.89);
    expect(layout.height).toBe(17.78);
    expect(layout.depth).toBe(2.66);
  });
});
