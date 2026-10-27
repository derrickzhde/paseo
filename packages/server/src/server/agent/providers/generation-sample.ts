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
