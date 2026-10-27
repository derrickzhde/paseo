import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { AgentSessionMetrics } from "@getpaseo/protocol/agent-types";
import { AgentUsage } from "@/usage";
import {
  formatSessionCacheHitPercentage,
  formatSessionOutputTokensPerSecond,
  formatTokenCount,
} from "./context-window-meter.utils";

interface ContextWindowDetailsProps {
  serverId: string;
  agentId: string;
  context: {
    percentage: number;
    usedTokens: number;
    maxTokens: number;
  } | null;
  sessionCost: string | null;
  /** Present only when the host advertises agentSessionMetrics. An empty object still shows the rows. */
  sessionMetrics?: AgentSessionMetrics;
  /** The hover card and tooltip title themselves; the sheet's header carries the title instead. */
  showTitle: boolean;
  /** Whether the usage cards have a Refresh button; without one they show their freshness. */
  refreshable: boolean;
}

/**
 * What the context window meter opens: how full the window is, then the usage of the agent's
 * account. The desktop hover card, the native wide tooltip, and the compact sheet all render it.
 */
export function ContextWindowDetails({
  serverId,
  agentId,
  context,
  sessionCost,
  sessionMetrics,
  showTitle,
  refreshable,
}: ContextWindowDetailsProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const unavailable = t("contextWindow.unavailable");
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
        {sessionCost ? (
          <Text style={styles.detail}>{t("contextWindow.sessionCost", { cost: sessionCost })}</Text>
        ) : null}
        {sessionMetrics ? (
          <>
            <Text style={styles.detail}>
              {t("contextWindow.outputTokensPerSecond5m", {
                value:
                  formatSessionOutputTokensPerSecond(
                    sessionMetrics.outputTokensPerSecond5m,
                    locale,
                  ) ?? unavailable,
              })}
            </Text>
            <Text style={styles.detail}>
              {t("contextWindow.cacheHitPercentage", {
                value:
                  formatSessionCacheHitPercentage(sessionMetrics.cacheHitPercentage, locale) ??
                  unavailable,
              })}
            </Text>
          </>
        ) : null}
      </View>
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
