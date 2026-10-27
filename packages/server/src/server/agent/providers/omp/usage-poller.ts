import { randomUUID } from "node:crypto";

import type { AgentUsage, AgentUsageSample } from "../../agent-sdk-types.js";
import type { OmpSessionStats } from "./rpc-types.js";

export interface OmpUsagePollScheduler {
  schedulePoll(callback: () => void): () => void;
}

interface OmpUsagePollerOptions {
  readStats(): Promise<OmpSessionStats>;
  onUsage(usage: AgentUsage, turnId?: string, usageSample?: AgentUsageSample): void;
  onPollError(error: unknown): void;
  scheduler?: OmpUsagePollScheduler;
}

function createScheduler(): OmpUsagePollScheduler {
  return {
    schedulePoll: (callback) => {
      const timer = setTimeout(callback, 3_000);
      return () => clearTimeout(timer);
    },
  };
}

function toAgentUsage(stats: OmpSessionStats): AgentUsage | undefined {
  const inputTokens = stats.tokens?.input ?? 0;
  const cachedInputTokens = stats.tokens?.cacheRead ?? 0;
  const outputTokens = stats.tokens?.output ?? 0;
  const totalCostUsd = stats.cost ?? 0;
  const contextWindowMaxTokens = stats.contextUsage?.contextWindow ?? undefined;
  const contextWindowUsedTokens = stats.contextUsage?.tokens ?? undefined;

  if (
    inputTokens === 0 &&
    cachedInputTokens === 0 &&
    outputTokens === 0 &&
    totalCostUsd === 0 &&
    contextWindowMaxTokens === undefined &&
    contextWindowUsedTokens === undefined
  ) {
    return undefined;
  }

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalCostUsd,
    ...(typeof contextWindowMaxTokens === "number" ? { contextWindowMaxTokens } : {}),
    ...(typeof contextWindowUsedTokens === "number" ? { contextWindowUsedTokens } : {}),
  };
}

function readTokenCount(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return value;
}

function toAgentUsageSample(stats: OmpSessionStats, id: string): AgentUsageSample {
  // An empty sample invalidates a previously known percentage when stats lose
  // their counters. A missing sample would leave that stale percentage visible.
  const tokens = stats.tokens ?? {};
  const input = readTokenCount(tokens.input);
  const cacheRead = readTokenCount(tokens.cacheRead);
  const cacheWrite = readTokenCount(tokens.cacheWrite);
  const output = readTokenCount(tokens.output);
  const sample: AgentUsageSample = { scope: "session", id };
  if (input !== undefined && cacheRead !== undefined && cacheWrite !== undefined) {
    sample.inputTokens = input + cacheRead + cacheWrite;
  }
  if (cacheRead !== undefined) {
    sample.cachedInputTokens = cacheRead;
  }
  if (output !== undefined) {
    sample.outputTokens = output;
  }
  return sample;
}

function isSameUsage(left: AgentUsage, right: AgentUsage): boolean {
  return (
    left.inputTokens === right.inputTokens &&
    left.cachedInputTokens === right.cachedInputTokens &&
    left.outputTokens === right.outputTokens &&
    left.totalCostUsd === right.totalCostUsd &&
    left.contextWindowMaxTokens === right.contextWindowMaxTokens &&
    left.contextWindowUsedTokens === right.contextWindowUsedTokens
  );
}

function isSameSample(left: AgentUsageSample, right: AgentUsageSample): boolean {
  return (
    left.scope === right.scope &&
    left.id === right.id &&
    left.inputTokens === right.inputTokens &&
    left.cachedInputTokens === right.cachedInputTokens &&
    left.outputTokens === right.outputTokens
  );
}

export class OmpUsagePoller {
  private readonly scheduler: OmpUsagePollScheduler;
  private active = false;
  private closed = false;
  private generation = 0;
  private cancelScheduledPoll: (() => void) | null = null;
  private lastUsage: AgentUsage | null = null;
  private lastSample: AgentUsageSample | undefined;
  private readonly sampleId = randomUUID();

  constructor(private readonly options: OmpUsagePollerOptions) {
    this.scheduler = options.scheduler ?? createScheduler();
  }

  startTurn(): void {
    if (this.closed || this.active) {
      return;
    }
    this.active = true;
    this.generation += 1;
    this.schedule(this.generation);
  }

  stopTurn(): void {
    this.active = false;
    this.invalidatePendingWork();
  }

  async completeTurn(turnId?: string): Promise<void> {
    if (this.closed) {
      return;
    }
    this.active = false;
    const completionGeneration = this.invalidatePendingWork();
    let usage: AgentUsage | undefined;
    let sample: AgentUsageSample | undefined;
    try {
      const stats = await this.options.readStats();
      usage = toAgentUsage(stats);
      sample = toAgentUsageSample(stats, this.sampleId);
    } catch {
      return;
    }
    if (this.closed || this.generation !== completionGeneration) {
      return;
    }
    this.publishUsage(usage, sample, turnId);
  }

  async refresh(): Promise<void> {
    let usage: AgentUsage | undefined;
    let sample: AgentUsageSample | undefined;
    try {
      const stats = await this.options.readStats();
      usage = toAgentUsage(stats);
      sample = toAgentUsageSample(stats, this.sampleId);
    } catch (error) {
      if (!this.closed) this.options.onPollError(error);
      return;
    }
    if (!this.closed) this.publishUsage(usage, sample);
  }

  close(): void {
    this.closed = true;
    this.active = false;
    this.invalidatePendingWork();
  }

  private invalidatePendingWork(): number {
    this.generation += 1;
    this.cancelScheduledPoll?.();
    this.cancelScheduledPoll = null;
    return this.generation;
  }

  private schedule(generation: number): void {
    this.cancelScheduledPoll = this.scheduler.schedulePoll(() => {
      this.cancelScheduledPoll = null;
      void this.poll(generation);
    });
  }

  private async poll(generation: number): Promise<void> {
    let usage: AgentUsage | undefined;
    let sample: AgentUsageSample | undefined;
    try {
      const stats = await this.options.readStats();
      usage = toAgentUsage(stats);
      sample = toAgentUsageSample(stats, this.sampleId);
    } catch (error) {
      try {
        if (this.active && !this.closed && this.generation === generation) {
          this.options.onPollError(error);
        }
      } finally {
        if (this.active && !this.closed && this.generation === generation) {
          this.schedule(generation);
        }
      }
      return;
    }
    try {
      if (this.active && !this.closed && this.generation === generation) {
        this.publishUsage(usage, sample);
      }
    } finally {
      if (this.active && !this.closed && this.generation === generation) {
        this.schedule(generation);
      }
    }
  }

  private takeChangedUsage(usage: AgentUsage | undefined): AgentUsage | undefined {
    if (!usage || (this.lastUsage && isSameUsage(this.lastUsage, usage))) {
      return undefined;
    }
    this.lastUsage = usage;
    return usage;
  }

  private takeChangedSample(sample: AgentUsageSample | undefined): AgentUsageSample | undefined {
    if (!sample || (this.lastSample && isSameSample(this.lastSample, sample))) {
      return undefined;
    }
    this.lastSample = sample;
    return sample;
  }

  private publishUsage(
    usage: AgentUsage | undefined,
    sample: AgentUsageSample | undefined,
    turnId?: string,
  ): void {
    const changedUsage = this.takeChangedUsage(usage);
    const changedSample = this.takeChangedSample(sample);
    if (!changedUsage && !changedSample) {
      return;
    }
    const deliveredUsage = changedUsage ?? this.lastUsage;
    if (!deliveredUsage) {
      return;
    }
    this.options.onUsage(deliveredUsage, turnId, changedSample ?? sample);
  }
}
