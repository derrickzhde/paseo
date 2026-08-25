import type pino from "pino";
import { afterEach, describe, expect, test, vi } from "vitest";

import { PushService } from "./push-service.js";

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
