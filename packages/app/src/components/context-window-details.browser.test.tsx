import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { page } from "vitest/browser";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentSessionMetrics } from "@getpaseo/protocol/agent-types";
import { i18n } from "@/i18n/i18next";
import { ContextWindowDetails } from "./context-window-details";

vi.mock("@/usage", () => ({ AgentUsage: () => null }));
beforeEach(() => vi.stubGlobal("React", React));
let root: Root | undefined;
let container: HTMLDivElement;
const context = { percentage: 40, usedTokens: 4_000, maxTokens: 10_000 };
afterEach(async () => {
  act(() => root?.unmount());
  container?.remove();
  await i18n.changeLanguage("en");
});

function renderDetails(metrics?: AgentSessionMetrics) {
  act(() =>
    root!.render(
      <ContextWindowDetails
        serverId="host"
        agentId="agent"
        context={context}
        sessionCost="$1.20"
        sessionMetrics={metrics}
        showTitle
        refreshable={false}
      />,
    ),
  );
}

it("updates live values and expiry in the same open details view", async () => {
  container = document.createElement("div");
  container.style.cssText = "width:320px;padding:20px;background:white;box-sizing:border-box";
  document.body.appendChild(container);
  root = createRoot(container);
  renderDetails({ outputTokensPerSecond5m: 26.7, cacheHitPercentage: 80 });
  expect(container.textContent).toContain("TPS (5m active) 26.7");
  expect(container.textContent).toContain("Cache hit (session) 80%");
  await page.screenshot({ element: container });
  renderDetails({ cacheHitPercentage: 80 });
  expect(container.textContent).toContain("TPS (5m active) Unavailable");
  expect(container.textContent).toContain("Cache hit (session) 80%");
  renderDetails(undefined);
  expect(container.textContent).not.toContain("TPS");
  expect(container.textContent).toContain("40% used");
});

it.each(["en", "fr", "zh-CN", "ar"])(
  "keeps localized metrics inside a narrow summary (%s)",
  async (language) => {
    await i18n.changeLanguage(language);
    container = document.createElement("div");
    container.style.cssText = "width:280px;padding:12px;box-sizing:border-box";
    document.body.appendChild(container);
    root = createRoot(container);
    renderDetails({ outputTokensPerSecond5m: 0, cacheHitPercentage: 0 });
    const bounds = container.getBoundingClientRect();
    for (const element of container.querySelectorAll("[dir]")) {
      const range = document.createRange();
      range.selectNodeContents(element);
      for (const rect of Array.from(range.getClientRects())) {
        expect(rect.left).toBeGreaterThanOrEqual(bounds.left);
        expect(rect.right).toBeLessThanOrEqual(bounds.right);
      }
    }
  },
);
