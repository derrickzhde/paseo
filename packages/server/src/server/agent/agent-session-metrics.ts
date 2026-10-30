import type {
  AgentGenerationSample,
  AgentSessionMetrics,
  AgentStreamEvent,
  AgentUsageSample,
} from "./agent-sdk-types.js";

const TPS_WINDOW_MS = 5 * 60 * 1000;

interface Counters {
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheKnown: boolean;
  consistent: boolean;
}

function counter(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export class AgentSessionMetricsLedger {
  private readonly counters = new Map<string, Counters>();
  private readonly generations = new Map<string, AgentGenerationSample & { completedAt: number }>();
  // Retain only completion ages after window eviction so a replay cannot look
  // like new output. This identity history is discarded with the runtime session.
  private readonly generationCompletions = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  observe(event: AgentStreamEvent): void {
    if (event.type === "usage_updated" || event.type === "turn_completed") {
      if (event.usageSample) this.recordUsage(event.usageSample);
      if (event.generationSample) this.recordGeneration(event.generationSample);
    }
  }

  snapshot(): AgentSessionMetrics {
    this.pruneGenerations();
    const metrics = this.generationMetrics();
    let input = 0;
    let cached = 0;
    for (const state of this.counters.values()) {
      if (
        !state.consistent ||
        !state.cacheKnown ||
        state.inputTokens === undefined ||
        state.cachedInputTokens === undefined ||
        state.cachedInputTokens > state.inputTokens
      )
        return metrics;
      input += state.inputTokens;
      cached += state.cachedInputTokens;
    }
    if (input > 0 && Number.isFinite(input) && Number.isFinite(cached)) {
      metrics.cacheHitPercentage = (cached / input) * 100;
    }
    return metrics;
  }

  private generationMetrics(): AgentSessionMetrics {
    const metrics: AgentSessionMetrics = {};
    let output = 0;
    let duration = 0;
    let estimated = false;
    let known = this.generations.size > 0;
    for (const sample of this.generations.values()) {
      const tokens = counter(sample.outputTokens);
      const elapsed = counter(sample.durationMs);
      if (tokens === undefined || elapsed === undefined || elapsed <= 0) {
        known = false;
        break;
      }
      output += tokens;
      duration += elapsed;
      estimated ||= sample.estimated === true;
    }
    if (known && Number.isFinite(output) && Number.isFinite(duration) && duration > 0) {
      const rate = output / (duration / 1000);
      if (Number.isFinite(rate)) {
        metrics.outputTokensPerSecond5m = rate;
        if (estimated) metrics.outputTokensPerSecond5mEstimated = true;
      }
    }
    return metrics;
  }

  nextExpirationAt(): number | undefined {
    let next: number | undefined;
    for (const sample of this.generations.values()) {
      const expires = sample.completedAt + TPS_WINDOW_MS;
      next = next === undefined ? expires : Math.min(next, expires);
    }
    return next;
  }

  private recordGeneration(sample: AgentGenerationSample): void {
    const now = this.now();
    // Keep receipt-only duplicates at their first completion age. Native clocks
    // cannot put a response in the future and indefinitely postpone expiry.
    const completedAt = Math.min(
      counter(sample.completedAt) ?? now,
      this.generationCompletions.get(sample.id) ?? now,
      now,
    );
    this.generationCompletions.set(sample.id, completedAt);
    if (completedAt <= now - TPS_WINDOW_MS) return;
    this.generations.set(sample.id, { ...sample, completedAt });
    this.pruneGenerations();
  }

  private pruneGenerations(): void {
    const cutoff = this.now() - TPS_WINDOW_MS;
    for (const [id, sample] of this.generations) {
      if (sample.completedAt <= cutoff) this.generations.delete(id);
    }
  }

  private recordUsage(sample: AgentUsageSample): void {
    const key = `${sample.scope}:${sample.id}`;
    const inputTokens = counter(sample.inputTokens);
    const cachedInputTokens = counter(sample.cachedInputTokens);
    let state = this.counters.get(key);
    if (!state) {
      state = { cacheKnown: false, consistent: true };
      this.counters.set(key, state);
    } else if (
      sample.scope === "session" &&
      ((inputTokens !== undefined &&
        state.inputTokens !== undefined &&
        inputTokens < state.inputTokens) ||
        (cachedInputTokens !== undefined &&
          state.cachedInputTokens !== undefined &&
          cachedInputTokens < state.cachedInputTokens))
    ) {
      // A decrease can be a reset, compaction retaining old requests, or a
      // correction. Without a new epoch identity their totals are ambiguous.
      state.consistent = false;
    }
    // Request/turn snapshots replace earlier reports of the same unit, including
    // authoritative final corrections. Output counters never reset cache totals.
    state.cacheKnown = inputTokens !== undefined && cachedInputTokens !== undefined;
    if (inputTokens !== undefined) state.inputTokens = inputTokens;
    if (cachedInputTokens !== undefined) state.cachedInputTokens = cachedInputTokens;
  }
}
