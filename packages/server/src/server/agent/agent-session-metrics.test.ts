import { describe, expect, it } from "vitest";
import type {
  AgentGenerationSample,
  AgentStreamEvent,
  AgentUsageSample,
} from "./agent-sdk-types.js";
import { AgentSessionMetricsLedger } from "./agent-session-metrics.js";

function output(text: string): AgentStreamEvent {
  return { type: "timeline", provider: "codex", item: { type: "assistant_message", text } };
}

function usage(sample: Partial<AgentUsageSample> = {}): AgentStreamEvent {
  return {
    type: "usage_updated",
    provider: "codex",
    usage: {},
    usageSample: { scope: "turn", id: "turn", ...sample },
  };
}

function generation(sample: AgentGenerationSample): AgentStreamEvent {
  return { type: "usage_updated", provider: "pi", usage: {}, generationSample: sample };
}

describe("current-session metrics", () => {
  it("removes the estimate marker when only native-timed responses remain", () => {
    let now = 1000;
    const ledger = new AgentSessionMetricsLedger(() => now);
    ledger.observe(
      generation({ id: "estimated", outputTokens: 200, durationMs: 10_000, estimated: true }),
    );
    now = 2000;
    ledger.observe(generation({ id: "native", outputTokens: 400, durationMs: 20_000 }));
    expect(ledger.snapshot()).toEqual({
      outputTokensPerSecond5m: 20,
      outputTokensPerSecond5mEstimated: true,
    });
    now = 301_000;
    expect(ledger.snapshot()).toEqual({ outputTokensPerSecond5m: 20 });
  });

  it("weights estimated requests by their durations and expires the estimate marker", () => {
    let now = 300_000;
    const ledger = new AgentSessionMetricsLedger(() => now);
    ledger.observe(
      generation({
        id: "estimate-a",
        outputTokens: 200,
        durationMs: 10_000,
        completedAt: 100_000,
        estimated: true,
      }),
    );
    ledger.observe(
      generation({
        id: "estimate-b",
        outputTokens: 800,
        durationMs: 30_000,
        completedAt: 299_000,
        estimated: true,
      }),
    );
    expect(ledger.snapshot()).toEqual({
      outputTokensPerSecond5m: 25,
      outputTokensPerSecond5mEstimated: true,
    });
    now = 599_000;
    expect(ledger.snapshot()).toEqual({});
  });

  it("expires whole completed responses and preserves the cache percentage while idle", () => {
    let now = 300_000;
    const ledger = new AgentSessionMetricsLedger(() => now);
    ledger.observe(usage({ inputTokens: 100, cachedInputTokens: 50 }));
    ledger.observe(
      generation({ id: "a", outputTokens: 100, durationMs: 10_000, completedAt: 100_000 }),
    );
    ledger.observe(
      generation({ id: "b", outputTokens: 900, durationMs: 30_000, completedAt: 299_000 }),
    );
    expect(ledger.nextExpirationAt()).toBe(400_000);
    now = 400_000;
    expect(ledger.snapshot()).toEqual({ outputTokensPerSecond5m: 30, cacheHitPercentage: 50 });
    expect(ledger.nextExpirationAt()).toBe(599_000);
    now = 599_000;
    expect(ledger.snapshot()).toEqual({ cacheHitPercentage: 50 });
    expect(ledger.nextExpirationAt()).toBeUndefined();
  });

  it("replaces duplicate and corrected response counts without extending their receipt age", () => {
    let now = 100_000;
    const ledger = new AgentSessionMetricsLedger(() => now);
    const first = generation({ id: "a", outputTokens: 100, durationMs: 10_000 });
    ledger.observe(first);
    now = 200_000;
    ledger.observe(first);
    ledger.observe(generation({ id: "a", outputTokens: 40, durationMs: 20_000 }));
    ledger.observe(generation({ id: "b", outputTokens: 20, durationMs: 10_000 }));
    expect(ledger.snapshot()).toEqual({ outputTokensPerSecond5m: 2 });
    now = 400_000;
    expect(ledger.snapshot()).toEqual({ outputTokensPerSecond5m: 2 });
    expect(ledger.nextExpirationAt()).toBe(500_000);
  });

  it("does not revive an expired receipt-only response when it is replayed", () => {
    let now = 1000;
    const ledger = new AgentSessionMetricsLedger(() => now);
    const response = generation({ id: "replayed", outputTokens: 10, durationMs: 1000 });
    ledger.observe(response);
    now = 301_000;
    expect(ledger.snapshot()).toEqual({});
    now = 302_000;
    ledger.observe(response);
    expect(ledger.snapshot()).toEqual({});
    expect(ledger.nextExpirationAt()).toBeUndefined();
  });

  it("does not extend or revive a replayed response with a future provider clock", () => {
    let now = 1000;
    const ledger = new AgentSessionMetricsLedger(() => now);
    const response = generation({
      id: "future-clock",
      outputTokens: 10,
      durationMs: 1000,
      completedAt: 3_000_000,
    });
    ledger.observe(response);
    expect(ledger.snapshot()).toEqual({ outputTokensPerSecond5m: 10 });
    expect(ledger.nextExpirationAt()).toBe(301_000);
    now = 100_000;
    ledger.observe(response);
    expect(ledger.nextExpirationAt()).toBe(301_000);
    now = 301_000;
    expect(ledger.snapshot()).toEqual({});
    now = 302_000;
    ledger.observe(response);
    expect(ledger.snapshot()).toEqual({});
    expect(ledger.nextExpirationAt()).toBeUndefined();
  });

  it("includes a long response by its completion time without spreading tokens over the window", () => {
    const ledger = new AgentSessionMetricsLedger(() => 1_000_000);
    ledger.observe(
      generation({ id: "long", outputTokens: 800, durationMs: 400_000, completedAt: 999_000 }),
    );
    ledger.observe(
      generation({ id: "old", outputTokens: 10_000, durationMs: 1, completedAt: 700_000 }),
    );
    expect(ledger.snapshot()).toEqual({ outputTokensPerSecond5m: 2 });
  });

  it.each([
    { outputTokens: undefined, durationMs: 1000 },
    { outputTokens: 10, durationMs: undefined },
    { outputTokens: 10, durationMs: 0 },
    { outputTokens: 10, durationMs: -1 },
    { outputTokens: -1, durationMs: 1000 },
    { outputTokens: Number.NaN, durationMs: 1000 },
    { outputTokens: 10, durationMs: Number.POSITIVE_INFINITY },
  ])("keeps recent incomplete or invalid response timing unavailable (%j)", (sample) => {
    let now = 100_000;
    const ledger = new AgentSessionMetricsLedger(() => now);
    ledger.observe(usage({ inputTokens: 100, cachedInputTokens: 50 }));
    ledger.observe(generation({ id: "bad", completedAt: 0, ...sample }));
    ledger.observe(
      generation({ id: "good", outputTokens: 10, durationMs: 1000, completedAt: 100_000 }),
    );
    expect(ledger.snapshot()).toEqual({ cacheHitPercentage: 50 });
    now = 300_000;
    expect(ledger.snapshot()).toEqual({ outputTokensPerSecond5m: 10, cacheHitPercentage: 50 });
  });

  it("keeps a measured zero distinct from unavailable and does not depend on valid cache counters", () => {
    const ledger = new AgentSessionMetricsLedger(() => 1000);
    ledger.observe(usage({ inputTokens: 10, cachedInputTokens: 20 }));
    ledger.observe(generation({ id: "zero", outputTokens: 0, durationMs: 1000 }));
    expect(ledger.snapshot()).toEqual({ outputTokensPerSecond5m: 0 });
  });

  it("never publishes an infinite TPS when a finite duration underflows seconds", () => {
    const ledger = new AgentSessionMetricsLedger(() => 1000);
    ledger.observe(generation({ id: "tiny", outputTokens: 1, durationMs: Number.MIN_VALUE }));
    expect(ledger.snapshot()).toEqual({});
  });

  it("weights response tokens by active request duration, excluding idle gaps", () => {
    const ledger = new AgentSessionMetricsLedger(() => 300_000);
    ledger.observe({
      type: "usage_updated",
      provider: "pi",
      usage: {},
      generationSample: {
        id: "first",
        outputTokens: 100,
        durationMs: 10_000,
        completedAt: 100_000,
      },
    });
    ledger.observe({
      type: "usage_updated",
      provider: "pi",
      usage: {},
      generationSample: {
        id: "second",
        outputTokens: 900,
        durationMs: 30_000,
        completedAt: 299_000,
      },
    });
    expect(ledger.snapshot()).toEqual({ outputTokensPerSecond5m: 25 });
  });

  it("requires real generation timing instead of inferring TPS from chunk arrivals", () => {
    const ledger = new AgentSessionMetricsLedger();
    ledger.observe(output("a"));
    ledger.observe(output("b"));
    ledger.observe(usage({ outputTokens: 20, inputTokens: 100, cachedInputTokens: 80 }));
    expect(ledger.snapshot()).toEqual({ cacheHitPercentage: 80 });
    ledger.observe({ type: "turn_completed", provider: "codex", usage: { outputTokens: 20 } });
    expect(ledger.snapshot()).toEqual({ cacheHitPercentage: 80 });
  });

  it("does not duplicate input or cache when only the output counter resets", () => {
    const ledger = new AgentSessionMetricsLedger();
    ledger.observe(
      usage({ scope: "session", inputTokens: 100, cachedInputTokens: 50, outputTokens: 10 }),
    );
    ledger.observe(
      usage({ scope: "session", inputTokens: 100, cachedInputTokens: 50, outputTokens: 2 }),
    );
    ledger.observe(
      usage({ scope: "session", inputTokens: 200, cachedInputTokens: 50, outputTokens: 20 }),
    );
    expect(ledger.snapshot()).toEqual({ cacheHitPercentage: 25 });
  });

  it.each([
    { inputTokens: 20, cachedInputTokens: 0 },
    { inputTokens: 100, cachedInputTokens: 0 },
  ])(
    "does not guess totals when native session counters shrink or reset without a new identity (%j)",
    (reset) => {
      const ledger = new AgentSessionMetricsLedger();
      ledger.observe(usage({ scope: "session", inputTokens: 100, cachedInputTokens: 50 }));
      ledger.observe(usage({ scope: "session", ...reset }));
      expect(ledger.snapshot()).toEqual({});
      ledger.observe(usage({ scope: "session", inputTokens: 200, cachedInputTokens: 50 }));
      expect(ledger.snapshot()).toEqual({});
    },
  );

  it.each(["request", "turn"] as const)("replaces reconciled request totals for %s", (scope) => {
    const ledger = new AgentSessionMetricsLedger();
    ledger.observe(usage({ scope, inputTokens: 100, cachedInputTokens: 50 }));
    ledger.observe(usage({ scope, inputTokens: 80, cachedInputTokens: 20 }));
    ledger.observe(usage({ scope, id: "other", inputTokens: 20, cachedInputTokens: 0 }));
    expect(ledger.snapshot()).toEqual({ cacheHitPercentage: 20 });
  });

  it("counts a new explicit counter epoch once without resetting the session ledger", () => {
    const ledger = new AgentSessionMetricsLedger();
    ledger.observe(
      usage({ scope: "session", id: "epoch-1", inputTokens: 100, cachedInputTokens: 50 }),
    );
    const next = usage({ scope: "session", id: "epoch-2", inputTokens: 25, cachedInputTokens: 0 });
    ledger.observe(next);
    ledger.observe(next);
    expect(ledger.snapshot()).toEqual({ cacheHitPercentage: 40 });
  });

  it("deduplicates cumulative counters and retains genuine zero cache hits", () => {
    const ledger = new AgentSessionMetricsLedger();
    const sample = usage({ inputTokens: 200, cachedInputTokens: 0, outputTokens: 10 });
    ledger.observe(sample);
    ledger.observe(sample);
    ledger.observe(usage({ scope: "turn", id: "other", inputTokens: 800, cachedInputTokens: 400 }));
    expect(ledger.snapshot()).toEqual({ cacheHitPercentage: 40 });
    const zero = new AgentSessionMetricsLedger();
    zero.observe(sample);
    expect(zero.snapshot()).toEqual({ cacheHitPercentage: 0 });
  });

  it("keeps cache accounting unavailable until all observed input is known", () => {
    const ledger = new AgentSessionMetricsLedger();
    ledger.observe(usage({ inputTokens: 100 }));
    expect(ledger.snapshot()).toEqual({});
    ledger.observe(usage({ inputTokens: 100, cachedInputTokens: 50 }));
    expect(ledger.snapshot()).toEqual({ cacheHitPercentage: 50 });
    ledger.observe(usage({ scope: "request", id: "unknown", outputTokens: 20 }));
    expect(ledger.snapshot()).toEqual({});
  });

  it("does not reuse a stale known cache denominator when a later snapshot is incomplete", () => {
    const ledger = new AgentSessionMetricsLedger();
    ledger.observe(usage({ inputTokens: 100, cachedInputTokens: 50, outputTokens: 10 }));
    ledger.observe(usage({ outputTokens: 20 }));
    expect(ledger.snapshot()).toEqual({});
    ledger.observe(usage({ inputTokens: 200, cachedInputTokens: 50, outputTokens: 20 }));
    expect(ledger.snapshot()).toEqual({ cacheHitPercentage: 25 });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    "keeps invalid counters unavailable (%s)",
    (inputTokens) => {
      const ledger = new AgentSessionMetricsLedger();
      ledger.observe(usage({ inputTokens, cachedInputTokens: 0 }));
      expect(ledger.snapshot()).toEqual({});
    },
  );

  it("does not publish an invalid or overflowing percentage", () => {
    const ledger = new AgentSessionMetricsLedger();
    ledger.observe(usage({ inputTokens: 10, cachedInputTokens: 20 }));
    expect(ledger.snapshot()).toEqual({});
    ledger.observe(usage({ inputTokens: Number.MAX_VALUE, cachedInputTokens: 0 }));
    ledger.observe(usage({ id: "other", inputTokens: Number.MAX_VALUE, cachedInputTokens: 0 }));
    expect(ledger.snapshot()).toEqual({});
  });
});
