import type { AgentInfo, ModelInfo, OpenCodeEvent, TokenUsageInfo } from "@opencode/client";
import { expect, test } from "vitest";
import { generationSampleFromV2, modelsFromV2, modesFromV2, usageSampleFromV2 } from "./mapping.js";

test("normalizes v2 model capabilities, variants, and visible primary modes", () => {
  const model: ModelInfo = {
    id: "model",
    modelID: "native-model",
    providerID: "provider",
    name: "Model",
    capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
    variants: [{ id: "high" }],
    time: { released: 1 },
    cost: [],
    status: "active",
    enabled: true,
    limit: { context: 200000, output: 10000 },
  };
  expect(modelsFromV2([model, { ...model, id: "disabled", enabled: false }])).toEqual([
    {
      provider: "opencode",
      id: "provider/model",
      label: "Model",
      contextWindowMaxTokens: 200000,
      metadata: {
        providerId: "provider",
        modelId: "model",
        supportsAttachments: true,
        supportsToolCall: true,
        contextWindowMaxTokens: 200000,
      },
      thinkingOptions: [{ id: "high", label: "high" }],
    },
  ]);
  const agent: AgentInfo = {
    id: "build",
    name: "Build",
    mode: "primary",
    hidden: false,
    request: { settings: {}, headers: {}, body: {} },
    permissions: [],
  };
  expect(
    modesFromV2([
      agent,
      { ...agent, id: "hidden", hidden: true },
      { ...agent, id: "child", mode: "subagent" },
    ]),
  ).toEqual([{ id: "build", label: "Build", description: undefined }]);
});

test("normalizes completed step tokens into an inclusive request sample", () => {
  const step: Extract<OpenCodeEvent, { type: "session.step.ended" }> = {
    id: "step-1",
    created: 2,
    type: "session.step.ended",
    durable: { aggregateID: "session", seq: 1, version: 1 },
    data: {
      sessionID: "session",
      assistantMessageID: "answer",
      finish: "stop",
      cost: 0,
      tokens: { input: 100, output: 7, reasoning: 4, cache: { read: 40, write: 5 } },
    },
  };
  expect(usageSampleFromV2(step)).toEqual({
    scope: "request",
    id: "step-1",
    inputTokens: 145,
    cachedInputTokens: 40,
    outputTokens: 11,
  });

  const partialCache = {
    ...step,
    data: {
      ...step.data,
      tokens: { input: 100, output: 7, reasoning: 4, cache: { read: 40 } } as TokenUsageInfo,
    },
  };
  expect(usageSampleFromV2(partialCache)).toEqual({
    scope: "request",
    id: "step-1",
    cachedInputTokens: 40,
    outputTokens: 11,
  });

  const missingReasoning = {
    ...step,
    data: {
      ...step.data,
      tokens: { input: 100, output: 7, cache: { read: 40, write: 5 } } as TokenUsageInfo,
    },
  };
  expect(usageSampleFromV2(missingReasoning)).toEqual({
    scope: "request",
    id: "step-1",
    inputTokens: 145,
    cachedInputTokens: 40,
  });

  const failed: Extract<OpenCodeEvent, { type: "session.step.failed" }> = {
    id: "step-failed",
    created: 9_000,
    type: "session.step.failed",
    durable: { aggregateID: "session", seq: 2, version: 1 },
    data: {
      sessionID: "session",
      assistantMessageID: "answer",
      error: { type: "aborted", message: "Step interrupted" },
    },
  };
  expect(usageSampleFromV2(failed)).toBeUndefined();
  expect(
    usageSampleFromV2({
      ...failed,
      data: { ...failed.data, tokens: step.data.tokens },
    }),
  ).toEqual({
    scope: "request",
    id: "step-failed",
    inputTokens: 145,
    cachedInputTokens: 40,
    outputTokens: 11,
  });
});

test("times one completed response from dispatch to the streamed boundary", () => {
  const step: Extract<OpenCodeEvent, { type: "session.step.ended" }> = {
    id: "step-1",
    created: 9_000,
    type: "session.step.ended",
    durable: { aggregateID: "session", seq: 1, version: 1 },
    data: {
      sessionID: "session",
      assistantMessageID: "answer",
      finish: "tool-calls",
      cost: 0,
      tokens: { input: 100, output: 7, reasoning: 4, cache: { read: 40, write: 5 } },
    },
  };
  expect(generationSampleFromV2(step, { started: 1_000, streamed: 1_800 })).toEqual({
    id: "answer",
    outputTokens: 11,
    durationMs: 800,
    completedAt: 1_800,
  });
  expect(generationSampleFromV2(step, { started: 1_800, streamed: 1_800 })).toEqual({
    id: "answer",
    outputTokens: 11,
    completedAt: 1_800,
  });
  expect(generationSampleFromV2(step, { started: 2_000, streamed: 1_800 })).toEqual({
    id: "answer",
    outputTokens: 11,
    completedAt: 1_800,
  });
  expect(generationSampleFromV2(step, { started: 1_000 })).toEqual({
    id: "answer",
    outputTokens: 11,
    completedAt: 9_000,
  });
  expect(generationSampleFromV2(step, undefined)).toEqual({
    id: "answer",
    outputTokens: 11,
    completedAt: 9_000,
  });
  const invalidTokens = {
    ...step,
    data: {
      ...step.data,
      tokens: { input: 100, output: -1, reasoning: 4, cache: { read: 40, write: 5 } },
    },
  };
  expect(generationSampleFromV2(invalidTokens, { started: 1_000, streamed: 1_800 })).toEqual({
    id: "answer",
    durationMs: 800,
    completedAt: 1_800,
  });
  const failed: Extract<OpenCodeEvent, { type: "session.step.failed" }> = {
    id: "step-failed",
    created: 4_000,
    type: "session.step.failed",
    durable: { aggregateID: "session", seq: 2, version: 1 },
    data: {
      sessionID: "session",
      assistantMessageID: "answer",
      error: { type: "aborted", message: "Step interrupted" },
    },
  };
  expect(generationSampleFromV2(failed, { started: 1_000, streamed: 1_800 })).toEqual({
    id: "answer",
    durationMs: 800,
    completedAt: 1_800,
  });
  expect(generationSampleFromV2({ ...failed, created: Number.NaN }, undefined)).toEqual({
    id: "answer",
  });
});
