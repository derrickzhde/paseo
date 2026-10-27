import { setImmediate as waitForImmediate } from "node:timers/promises";
import { describe, expect, test } from "vitest";

import type { AgentUsage, AgentUsageSample } from "../../agent-sdk-types.js";
import type { PiSessionStats } from "./rpc-types.js";
import { PiUsagePoller, type PiUsagePollScheduler } from "./usage-poller.js";

class ManualPollScheduler implements PiUsagePollScheduler {
  private readonly polls: Array<{ active: boolean; callback: () => void }> = [];

  schedulePoll(callback: () => void): () => void {
    const poll = { active: true, callback };
    this.polls.push(poll);
    return () => {
      poll.active = false;
    };
  }

  poll(): void {
    const poll = this.polls.shift();
    if (!poll) throw new Error("No context usage poll is scheduled");
    if (poll.active) poll.callback();
  }

  activePollCount(): number {
    return this.polls.filter((poll) => poll.active).length;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("Pi usage poller", () => {
  test("emits only changed usage while active", async () => {
    const scheduler = new ManualPollScheduler();
    const updates: AgentUsage[] = [];
    let stats: PiSessionStats = {
      tokens: { input: 100, cacheRead: 10, output: 20 },
      cost: 0.01,
      contextUsage: { contextWindow: 200_000, tokens: 130 },
    };
    const poller = new PiUsagePoller({
      scheduler,
      readStats: async () => stats,
      onUsage: (update) => updates.push(update),
      onPollError: (error) => {
        throw error;
      },
    });

    poller.startTurn();
    scheduler.poll();
    await waitForImmediate();
    scheduler.poll();
    await waitForImmediate();
    stats = { ...stats, contextUsage: { contextWindow: 200_000, tokens: 150 } };
    scheduler.poll();
    await waitForImmediate();

    expect(updates).toEqual([
      {
        inputTokens: 100,
        cachedInputTokens: 10,
        outputTokens: 20,
        totalCostUsd: 0.01,
        contextWindowMaxTokens: 200_000,
        contextWindowUsedTokens: 130,
      },
      {
        inputTokens: 100,
        cachedInputTokens: 10,
        outputTokens: 20,
        totalCostUsd: 0.01,
        contextWindowMaxTokens: 200_000,
        contextWindowUsedTokens: 150,
      },
    ]);
    expect(scheduler.activePollCount()).toBe(1);
    poller.stopTurn();
    expect(scheduler.activePollCount()).toBe(0);
  });

  test("drops an in-flight poll without hiding the final refresh", async () => {
    const scheduler = new ManualPollScheduler();
    const inFlightStats = deferred<PiSessionStats>();
    const finalStats = { contextUsage: { contextWindow: 200_000, tokens: 150 } };
    const finalUsage = {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      totalCostUsd: 0,
      contextWindowMaxTokens: 200_000,
      contextWindowUsedTokens: 150,
    };
    const updates: Array<{ usage: AgentUsage; turnId?: string }> = [];
    let readCount = 0;
    const poller = new PiUsagePoller({
      scheduler,
      readStats: async () => {
        readCount += 1;
        return readCount === 1 ? inFlightStats.promise : finalStats;
      },
      onUsage: (usage, turnId) => updates.push({ usage, turnId }),
      onPollError: (error) => {
        throw error;
      },
    });

    poller.startTurn();
    scheduler.poll();
    await expect(poller.completeTurn("turn-1")).resolves.toBeUndefined();
    inFlightStats.resolve({
      contextUsage: { contextWindow: 200_000, tokens: 130 },
    });
    await waitForImmediate();

    expect(updates).toEqual([{ usage: finalUsage, turnId: "turn-1" }]);
    await expect(poller.completeTurn()).resolves.toBeUndefined();
    expect(updates).toEqual([{ usage: finalUsage, turnId: "turn-1" }]);
  });

  test("drops a final refresh when a newer turn starts", async () => {
    const scheduler = new ManualPollScheduler();
    const finalStats = deferred<PiSessionStats>();
    const updates: AgentUsage[] = [];
    const poller = new PiUsagePoller({
      scheduler,
      readStats: () => finalStats.promise,
      onUsage: (usage) => updates.push(usage),
      onPollError: (error) => {
        throw error;
      },
    });

    poller.startTurn();
    const completion = poller.completeTurn();
    poller.startTurn();
    finalStats.resolve({ contextUsage: { contextWindow: 200_000, tokens: 150 } });

    await expect(completion).resolves.toBeUndefined();
    expect(updates).toEqual([]);
    expect(scheduler.activePollCount()).toBe(1);
    poller.stopTurn();
  });

  test("close permanently suppresses pending usage", async () => {
    const scheduler = new ManualPollScheduler();
    const finalStats = deferred<PiSessionStats>();
    const updates: AgentUsage[] = [];
    const poller = new PiUsagePoller({
      scheduler,
      readStats: () => finalStats.promise,
      onUsage: (usage) => updates.push(usage),
      onPollError: (error) => {
        throw error;
      },
    });

    poller.startTurn();
    const completion = poller.completeTurn();
    poller.close();
    poller.startTurn();
    finalStats.resolve({ contextUsage: { contextWindow: 200_000, tokens: 150 } });

    await expect(completion).resolves.toBeUndefined();
    expect(updates).toEqual([]);
    expect(scheduler.activePollCount()).toBe(0);
  });

  test("normalizes session tokens with cache writes included and cache reads as hits", async () => {
    const scheduler = new ManualPollScheduler();
    const updates: Array<{ usage: AgentUsage; sample?: AgentUsageSample }> = [];
    let stats: PiSessionStats = {
      tokens: { input: 100, cacheRead: 10, cacheWrite: 5, output: 20 },
      cost: 0.01,
      contextUsage: { contextWindow: 200_000, tokens: 130 },
    };
    const poller = new PiUsagePoller({
      scheduler,
      readStats: async () => stats,
      onUsage: (usage, _turnId, sample) => updates.push({ usage, sample }),
      onPollError: (error) => {
        throw error;
      },
    });

    poller.startTurn();
    scheduler.poll();
    await waitForImmediate();
    scheduler.poll();
    await waitForImmediate();
    stats = {
      ...stats,
      tokens: { input: 100, cacheRead: 10, cacheWrite: 15, output: 20 },
    };
    scheduler.poll();
    await waitForImmediate();
    stats = {
      tokens: { input: 4, cacheRead: 2, output: 6 },
      cost: 0.02,
    };
    scheduler.poll();
    await waitForImmediate();

    expect(updates.map((update) => update.usage)).toEqual([
      {
        inputTokens: 100,
        cachedInputTokens: 10,
        outputTokens: 20,
        totalCostUsd: 0.01,
        contextWindowMaxTokens: 200_000,
        contextWindowUsedTokens: 130,
      },
      {
        inputTokens: 100,
        cachedInputTokens: 10,
        outputTokens: 20,
        totalCostUsd: 0.01,
        contextWindowMaxTokens: 200_000,
        contextWindowUsedTokens: 130,
      },
      {
        inputTokens: 4,
        cachedInputTokens: 2,
        outputTokens: 6,
        totalCostUsd: 0.02,
      },
    ]);
    const sampleId = updates[0]?.sample?.id;
    expect(sampleId).toEqual(expect.any(String));
    expect(updates.map((update) => update.sample)).toEqual([
      {
        scope: "session",
        id: sampleId,
        inputTokens: 115,
        cachedInputTokens: 10,
        outputTokens: 20,
      },
      {
        scope: "session",
        id: sampleId,
        inputTokens: 125,
        cachedInputTokens: 10,
        outputTokens: 20,
      },
      {
        scope: "session",
        id: sampleId,
        cachedInputTokens: 2,
        outputTokens: 6,
      },
    ]);
    poller.stopTurn();
  });
  test("marks normalized usage unknown when a later stats report loses its counters", async () => {
    const scheduler = new ManualPollScheduler();
    const samples: Array<AgentUsageSample | undefined> = [];
    let stats: PiSessionStats = {
      tokens: { input: 100, cacheRead: 50, cacheWrite: 0, output: 10 },
    };
    const poller = new PiUsagePoller({
      scheduler,
      readStats: async () => stats,
      onUsage: (_usage, _turnId, sample) => samples.push(sample),
      onPollError: (error) => {
        throw error;
      },
    });
    poller.startTurn();
    try {
      scheduler.poll();
      await waitForImmediate();
      stats = { contextUsage: { contextWindow: 200_000, tokens: 50 } };
      scheduler.poll();
      await waitForImmediate();
      expect(samples).toEqual([
        {
          scope: "session",
          id: expect.any(String),
          inputTokens: 150,
          cachedInputTokens: 50,
          outputTokens: 10,
        },
        { scope: "session", id: samples[0]?.id },
      ]);
    } finally {
      poller.close();
    }
  });
});
