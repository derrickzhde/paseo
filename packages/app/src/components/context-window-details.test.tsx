/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import { ContextWindowDetails } from "./context-window-details";

vi.mock("@/usage", () => ({
  AgentUsage: () => null,
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) =>
      typeof factory === "function"
        ? factory({
            spacing: { 1.5: 6 },
            fontSize: { sm: 14, base: 16 },
            colors: { foreground: "#111111", foregroundMuted: "#666666" },
          })
        : factory,
  },
}));

const context = { percentage: 40, usedTokens: 4_000, maxTokens: 10_000 };

function renderDetails(
  sessionMetrics?:
    | {
        outputTokensPerSecond5m?: number;
        cacheHitPercentage?: number;
      }
    | "omit",
) {
  return render(
    <ContextWindowDetails
      serverId="srv"
      agentId="agt"
      context={context}
      sessionCost="$1.20"
      showTitle
      refreshable={false}
      {...(sessionMetrics === "omit" ? {} : { sessionMetrics })}
    />,
  );
}

describe("context window session metrics", () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("en");
  });

  it("shows the active output rate and session cache hit beside the existing summary", () => {
    renderDetails({ outputTokensPerSecond5m: 12.34, cacheHitPercentage: 80.5 });

    expect(screen.getByText("Context window")).toBeTruthy();
    expect(screen.getByText("40% used")).toBeTruthy();
    expect(screen.getByText("Session cost $1.20")).toBeTruthy();
    expect(screen.getByText("TPS (5m active) 12.3")).toBeTruthy();
    expect(screen.getByText("Cache hit (session) 80.5%")).toBeTruthy();
  });

  it("shows zero instead of treating it as missing", () => {
    renderDetails({ outputTokensPerSecond5m: 0, cacheHitPercentage: 0 });

    expect(screen.getByText("TPS (5m active) 0")).toBeTruthy();
    expect(screen.getByText("Cache hit (session) 0%")).toBeTruthy();
    expect(screen.queryByText(/Unavailable/)).toBeNull();
  });

  it("shows the translated unavailable label when a supported host has no sample yet", () => {
    renderDetails({});

    expect(screen.getByText("TPS (5m active) Unavailable")).toBeTruthy();
    expect(screen.getByText("Cache hit (session) Unavailable")).toBeTruthy();
  });

  it("hides both rows when the host does not provide session metrics", () => {
    renderDetails("omit");

    expect(screen.queryByText(/TPS \(5m active\)/)).toBeNull();
    expect(screen.queryByText(/Cache hit \(session\)/)).toBeNull();
    expect(screen.getByText("4k / 10k tokens")).toBeTruthy();
    expect(screen.getByText("Session cost $1.20")).toBeTruthy();
  });

  it("uses the active language for labels and values", async () => {
    await i18n.changeLanguage("zh-CN");
    renderDetails({ outputTokensPerSecond5m: 12.5, cacheHitPercentage: undefined });

    expect(screen.getByText("TPS（近5分钟活跃输出） 12.5")).toBeTruthy();
    expect(screen.getByText("缓存命中率（当前会话） 暂无数据")).toBeTruthy();
  });
});
