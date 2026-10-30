import type { AgentGenerationSample } from "../agent-sdk-types.js";

export interface GenerationSampleSource {
  provider: string;
  sessionId: string;
  responseId?: unknown;
  messageId?: unknown;
  entryId?: unknown;
  timestamp?: unknown;
  timelineId?: unknown;
  completionOrdinal: number;
  outputTokens?: unknown;
  durationMs?: unknown;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nativeId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function generationSampleId(source: GenerationSampleSource): string {
  const prefix = `${source.provider}:${source.sessionId}`;
  const responseId = nativeId(source.responseId);
  if (responseId) {
    return `${prefix}:response:${responseId}`;
  }
  const messageId = nativeId(source.messageId) ?? nativeId(source.entryId);
  if (messageId) {
    return `${prefix}:message:${messageId}`;
  }
  const timestamp = finiteNumber(source.timestamp);
  if (timestamp !== undefined) {
    return `${prefix}:timestamp:${timestamp}`;
  }
  const timelineId = nativeId(source.timelineId);
  if (timelineId) {
    return `${prefix}:timeline:${timelineId}`;
  }
  return `${prefix}:completion:${source.completionOrdinal}`;
}

/** One completed model response. Unknown counts and timing are omitted, not estimated. */
export function buildGenerationSample(source: GenerationSampleSource): AgentGenerationSample {
  const sample: AgentGenerationSample = { id: generationSampleId(source) };
  const outputTokens = finiteNumber(source.outputTokens);
  if (outputTokens !== undefined && outputTokens >= 0) {
    sample.outputTokens = outputTokens;
  }
  const durationMs = finiteNumber(source.durationMs);
  if (durationMs !== undefined && durationMs > 0) {
    sample.durationMs = durationMs;
    const timestamp = finiteNumber(source.timestamp);
    const completedAt = timestamp === undefined ? undefined : timestamp + durationMs;
    if (completedAt !== undefined && Number.isFinite(completedAt)) {
      sample.completedAt = completedAt;
    }
  }
  return sample;
}

/**
 * CC Switch's session-log estimate: request output / elapsed request time,
 * including first-output wait. Freeze the input/tool boundary on first output;
 * delayed usage after a tool result ends at the preceding model output.
 * Source: farion1231/cc-switch@ee8ee25, services/session_usage_codex.rs RequestTimer
 * and components/usage/format.ts isSpeedEstimateEligible (200 tokens, 1 second).
 */
export class EstimatedGenerationTimer {
  private boundaryAt: number | undefined;
  private startedAt: number | undefined;
  private lastOutputAt: number | undefined;
  private toolResultAfterOutput = false;

  constructor(private readonly now: () => number = Date.now) {}

  startTurn(): void {
    this.reset();
    this.boundaryAt = this.now();
  }

  reset(): void {
    this.boundaryAt = undefined;
    this.startedAt = undefined;
    this.lastOutputAt = undefined;
    this.toolResultAfterOutput = false;
  }

  boundary(): void {
    if (this.boundaryAt === undefined) return;
    this.boundaryAt = this.now();
    if (this.lastOutputAt !== undefined) this.toolResultAfterOutput = true;
  }

  output(): void {
    if (this.boundaryAt === undefined) return;
    this.startedAt ??= this.boundaryAt;
    this.lastOutputAt = this.now();
    this.toolResultAfterOutput = false;
  }

  finish(id: string, outputTokens: number | undefined): AgentGenerationSample | undefined {
    const startedAt = this.startedAt;
    const completedAt = this.toolResultAfterOutput ? this.lastOutputAt : this.now();
    const hasOutput = this.lastOutputAt !== undefined;
    this.startedAt = undefined;
    this.lastOutputAt = undefined;
    this.toolResultAfterOutput = false;
    if (this.boundaryAt !== undefined) this.boundaryAt = this.now();
    if (startedAt === undefined || completedAt === undefined || !hasOutput) return undefined;
    const durationMs = completedAt - startedAt;
    if (
      outputTokens === undefined ||
      !Number.isFinite(outputTokens) ||
      outputTokens < 200 ||
      !Number.isFinite(durationMs) ||
      durationMs < 1000 ||
      durationMs > 3_600_000
    )
      return undefined;
    return { id, outputTokens, durationMs, completedAt, estimated: true };
  }
}
