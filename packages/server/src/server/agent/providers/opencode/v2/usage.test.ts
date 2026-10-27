import type { ModelInfo, OpenCodeEvent, SessionInfo, TokenUsageInfo } from "@opencode/client";
import { describe, expect, test } from "vitest";
import { createTestLogger } from "../../../../../test-utils/test-logger.js";
import type {
  AgentGenerationSample,
  AgentStreamEvent,
  AgentUsage,
  AgentUsageSample,
} from "../../../agent-sdk-types.js";
import { V2Harness } from "../test-utils/v2-harness.js";
import type { V2Api } from "./api.js";
import { OpenCodeV2AgentClient } from "./agent.js";
import { SessionUsage } from "./usage.js";

function model(context: number): ModelInfo {
  return {
    id: "model",
    modelID: "model",
    providerID: "test",
    name: "Model",
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    variants: [],
    time: { released: 1 },
    cost: [],
    status: "active",
    enabled: true,
    limit: { context, output: 10_000 },
  };
}

function stepEnded(harness: V2Harness, id: string, tokens: TokenUsageInfo) {
  harness.push({
    id,
    created: 2,
    type: "session.step.ended",
    durable: { aggregateID: "session", seq: 1, version: 1 },
    data: {
      sessionID: "session",
      assistantMessageID: "answer",
      finish: "tool-calls",
      cost: 0.1,
      tokens,
    },
  });
}

describe("OpenCode v2 context usage", () => {
  test("reports each step's context against the model limit, in step order", async () => {
    const harness = new V2Harness();
    harness.info.model = { providerID: "test", id: "model" };
    harness.info.tokens = {
      input: 900,
      output: 90,
      reasoning: 0,
      cache: { read: 40, write: 0 },
    };
    harness.info.cost = 0.5;
    // Each lookup answers faster than the one before it, so a lookup per step would
    // deliver step 1's usage after step 2's.
    const lookupDelays = [50, 0];
    harness.api.model.list = async (input) => {
      await new Promise((resolve) => setTimeout(resolve, lookupDelays.shift() ?? 0));
      return {
        location: { directory: input.location.directory },
        data: [model(200_000)],
      };
    };
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({
      provider: "opencode",
      cwd: "/tmp/project",
    });
    const usage: AgentUsage[] = [];
    const samples: Array<AgentUsageSample | undefined> = [];
    const generations: Array<AgentGenerationSample | undefined> = [];
    session.subscribe((event) => {
      if (event.type === "usage_updated") {
        usage.push(event.usage);
        samples.push(event.usageSample);
        generations.push(event.generationSample);
      }
    });
    try {
      stepEnded(harness, "step-1", {
        input: 100,
        output: 10,
        reasoning: 5,
        cache: { read: 1_000, write: 20 },
      });
      stepEnded(harness, "step-2", {
        input: 300,
        output: 10,
        reasoning: 5,
        cache: { read: 1_000, write: 20 },
      });
      await expect.poll(() => usage.length).toBe(2);
      expect(usage.map((entry) => entry.contextWindowUsedTokens)).toEqual([1_135, 1_335]);
      expect(usage[1]).toEqual({
        inputTokens: 900,
        outputTokens: 90,
        cachedInputTokens: 40,
        totalCostUsd: 0.5,
        contextWindowUsedTokens: 1_335,
        contextWindowMaxTokens: 200_000,
      });
      expect(samples).toEqual([
        {
          scope: "request",
          id: "step-1",
          inputTokens: 1120,
          cachedInputTokens: 1000,
          outputTokens: 15,
        },
        {
          scope: "request",
          id: "step-2",
          inputTokens: 1320,
          cachedInputTokens: 1000,
          outputTokens: 15,
        },
      ]);
      expect(generations).toEqual([
        { id: "answer", outputTokens: 15, completedAt: 2 },
        { id: "answer", outputTokens: 15, completedAt: 2 },
      ]);
    } finally {
      await session.close();
    }
  });
});

function sessionInfo(): SessionInfo {
  return {
    id: "session",
    projectID: "project",
    location: { directory: "/tmp/project" },
    agent: "build",
    model: { providerID: "test", id: "model" },
    tokens: { input: 900, output: 90, reasoning: 0, cache: { read: 40, write: 0 } },
    cost: 0.5,
    time: { created: 1, updated: 1 },
    outcome: "succeeded",
  };
}

function durable(sessionID: string, seq: number) {
  return { aggregateID: sessionID, seq, version: 1 as const };
}

function startedEvent(
  assistantMessageID: string,
  startedAt: number,
  created: number,
  sessionID = "session",
): OpenCodeEvent {
  return {
    id: `start-${assistantMessageID}-${created}`,
    created,
    type: "session.step.started",
    durable: durable(sessionID, created),
    data: {
      sessionID,
      assistantMessageID,
      agent: "build",
      model: { providerID: "test", id: "model" },
      started: startedAt,
    },
  };
}

function streamedEvent(
  assistantMessageID: string,
  created: number,
  sessionID = "session",
): OpenCodeEvent {
  return {
    id: `streamed-${assistantMessageID}-${created}`,
    created,
    type: "session.step.streamed",
    durable: durable(sessionID, created),
    data: { sessionID, assistantMessageID },
  };
}

function endedEvent(input: {
  id: string;
  assistantMessageID: string;
  created: number;
  tokens: TokenUsageInfo;
  sessionID?: string;
}): OpenCodeEvent {
  const sessionID = input.sessionID ?? "session";
  return {
    id: input.id,
    created: input.created,
    type: "session.step.ended",
    durable: durable(sessionID, input.created),
    data: {
      sessionID,
      assistantMessageID: input.assistantMessageID,
      finish: "tool-calls",
      cost: 0.1,
      tokens: input.tokens,
    },
  };
}

function failedEvent(input: {
  id: string;
  assistantMessageID: string;
  created: number;
  tokens?: TokenUsageInfo;
}): OpenCodeEvent {
  return {
    id: input.id,
    created: input.created,
    type: "session.step.failed",
    durable: durable("session", input.created),
    data: {
      sessionID: "session",
      assistantMessageID: input.assistantMessageID,
      error: { type: "aborted", message: "Step interrupted" },
      ...(input.tokens ? { tokens: input.tokens } : {}),
    },
  };
}

function toolInputEnded(assistantMessageID: string, created: number): OpenCodeEvent {
  return {
    id: `tool-${created}`,
    created,
    type: "session.tool.input.ended",
    durable: durable("session", created),
    data: { sessionID: "session", assistantMessageID, id: "call-1", text: "{}" },
  };
}

function stepTokens(
  input: number,
  output: number,
  reasoning: number,
  read = 0,
  write = 0,
): TokenUsageInfo {
  return { input, output, reasoning, cache: { read, write } };
}

function updates(events: AgentStreamEvent[]) {
  return events.flatMap((event) => (event.type === "usage_updated" ? [event] : []));
}

function createUsage(list?: V2Api["model"]["list"]) {
  const events: AgentStreamEvent[] = [];
  const errors: unknown[] = [];
  let listed = 0;
  const usage = new SessionUsage({
    client: () =>
      ({
        model: {
          list: async (input) => {
            listed += 1;
            if (list) return list(input);
            return {
              location: { directory: input?.location?.directory ?? "/tmp/project" },
              data: [model(200_000)],
            };
          },
        },
      }) as V2Api,
    cwd: "/tmp/project",
    info: sessionInfo,
    emit: (event) => events.push(event),
    reportError: (error) => errors.push(error),
  });
  return {
    usage,
    events,
    errors,
    listed: () => listed,
  };
}

describe("OpenCode v2 active generation", () => {
  test("times dispatch to the streamed boundary and ignores tool settlement", async () => {
    const { usage, events, errors } = createUsage();
    usage.observe(startedEvent("msg-a", 1_000, 500));
    usage.observe(toolInputEnded("msg-a", 1_200));
    usage.observe(startedEvent("msg-a", 100, 50, "other-session"));
    usage.observe(streamedEvent("msg-a", 400, "other-session"));
    usage.observe(
      endedEvent({
        id: "end-other",
        assistantMessageID: "msg-a",
        created: 800,
        tokens: stepTokens(1, 50, 50),
        sessionID: "other-session",
      }),
    );
    usage.observe(streamedEvent("msg-a", 1_600));
    usage.observe(
      endedEvent({
        id: "end-a",
        assistantMessageID: "msg-a",
        created: 9_000,
        tokens: stepTokens(100, 10, 5, 1_000, 20),
      }),
    );
    await expect.poll(() => events.length).toBe(1);
    expect(events[0]).toEqual({
      type: "usage_updated",
      provider: "opencode",
      usage: {
        inputTokens: 900,
        outputTokens: 90,
        cachedInputTokens: 40,
        totalCostUsd: 0.5,
        contextWindowUsedTokens: 1_135,
        contextWindowMaxTokens: 200_000,
      },
      usageSample: {
        scope: "request",
        id: "end-a",
        inputTokens: 1_120,
        cachedInputTokens: 1_000,
        outputTokens: 15,
      },
      generationSample: {
        id: "msg-a",
        outputTokens: 15,
        durationMs: 600,
        completedAt: 1_600,
      },
    });
    expect(errors).toEqual([]);
  });

  test("pairs interleaved assistant responses without combining their counts", async () => {
    const { usage, events } = createUsage();
    usage.observe(startedEvent("msg-a", 1_000, 900));
    usage.observe(startedEvent("msg-b", 5_000, 4_900));
    usage.observe(streamedEvent("msg-b", 5_400));
    usage.observe(streamedEvent("msg-a", 2_800));
    usage.observe(
      endedEvent({
        id: "end-b",
        assistantMessageID: "msg-b",
        created: 20_000,
        tokens: stepTokens(10, 1, 1),
      }),
    );
    usage.observe(
      endedEvent({
        id: "end-a",
        assistantMessageID: "msg-a",
        created: 21_000,
        tokens: stepTokens(10, 8, 2),
      }),
    );
    await expect.poll(() => events.length).toBe(2);
    expect(updates(events).map((event) => event.generationSample)).toEqual([
      { id: "msg-b", outputTokens: 2, durationMs: 400, completedAt: 5_400 },
      { id: "msg-a", outputTokens: 10, durationMs: 1_800, completedAt: 2_800 },
    ]);
  });

  test("keeps replayed terminal timing and clears it when that step starts again", async () => {
    const { usage, events } = createUsage();
    usage.observe(startedEvent("msg-a", 1_000, 500));
    usage.observe(streamedEvent("msg-a", 1_500));
    const first = endedEvent({
      id: "end-a",
      assistantMessageID: "msg-a",
      created: 9_000,
      tokens: stepTokens(1, 10, 5),
    });
    usage.observe(first);
    usage.observe(
      endedEvent({
        id: "end-a-replay",
        assistantMessageID: "msg-a",
        created: 99_000,
        tokens: stepTokens(1, 10, 5),
      }),
    );
    usage.observe(startedEvent("msg-a", 3_000, 99_100));
    usage.observe(
      endedEvent({
        id: "end-a-retry",
        assistantMessageID: "msg-a",
        created: 8_000,
        tokens: stepTokens(1, 4, 1),
      }),
    );
    await expect.poll(() => events.length).toBe(3);
    expect(updates(events).map((event) => event.generationSample)).toEqual([
      { id: "msg-a", outputTokens: 15, durationMs: 500, completedAt: 1_500 },
      { id: "msg-a", outputTokens: 15, durationMs: 500, completedAt: 1_500 },
      { id: "msg-a", outputTokens: 5, completedAt: 8_000 },
    ]);
  });

  test("omits duration when a boundary is missing or not positive", async () => {
    const { usage, events } = createUsage();
    usage.observe(startedEvent("missing-stream", 1_000, 500));
    usage.observe(
      endedEvent({
        id: "end-missing-stream",
        assistantMessageID: "missing-stream",
        created: 5_000,
        tokens: stepTokens(1, 3, 1),
      }),
    );
    usage.observe(streamedEvent("missing-start", 1_800));
    usage.observe(
      endedEvent({
        id: "end-missing-start",
        assistantMessageID: "missing-start",
        created: 5_000,
        tokens: stepTokens(1, 3, 1),
      }),
    );
    usage.observe(
      endedEvent({
        id: "end-neither",
        assistantMessageID: "neither",
        created: 4_200,
        tokens: stepTokens(1, 3, 1),
      }),
    );
    usage.observe(startedEvent("zero", 1_000, 500));
    usage.observe(streamedEvent("zero", 1_000));
    usage.observe(
      endedEvent({
        id: "end-zero",
        assistantMessageID: "zero",
        created: 2_000,
        tokens: stepTokens(1, 3, 1),
      }),
    );
    usage.observe(startedEvent("negative", 2_000, 500));
    usage.observe(streamedEvent("negative", 1_500));
    usage.observe(
      endedEvent({
        id: "end-negative",
        assistantMessageID: "negative",
        created: 9_000,
        tokens: stepTokens(1, 3, 1),
      }),
    );
    usage.observe(startedEvent("invalid-start", Number.NaN, 500));
    usage.observe(streamedEvent("invalid-start", 1_700));
    usage.observe(
      endedEvent({
        id: "end-invalid-start",
        assistantMessageID: "invalid-start",
        created: 3_000,
        tokens: stepTokens(1, 3, 1),
      }),
    );
    await expect.poll(() => events.length).toBe(6);
    expect(updates(events).map((event) => event.generationSample)).toEqual([
      { id: "missing-stream", outputTokens: 4, completedAt: 5_000 },
      { id: "missing-start", outputTokens: 4, completedAt: 1_800 },
      { id: "neither", outputTokens: 4, completedAt: 4_200 },
      { id: "zero", outputTokens: 4, completedAt: 1_000 },
      { id: "negative", outputTokens: 4, completedAt: 1_500 },
      { id: "invalid-start", outputTokens: 4, completedAt: 1_700 },
    ]);
  });

  test("snapshots the sample before a later step start and the model catalog", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { usage, events, listed } = createUsage(async (input) => {
      await gate;
      return {
        location: { directory: input?.location?.directory ?? "/tmp/project" },
        data: [model(200_000)],
      };
    });
    usage.observe(startedEvent("msg-a", 1_000, 500));
    usage.observe(streamedEvent("msg-a", 1_600));
    usage.observe(
      endedEvent({
        id: "end-a",
        assistantMessageID: "msg-a",
        created: 9_000,
        tokens: stepTokens(1, 10, 5),
      }),
    );
    usage.observe(startedEvent("msg-a", 3_000, 9_100));
    await expect.poll(() => listed()).toBe(1);
    expect(events).toEqual([]);
    release();
    await expect.poll(() => events.length).toBe(1);
    expect(updates(events)[0]?.generationSample).toEqual({
      id: "msg-a",
      outputTokens: 15,
      durationMs: 600,
      completedAt: 1_600,
    });
  });

  test("counts a smaller later response separately from the earlier one", async () => {
    const { usage, events } = createUsage();
    usage.observe(startedEvent("msg-a", 1_000, 500));
    usage.observe(streamedEvent("msg-a", 2_000));
    usage.observe(
      endedEvent({
        id: "end-a",
        assistantMessageID: "msg-a",
        created: 3_000,
        tokens: stepTokens(1, 80, 20),
      }),
    );
    usage.observe(startedEvent("msg-b", 4_000, 3_500));
    usage.observe(streamedEvent("msg-b", 4_500));
    usage.observe(
      endedEvent({
        id: "end-b",
        assistantMessageID: "msg-b",
        created: 8_000,
        tokens: stepTokens(1, 5, 1),
      }),
    );
    await expect.poll(() => events.length).toBe(2);
    expect(updates(events).map((event) => event.usage.outputTokens)).toEqual([90, 90]);
    expect(updates(events).map((event) => event.usageSample?.outputTokens)).toEqual([100, 6]);
    expect(updates(events).map((event) => event.generationSample)).toEqual([
      { id: "msg-a", outputTokens: 100, durationMs: 1_000, completedAt: 2_000 },
      { id: "msg-b", outputTokens: 6, durationMs: 500, completedAt: 4_500 },
    ]);
  });

  test("publishes a failed response without inventing cache counters", async () => {
    let listed = 0;
    const { usage, events } = createUsage(() => {
      listed += 1;
      return new Promise(() => {}) as ReturnType<V2Api["model"]["list"]>;
    });
    usage.observe(startedEvent("msg-a", 1_000, 500));
    usage.observe(streamedEvent("msg-a", 1_600));
    usage.observe(failedEvent({ id: "fail-partial", assistantMessageID: "msg-a", created: 9_000 }));
    usage.observe(failedEvent({ id: "fail-unknown", assistantMessageID: "msg-b", created: 4_000 }));
    await expect.poll(() => events.length).toBe(2);
    expect(listed).toBe(0);
    expect(events).toEqual([
      {
        type: "usage_updated",
        provider: "opencode",
        usage: {
          inputTokens: 900,
          outputTokens: 90,
          cachedInputTokens: 40,
          totalCostUsd: 0.5,
        },
        generationSample: { id: "msg-a", durationMs: 600, completedAt: 1_600 },
      },
      {
        type: "usage_updated",
        provider: "opencode",
        usage: {
          inputTokens: 900,
          outputTokens: 90,
          cachedInputTokens: 40,
          totalCostUsd: 0.5,
        },
        generationSample: { id: "msg-b", completedAt: 4_000 },
      },
    ]);
  });

  test("uses the completed-step cache sample when a failed response has tokens", async () => {
    const { usage, events, listed } = createUsage();
    usage.observe(startedEvent("msg-a", 1_000, 500));
    usage.observe(streamedEvent("msg-a", 1_600));
    usage.observe(
      failedEvent({
        id: "fail-a",
        assistantMessageID: "msg-a",
        created: 9_000,
        tokens: stepTokens(100, 10, 5, 1_000, 20),
      }),
    );
    await expect.poll(() => events.length).toBe(1);
    expect(listed()).toBe(1);
    expect(events[0]).toEqual({
      type: "usage_updated",
      provider: "opencode",
      usage: {
        inputTokens: 900,
        outputTokens: 90,
        cachedInputTokens: 40,
        totalCostUsd: 0.5,
        contextWindowUsedTokens: 1_135,
        contextWindowMaxTokens: 200_000,
      },
      usageSample: {
        scope: "request",
        id: "fail-a",
        inputTokens: 1_120,
        cachedInputTokens: 1_000,
        outputTokens: 15,
      },
      generationSample: {
        id: "msg-a",
        outputTokens: 15,
        durationMs: 600,
        completedAt: 1_600,
      },
    });
  });
});
