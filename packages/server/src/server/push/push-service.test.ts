import type pino from "pino";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createConcurrencyGate, PushService } from "./push-service.js";

function createLogger(): pino.Logger {
  const errors: unknown[][] = [];
  const logger = {
    child: () => logger,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (...args: unknown[]) => {
      errors.push(args);
    },
    errors,
  };
  return logger as unknown as pino.Logger;
}

function loggedErrors(logger: pino.Logger): unknown[][] {
  return (logger as unknown as { errors: unknown[][] }).errors;
}

const CROSS_PROJECT_BODY = JSON.stringify({
  errors: [
    {
      code: "PUSH_TOO_MANY_EXPERIENCE_IDS",
      message: "All push notification messages in the same request must be for the same project",
    },
  ],
});

function okTickets(count: number): string {
  return JSON.stringify({ data: Array.from({ length: count }, () => ({ status: "ok" })) });
}

interface SentRequest {
  tokens: string[];
}

function stubFetch(respond: (request: SentRequest) => Response): SentRequest[] {
  const sent: SentRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      const messages = JSON.parse(init.body) as { to: string }[];
      const request = { tokens: messages.map((message) => message.to) };
      sent.push(request);
      return respond(request);
    }),
  );
  return sent;
}

function flushMicrotasks(): Promise<void> {
  return Promise.resolve();
}

async function flushUntil(condition: () => boolean, maxPasses = 20): Promise<void> {
  for (let pass = 0; pass < maxPasses && !condition(); pass++) {
    await flushMicrotasks();
  }
}

interface ControlledConcurrencyFetchState {
  fetchCount: number;
  activeFetches: number;
  maxConcurrent: number;
  pendingIndividuals: Array<(response: Response) => void>;
}

function createControlledConcurrencyFetchState(): ControlledConcurrencyFetchState {
  return {
    fetchCount: 0,
    activeFetches: 0,
    maxConcurrent: 0,
    pendingIndividuals: [],
  };
}

function registerPendingIndividualResponse(
  state: ControlledConcurrencyFetchState,
  resolve: (response: Response) => void,
): void {
  state.pendingIndividuals.push((response) => {
    state.activeFetches--;
    resolve(response);
  });
}

function respondWithControlledConcurrency(
  state: ControlledConcurrencyFetchState,
  init: { body: string },
): Promise<Response> {
  state.fetchCount++;
  state.activeFetches++;
  state.maxConcurrent = Math.max(state.maxConcurrent, state.activeFetches);

  const messages = JSON.parse(init.body) as { to: string }[];
  if (messages.length > 1) {
    state.activeFetches--;
    return Promise.resolve(new Response(CROSS_PROJECT_BODY, { status: 400 }));
  }

  return new Promise<Response>((resolve) => registerPendingIndividualResponse(state, resolve));
}

function stubControlledConcurrencyFetch(): ControlledConcurrencyFetchState {
  const state = createControlledConcurrencyFetchState();
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: { body: string }) => respondWithControlledConcurrency(state, init)),
  );
  return state;
}

function resolveIndividualResponses(
  pendingIndividuals: Array<(response: Response) => void>,
  count: number,
): void {
  const waveResolvers = pendingIndividuals.splice(0, count);
  for (const resolve of waveResolvers) {
    resolve(new Response(okTickets(1), { status: 200 }));
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("createConcurrencyGate", () => {
  test("holds the limit when a caller arrives before a woken waiter resumes", async () => {
    const gate = createConcurrencyGate(1);
    let running = 0;
    let maxRunning = 0;
    const track = async (hold: Promise<void>) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await hold;
      running--;
    };

    const first = deferred();
    const second = deferred();
    const third = deferred();
    const firstRun = gate(() => track(first.promise));
    const waiterRun = gate(() => track(second.promise));

    first.resolve();
    // Two microtask hops land the next caller after the permit is released and before the
    // woken waiter resumes — the window where a release-then-signal gate goes over its limit.
    await Promise.resolve();
    await Promise.resolve();
    const lateRun = gate(() => track(third.promise));

    await flushUntil(() => maxRunning > 1);
    expect(maxRunning).toBe(1);

    second.resolve();
    third.resolve();
    await Promise.all([firstRun, waiterRun, lateRun]);
    expect(maxRunning).toBe(1);
  });
});

describe("PushService request timeouts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("gives every request an abort signal so a stall cannot hold its retry permit", async () => {
    const seen: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { signal?: unknown }) => {
        seen.push(init.signal);
        return new Response(okTickets(1), { status: 200 });
      }),
    );
    const service = new PushService(createLogger(), () => undefined);

    await service.sendPush(["ExponentPushToken[a]"], { title: "t", body: "b" });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(AbortSignal);
  });
});

describe("PushService cross-project batches", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Expo rejects the whole request when its tokens span two Expo projects, which is what a
  // device with both an upstream and a fork build installed produces. Without the retry a
  // single foreign token silences every other device.
  test("retries one token per request when Expo rejects a mixed-project batch", async () => {
    const sent = stubFetch((request) =>
      request.tokens.length > 1
        ? new Response(CROSS_PROJECT_BODY, { status: 400 })
        : new Response(okTickets(1), { status: 200 }),
    );
    const service = new PushService(createLogger(), () => undefined);

    await service.sendPush(["ExponentPushToken[upstream]", "ExponentPushToken[fork]"], {
      title: "t",
      body: "b",
    });

    expect(sent).toEqual([
      { tokens: ["ExponentPushToken[upstream]", "ExponentPushToken[fork]"] },
      { tokens: ["ExponentPushToken[upstream]"] },
      { tokens: ["ExponentPushToken[fork]"] },
    ]);
  });

  test("revokes a dead token surfaced only by the per-token retry", async () => {
    stubFetch((request) => {
      if (request.tokens.length > 1) {
        return new Response(CROSS_PROJECT_BODY, { status: 400 });
      }
      if (request.tokens[0] === "ExponentPushToken[dead]") {
        return new Response(
          JSON.stringify({
            data: [{ status: "error", message: "gone", details: { error: "DeviceNotRegistered" } }],
          }),
          { status: 200 },
        );
      }
      return new Response(okTickets(1), { status: 200 });
    });
    const revoked: string[] = [];
    const service = new PushService(createLogger(), (token) => revoked.push(token));

    await service.sendPush(["ExponentPushToken[dead]", "ExponentPushToken[fork]"], {
      title: "t",
      body: "b",
    });

    expect(revoked).toEqual(["ExponentPushToken[dead]"]);
  });

  // Splitting on every failure would multiply requests against an outage.
  test("does not split when the rejection is unrelated to project mixing", async () => {
    const sent = stubFetch(() => new Response("upstream is down", { status: 503 }));
    const service = new PushService(createLogger(), () => undefined);

    await service.sendPush(["ExponentPushToken[a]", "ExponentPushToken[b]"], {
      title: "t",
      body: "b",
    });

    expect(sent).toHaveLength(1);
  });

  test("sends a single request when every token shares a project", async () => {
    const sent = stubFetch(() => new Response(okTickets(2), { status: 200 }));
    const service = new PushService(createLogger(), () => undefined);

    await service.sendPush(["ExponentPushToken[a]", "ExponentPushToken[b]"], {
      title: "t",
      body: "b",
    });

    expect(sent).toHaveLength(1);
  });

  test("limits individual retry concurrency to 5 for a 100-token cross-project batch", async () => {
    const harness = stubControlledConcurrencyFetch();
    const logger = createLogger();

    const tokens = Array.from({ length: 100 }, (_, index) => `ExponentPushToken[token-${index}]`);
    const service = new PushService(logger, () => undefined);
    const sendPromise = service.sendPush(tokens, { title: "t", body: "b" });

    await flushUntil(() => harness.pendingIndividuals.length === 5);
    expect(harness.pendingIndividuals).toHaveLength(5);
    expect(harness.maxConcurrent).toBeLessThanOrEqual(5);

    for (let wave = 0; wave < 20; wave++) {
      resolveIndividualResponses(harness.pendingIndividuals, 5);
      if (wave < 19) {
        await flushUntil(() => harness.pendingIndividuals.length === 5);
        expect(harness.maxConcurrent).toBeLessThanOrEqual(5);
      }
    }

    await sendPromise;
    expect(harness.fetchCount).toBe(101);
    expect(harness.maxConcurrent).toBeLessThanOrEqual(5);
    expect(
      loggedErrors(logger).find((args) => args[1] === "Failed to send push notifications"),
    ).toBeUndefined();
  });

  test("shares one retry budget across cross-project batches instead of one per batch", async () => {
    const harness = stubControlledConcurrencyFetch();
    const logger = createLogger();

    // 250 tokens split into three batches. Each batch fails cross-project on its own, so a
    // per-batch bound would allow three concurrent waves of five.
    const tokens = Array.from({ length: 250 }, (_, index) => `ExponentPushToken[token-${index}]`);
    const service = new PushService(logger, () => undefined);
    const sendPromise = service.sendPush(tokens, { title: "t", body: "b" });

    await flushUntil(() => harness.pendingIndividuals.length === 5);
    expect(harness.pendingIndividuals).toHaveLength(5);
    expect(harness.maxConcurrent).toBe(5);

    for (let wave = 0; wave < 50; wave++) {
      resolveIndividualResponses(harness.pendingIndividuals, 5);
      if (wave < 49) {
        await flushUntil(() => harness.pendingIndividuals.length === 5);
        expect(harness.maxConcurrent).toBe(5);
      }
    }

    await sendPromise;
    expect(harness.fetchCount).toBe(253);
    expect(harness.maxConcurrent).toBe(5);
    expect(
      loggedErrors(logger).find((args) => args[1] === "Failed to send push notifications"),
    ).toBeUndefined();
  });

  test("shares one retry budget across overlapping sends", async () => {
    const harness = stubControlledConcurrencyFetch();
    const logger = createLogger();

    // The daemon fires pushes without awaiting them, so two sends can overlap. A per-send
    // bound would allow each of them five concurrent retries.
    const service = new PushService(logger, () => undefined);
    const batchOf = (prefix: string) =>
      Array.from({ length: 100 }, (_, index) => `ExponentPushToken[${prefix}-${index}]`);
    const sendPromises = Promise.all([
      service.sendPush(batchOf("a"), { title: "t", body: "b" }),
      service.sendPush(batchOf("b"), { title: "t", body: "b" }),
    ]);

    await flushUntil(() => harness.pendingIndividuals.length === 5);
    expect(harness.pendingIndividuals).toHaveLength(5);
    expect(harness.maxConcurrent).toBe(5);

    for (let wave = 0; wave < 40; wave++) {
      resolveIndividualResponses(harness.pendingIndividuals, 5);
      if (wave < 39) {
        await flushUntil(() => harness.pendingIndividuals.length === 5);
        expect(harness.maxConcurrent).toBe(5);
      }
    }

    await sendPromises;
    expect(harness.fetchCount).toBe(202);
    expect(harness.maxConcurrent).toBe(5);
  });
});

describe("PushService API error logs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("redacts sensitive fields from non-2xx API error logs", async () => {
    const token = "ExponentPushToken[secretTOKEN123456]";
    const experienceId = "@owner/example-app";
    const errorBody = JSON.stringify({
      errors: [
        {
          code: "VALIDATION_ERROR",
          message: `Invalid token ${token}`,
          details: { expoExperienceId: experienceId },
        },
      ],
    });
    stubFetch(() => new Response(errorBody, { status: 400 }));
    const logger = createLogger();
    const service = new PushService(logger, () => undefined);

    await service.sendPush([token], { title: "t", body: "b" });

    const apiError = loggedErrors(logger).find((args) => args[1] === "Expo push API error");
    expect(apiError).toBeDefined();
    const serialized = JSON.stringify(apiError);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain("Invalid token");
    expect(serialized).not.toContain(experienceId);
    expect(serialized).not.toContain("details");
    expect(serialized).not.toContain("message");
    expect(apiError?.[0]).toMatchObject({
      status: 400,
      errorCodes: ["VALIDATION_ERROR"],
    });
  });

  test("logs only status fields when a non-2xx body has no error codes", async () => {
    const errorBody = JSON.stringify({
      errors: [{ message: "upstream unavailable", details: { reason: "maintenance" } }],
    });
    stubFetch(() => new Response(errorBody, { status: 503, statusText: "Service Unavailable" }));
    const logger = createLogger();
    const service = new PushService(logger, () => undefined);

    await service.sendPush(["ExponentPushToken[a]"], { title: "t", body: "b" });

    const apiError = loggedErrors(logger).find((args) => args[1] === "Expo push API error");
    expect(apiError).toBeDefined();
    const serialized = JSON.stringify(apiError);
    expect(serialized).not.toContain("upstream unavailable");
    expect(serialized).not.toContain("maintenance");
    expect(serialized).not.toContain("details");
    expect(serialized).not.toContain("message");
    expect(apiError?.[0]).toEqual({
      status: 503,
      statusText: "Service Unavailable",
    });
  });
});

describe("PushService ticket failure logs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("redacts the full token from a ticket-failure log", async () => {
    const token = "ExponentPushToken[secretTOKEN123456]";
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            data: [
              {
                status: "error",
                message: `"${token}" is not a valid Expo push token`,
                details: { error: "DeviceNotRegistered", expoPushToken: token },
              },
            ],
          }),
          { status: 200 },
        ),
    );
    const logger = createLogger();
    const service = new PushService(logger, () => undefined);

    await service.sendPush([token], { title: "t", body: "b" });

    const ticketFailure = loggedErrors(logger).find((args) => args[1] === "Push failed for token");
    expect(ticketFailure).toBeDefined();
    expect(JSON.stringify(ticketFailure)).not.toContain(token);
    expect(ticketFailure?.[0]).toMatchObject({ tokenSuffix: token.slice(-6) });
  });
});
