import type { AgentInfo, ModelInfo, ModelRef, SessionInfo, OpenCodeEvent } from "@opencode/client";
import type {
  AgentGenerationSample,
  AgentMode,
  AgentModelDefinition,
  AgentUsage,
  AgentUsageSample,
} from "../../../agent-sdk-types.js";

export function modelRef(id: string, variant?: string | null): ModelRef {
  const slash = id.indexOf("/");
  if (slash < 1 || slash === id.length - 1)
    throw new Error("OpenCode model must be provider/model");
  return {
    providerID: id.slice(0, slash),
    id: id.slice(slash + 1),
    ...(variant ? { variant } : {}),
  };
}

export function modelsFromV2(models: ModelInfo[]): AgentModelDefinition[] {
  return models
    .filter((model) => model.enabled)
    .map((model) => ({
      provider: "opencode",
      id: `${model.providerID}/${model.id}`,
      label: model.name,
      contextWindowMaxTokens: model.limit.context,
      metadata: {
        providerId: model.providerID,
        modelId: model.id,
        supportsAttachments: model.capabilities.input.includes("image"),
        supportsToolCall: model.capabilities.tools,
        contextWindowMaxTokens: model.limit.context,
      },
      thinkingOptions: model.variants.map((variant) => ({ id: variant.id, label: variant.id })),
    }));
}

export function modesFromV2(agents: AgentInfo[]): AgentMode[] {
  return agents
    .filter((agent) => !agent.hidden && agent.mode !== "subagent")
    .map((agent) => ({ id: agent.id, label: agent.name, description: agent.description }));
}

export function usageFromV2(session: SessionInfo): AgentUsage {
  return {
    inputTokens: session.tokens.input,
    outputTokens: session.tokens.output,
    cachedInputTokens: session.tokens.cache.read,
    totalCostUsd: session.cost,
  };
}

type TerminalStep = Extract<OpenCodeEvent, { type: "session.step.ended" | "session.step.failed" }>;

function finiteTokenCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return value;
}

function finiteTimestamp(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

function outputAndReasoningTokens(
  tokens: { output?: unknown; reasoning?: unknown } | undefined,
): number | undefined {
  if (!tokens) return undefined;
  const output = finiteTokenCount(tokens.output);
  const reasoning = finiteTokenCount(tokens.reasoning);
  if (output === undefined || reasoning === undefined) return undefined;
  return output + reasoning;
}

export function usageSampleFromV2(step: TerminalStep): AgentUsageSample | undefined {
  const tokens = step.data.tokens;
  if (!tokens) return undefined;
  const input = finiteTokenCount(tokens.input);
  const cacheRead = finiteTokenCount(tokens.cache?.read);
  const cacheWrite = finiteTokenCount(tokens.cache?.write);
  const sample: AgentUsageSample = { scope: "request", id: step.id };
  if (input !== undefined && cacheRead !== undefined && cacheWrite !== undefined) {
    sample.inputTokens = input + cacheRead + cacheWrite;
  }
  if (cacheRead !== undefined) {
    sample.cachedInputTokens = cacheRead;
  }
  const outputTokens = outputAndReasoningTokens(tokens);
  if (outputTokens !== undefined) sample.outputTokens = outputTokens;
  return sample;
}

export function generationSampleFromV2(
  step: TerminalStep,
  timing: { started?: number; streamed?: number } | undefined,
): AgentGenerationSample {
  const sample: AgentGenerationSample = { id: step.data.assistantMessageID };
  const outputTokens = outputAndReasoningTokens(step.data.tokens);
  if (outputTokens !== undefined) sample.outputTokens = outputTokens;
  const started = finiteTimestamp(timing?.started);
  const streamed = finiteTimestamp(timing?.streamed);
  // Duration ends at the provider response boundary. Step completion includes tool settlement.
  if (started !== undefined && streamed !== undefined && streamed - started > 0) {
    sample.durationMs = streamed - started;
  }
  const completedAt = streamed ?? finiteTimestamp(step.created);
  if (completedAt !== undefined) sample.completedAt = completedAt;
  return sample;
}
