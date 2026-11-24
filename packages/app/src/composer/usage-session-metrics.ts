import type { AgentMetric, AgentSessionMetrics } from "@getpaseo/protocol/agent-types";

// useShallow compares this by reference. A fresh {} on every read makes the
// composer subscription change forever and React throws #185.
const EMPTY_USAGE_SESSION_METRICS: AgentSessionMetrics = {};

export function selectUsageSessionMetrics(
  session:
    | { serverInfo?: { features?: { agentSessionMetrics?: boolean } } | null }
    | null
    | undefined,
  agent: {
    lastUsage?: { sessionMetrics?: AgentSessionMetrics };
    sessionMetrics?: readonly AgentMetric[];
  } | null,
): AgentSessionMetrics | undefined {
  if (session?.serverInfo?.features?.agentSessionMetrics !== true) return undefined;
  const liveMetrics = agent?.lastUsage?.sessionMetrics;
  if (liveMetrics) return liveMetrics;

  // Saved provider rows can be visible before a reopened runtime publishes usage.
  const hasSavedCacheRow = agent?.sessionMetrics?.some(
    ({ label }) => label === "Cache (last turn)" || label === "Cache (last reply)",
  );
  return hasSavedCacheRow ? undefined : EMPTY_USAGE_SESSION_METRICS;
}
