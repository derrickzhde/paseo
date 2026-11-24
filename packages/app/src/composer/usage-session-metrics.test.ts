import { shallow } from "zustand/shallow";
import { describe, expect, it } from "vitest";
import { selectUsageSessionMetrics } from "./usage-session-metrics";

const advertising = {
  serverInfo: { features: { agentSessionMetrics: true } },
};

describe("selectUsageSessionMetrics", () => {
  it("stays absent until the host advertises session metrics", () => {
    expect(
      selectUsageSessionMetrics(
        { serverInfo: { features: {} } },
        { lastUsage: { sessionMetrics: { outputTokensPerSecond5m: 12 } } },
      ),
    ).toBeUndefined();
  });

  it("returns the usage snapshot the daemon published", () => {
    const sessionMetrics = { outputTokensPerSecond5m: 12, cacheHitPercentage: 40 };
    expect(selectUsageSessionMetrics(advertising, { lastUsage: { sessionMetrics } })).toBe(
      sessionMetrics,
    );
  });

  it.each(["Cache (last turn)", "Cache (last reply)"])(
    "omits empty session metrics beside a saved %s row until live usage arrives",
    (label) => {
      const agent = { sessionMetrics: [{ label, value: "98%" }] };
      expect(selectUsageSessionMetrics(advertising, agent)).toBeUndefined();

      const sessionMetrics = { outputTokensPerSecond5m: 12, cacheHitReportedByProvider: true };
      expect(
        selectUsageSessionMetrics(advertising, { ...agent, lastUsage: { sessionMetrics } }),
      ).toBe(sessionMetrics);
    },
  );

  it("reuses one empty snapshot so the composer subscription stays still", () => {
    const agent = { lastUsage: {}, sessionMetrics: [{ label: "Tokens", value: "20 ↑ · 40 ↓" }] };
    const first = selectUsageSessionMetrics(advertising, agent);
    const second = selectUsageSessionMetrics(advertising, agent);
    expect(first).toEqual({});
    expect(first).toBe(second);
    expect(shallow({ usageSessionMetrics: first }, { usageSessionMetrics: second })).toBe(true);
  });
});
