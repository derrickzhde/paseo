import { describe, expect, test } from "vitest";

import { buildGenerationSample, type GenerationSampleSource } from "./generation-sample.js";

function source(overrides: Partial<GenerationSampleSource> = {}): GenerationSampleSource {
  return {
    provider: "pi",
    sessionId: "sess-1",
    completionOrdinal: 1,
    ...overrides,
  };
}

describe("generation samples", () => {
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
