import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { AgentMetric, AgentSessionMetrics } from "@getpaseo/protocol/agent-types";
import { AgentUsage } from "@/usage";
import {
  formatSessionCacheHitPercentage,
  formatSessionOutputTokensPerSecond,
  formatTokenCount,
} from "./context-window-meter.utils";
import { MetricsList } from "./metrics-list";

interface ContextWindowDetailsProps {
  serverId: string;
  agentId: string;
  context: {
    percentage: number;
    usedTokens: number;
    maxTokens: number;
  } | null;
  sessionCost: string | null;
  /** What the provider reports about the session. A reported cost replaces `sessionCost`. */
  sessionMetrics: AgentMetric[];
  /** Present only when the host advertises agentSessionMetrics. An empty object still shows the rows. */
  usageSessionMetrics?: AgentSessionMetrics;
  /** The hover card and tooltip title themselves; the sheet's header carries the title instead. */
  showTitle: boolean;
  /** Whether the usage cards have a Refresh button; without one they show their freshness. */
  refreshable: boolean;
}

/**
 * What the context window meter opens: how full the window is, what the provider reports about the
 * session, the fork's measured session rate and cache hit, then the usage of the agent's account.
 * The desktop hover card, the native wide tooltip, and the compact sheet all render it.
 */
export function ContextWindowDetails({
  serverId,
  agentId,
  context,
  sessionCost,
  sessionMetrics,
  usageSessionMetrics,
  showTitle,
  refreshable,
}: ContextWindowDetailsProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const unavailable = t("contextWindow.unavailable");
  const outputRate = formatSessionOutputTokensPerSecond(
    usageSessionMetrics?.outputTokensPerSecond5m,
    locale,
  );
  let outputRateValue = outputRate ?? unavailable;
  if (outputRate !== null && usageSessionMetrics?.outputTokensPerSecond5mEstimated)
    outputRateValue = `≈ ${outputRate}`;
  const providerReportsCost = sessionMetrics.some(
    (metric) => metric.label.toLowerCase() === "cost",
  );
  return (
    <>
      <View style={styles.summary}>
        {showTitle ? <Text style={styles.title}>{t("contextWindow.title")}</Text> : null}
        {context ? (
          <>
            <Text style={styles.text}>
              {t("contextWindow.used", { percentage: context.percentage })}
            </Text>
            <Text style={styles.detail}>
              {t("contextWindow.tokens", {
                used: formatTokenCount(context.usedTokens),
                max: formatTokenCount(context.maxTokens),
              })}
            </Text>
          </>
        ) : (
          <Text style={styles.detail}>{t("contextWindow.noData")}</Text>
        )}
        {sessionCost && !providerReportsCost ? (
          <Text style={styles.detail}>{t("contextWindow.sessionCost", { cost: sessionCost })}</Text>
        ) : null}
        {usageSessionMetrics ? (
          <>
            <Text style={styles.detail}>
              {t("contextWindow.outputTokensPerSecond5m", {
                value: outputRateValue,
              })}
            </Text>
            <Text style={styles.detail}>
              {t("contextWindow.cacheHitPercentage", {
                value:
                  formatSessionCacheHitPercentage(usageSessionMetrics.cacheHitPercentage, locale) ??
                  unavailable,
              })}
            </Text>
          </>
        ) : null}
      </View>
      {sessionMetrics.length > 0 ? <MetricsList metrics={sessionMetrics} /> : null}
      <AgentUsage serverId={serverId} agentId={agentId} refreshable={refreshable} />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  summary: {
    gap: theme.spacing[1.5],
    minWidth: 200,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  text: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.4,
  },
  detail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
  },
}));
