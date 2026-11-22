import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgentMetric, AgentSessionMetrics } from "@getpaseo/protocol/agent-types";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { i18n } from "@/i18n/i18next";
import { ContextWindowDetails } from "./context-window-details";

const CONTEXT = { percentage: 40, usedTokens: 80_000, maxTokens: 200_000 };

let root: Root;
let host: HTMLDivElement;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function renderDetails(
  sessionMetrics: AgentMetric[],
  usageSessionMetrics?: AgentSessionMetrics,
): void {
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <ContextWindowDetails
          serverId="server"
          agentId="agent"
          context={CONTEXT}
          sessionCost="$1.20"
          sessionMetrics={sessionMetrics}
          usageSessionMetrics={usageSessionMetrics}
          showTitle
          refreshable={false}
        />
      </QueryClientProvider>,
    ),
  );
}

it("shows what the provider reports about the session", async () => {
  renderDetails([
    { label: "Model", value: "opus" },
    { label: "Requests", value: "12" },
  ]);

  await expect.element(page.getByText("Model")).toBeVisible();
  await expect.element(page.getByText("opus")).toBeVisible();
  await expect.element(page.getByText("Requests")).toBeVisible();
  await expect.element(page.getByText("Session cost $1.20")).toBeVisible();
});

it("leaves the cost to the provider when it reports one", async () => {
  renderDetails([{ label: "Cost", value: "$1.25" }]);

  await expect.element(page.getByText("$1.25")).toBeVisible();
  expect(page.getByText("Session cost $1.20").elements()).toHaveLength(0);
});

it("updates live values and missing samples in the same open details view", async () => {
  renderDetails([], { outputTokensPerSecond5m: 26.7, cacheHitPercentage: 80 });
  expect(host.textContent).toContain("TPS (5m active) 26.7");
  expect(host.textContent).toContain("Cache hit (session) 80%");
  renderDetails([], {
    outputTokensPerSecond5m: 50,
    outputTokensPerSecond5mEstimated: true,
    cacheHitPercentage: 80,
  });
  expect(host.textContent).toContain("TPS (5m active) ≈ 50");
  await page.screenshot({ element: host });
  renderDetails([], { cacheHitPercentage: 80 });
  expect(host.textContent).toContain("TPS (5m active) Unavailable");
  expect(host.textContent).toContain("Cache hit (session) 80%");
  renderDetails([]);
  expect(host.textContent).not.toContain("TPS");
  expect(host.textContent).toContain("40% used");
});

it.each(["en", "fr", "zh-CN", "ar"])(
  "keeps localized metrics inside a narrow summary (%s)",
  async (language) => {
    await i18n.changeLanguage(language);
    host.style.cssText = "width:280px;padding:12px;box-sizing:border-box";
    renderDetails([], { outputTokensPerSecond5m: 0, cacheHitPercentage: 0 });
    const bounds = host.getBoundingClientRect();
    for (const element of host.querySelectorAll("[dir]")) {
      const range = document.createRange();
      range.selectNodeContents(element);
      for (const rect of Array.from(range.getClientRects())) {
        expect(rect.left).toBeGreaterThanOrEqual(bounds.left);
        expect(rect.right).toBeLessThanOrEqual(bounds.right);
      }
    }
  },
);
