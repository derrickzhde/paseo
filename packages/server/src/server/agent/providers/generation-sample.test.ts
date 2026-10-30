import { describe, expect, test } from "vitest";

import {
  buildGenerationSample,
  EstimatedGenerationTimer,
  type GenerationSampleSource,
} from "./generation-sample.js";

function source(overrides: Partial<GenerationSampleSource> = {}): GenerationSampleSource {
  return {
    provider: "pi",
    sessionId: "sess-1",
    completionOrdinal: 1,
    ...overrides,
  };
}

describe("generation samples", () => {
  test("estimates request throughput from the preceding boundary, including first-output wait", () => {
    let now = 1000;
    const timer = new EstimatedGenerationTimer(() => now);
    timer.startTurn();
    now = 5000;
    timer.output();
    now = 13_000;
    expect(timer.finish("request", 600)).toEqual({
      id: "request",
      outputTokens: 600,
      durationMs: 12_000,
      completedAt: 13_000,
      estimated: true,
    });
    expect(timer.finish("request", 600)).toBeUndefined();
  });

  test("excludes tool settlement when usage arrives after tools and starts again after tool results", () => {
    let now = 1000;
    const timer = new EstimatedGenerationTimer(() => now);
    timer.startTurn();
    now = 11_000;
    timer.output();
    now = 91_000;
    timer.boundary();
    expect(timer.finish("before-tool", 500)).toEqual({
      id: "before-tool",
      outputTokens: 500,
      durationMs: 10_000,
      completedAt: 11_000,
      estimated: true,
    });
    now = 101_000;
    timer.output();
    now = 111_000;
    expect(timer.finish("after-tool", 400)).toEqual({
      id: "after-tool",
      outputTokens: 400,
      durationMs: 20_000,
      completedAt: 111_000,
      estimated: true,
    });
  });

  test("drops an unfinished request on a new turn rather than counting idle time", () => {
    let now = 1000;
    const timer = new EstimatedGenerationTimer(() => now);
    timer.startTurn();
    timer.output();
    now = 100_000;
    timer.reset();
    timer.output();
    expect(timer.finish("idle", 1000)).toBeUndefined();
    timer.startTurn();
    now = 105_000;
    timer.output();
    expect(timer.finish("fresh", 500)?.durationMs).toBe(5000);
  });

  test.each([
    { tokens: 200, duration: 1000 },
    { tokens: 300, duration: 3_600_000 },
  ])("accepts eligible estimate boundaries (%j)", ({ tokens, duration }) => {
    let now = 1000;
    const timer = new EstimatedGenerationTimer(() => now);
    timer.startTurn();
    now += duration;
    timer.output();
    expect(timer.finish("eligible", tokens)).toEqual({
      id: "eligible",
      outputTokens: tokens,
      durationMs: duration,
      completedAt: now,
      estimated: true,
    });
  });

  test.each([
    { tokens: 199, duration: 10_000 },
    { tokens: 200, duration: 999 },
    { tokens: Number.NaN, duration: 10_000 },
    { tokens: 300, duration: -1000 },
    { tokens: 300, duration: 3_600_001 },
  ])("keeps an unreliable estimate unavailable (%j)", ({ tokens, duration }) => {
    let now = 10_000;
    const timer = new EstimatedGenerationTimer(() => now);
    timer.startTurn();
    now += duration;
    timer.output();
    expect(timer.finish("unreliable", tokens)).toBeUndefined();
  });

  test("builds one generation sample from output tokens and duration", () => {
    expect(
      buildGenerationSample(
        source({
          responseId: "resp-1",
          messageId: "entry-1",
          timestamp: 1_000,
          timelineId: "timeline-1",
          outputTokens: 120,
          durationMs: 2_500,
        }),
      ),
    ).toEqual({
      id: "pi:sess-1:response:resp-1",
      outputTokens: 120,
      durationMs: 2_500,
      completedAt: 3_500,
    });
  });

  test("omits unknown generation sample counts and timing", () => {
    expect(
      buildGenerationSample(
        source({
          responseId: "resp-unknown",
          outputTokens: Number.NaN,
          durationMs: 0,
        }),
      ),
    ).toEqual({ id: "pi:sess-1:response:resp-unknown" });

    expect(
      buildGenerationSample(
        source({
          responseId: "resp-negative",
          timestamp: 1_000,
          outputTokens: -3,
          durationMs: -1,
        }),
      ),
    ).toEqual({ id: "pi:sess-1:response:resp-negative" });

    expect(
      buildGenerationSample(
        source({
          responseId: "resp-duration-only",
          outputTokens: 4,
          durationMs: 80,
        }),
      ),
    ).toEqual({
      id: "pi:sess-1:response:resp-duration-only",
      outputTokens: 4,
      durationMs: 80,
    });

    expect(
      buildGenerationSample(
        source({
          responseId: "resp-zero",
          timestamp: 50,
          outputTokens: 0,
          durationMs: 10,
        }),
      ),
    ).toEqual({
      id: "pi:sess-1:response:resp-zero",
      outputTokens: 0,
      durationMs: 10,
      completedAt: 60,
    });
  });

  test("chooses a stable generation sample id", () => {
    expect(buildGenerationSample(source({ messageId: "entry-9", timestamp: 10 })).id).toBe(
      "pi:sess-1:message:entry-9",
    );
    expect(buildGenerationSample(source({ entryId: "entry-8", timestamp: 10 })).id).toBe(
      "pi:sess-1:message:entry-8",
    );
    expect(buildGenerationSample(source({ timestamp: 10, timelineId: "timeline-1" })).id).toBe(
      "pi:sess-1:timestamp:10",
    );
    expect(buildGenerationSample(source({ timelineId: "timeline-1" })).id).toBe(
      "pi:sess-1:timeline:timeline-1",
    );
    expect(buildGenerationSample(source({ completionOrdinal: 4 })).id).toBe(
      "pi:sess-1:completion:4",
    );
    expect(buildGenerationSample(source({ provider: "omp", responseId: "resp-1" })).id).toBe(
      "omp:sess-1:response:resp-1",
    );

    const repeated = source({ responseId: "resp-repeat", outputTokens: 40, durationMs: 100 });
    expect(buildGenerationSample(repeated).id).toBe(buildGenerationSample(repeated).id);
  });
});
