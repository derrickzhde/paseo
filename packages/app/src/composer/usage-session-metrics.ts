import type { AgentSessionMetrics } from "@getpaseo/protocol/agent-types";

// useShallow compares this by reference. A fresh {} on every read makes the
// composer subscription change forever and React throws #185.
const EMPTY_USAGE_SESSION_METRICS: AgentSessionMetrics = {};

export function selectUsageSessionMetrics(
  session:
    | { serverInfo?: { features?: { agentSessionMetrics?: boolean } } | null }
    | null
    | undefined,
  agent: { lastUsage?: { sessionMetrics?: AgentSessionMetrics } } | null,
): AgentSessionMetrics | undefined {
  if (session?.serverInfo?.features?.agentSessionMetrics !== true) return undefined;
  return agent?.lastUsage?.sessionMetrics ?? EMPTY_USAGE_SESSION_METRICS;
}
