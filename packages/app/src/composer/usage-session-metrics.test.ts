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

  it("reuses one empty snapshot so the composer subscription stays still", () => {
    const agent = { lastUsage: {} };
    const first = selectUsageSessionMetrics(advertising, agent);
    const second = selectUsageSessionMetrics(advertising, agent);
    expect(first).toEqual({});
    expect(first).toBe(second);
    expect(shallow({ usageSessionMetrics: first }, { usageSessionMetrics: second })).toBe(true);
  });
});
