import type pino from "pino";

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default";
}

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const MAX_BATCH_SIZE = 100;
const CROSS_PROJECT_ERROR_CODE = "PUSH_TOO_MANY_EXPERIENCE_IDS";
const MAX_INDIVIDUAL_RETRY_CONCURRENCY = 5;
const REQUEST_TIMEOUT_MS = 30_000;

// Expo rejects a whole request that mixes projects, so recovery means one request per token.
// The daemon fires pushes concurrently and without awaiting, so the limit has to live on the
// service rather than on a single send, or overlapping sends each open their own window.
export function createConcurrencyGate(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= limit) {
      // The waiter inherits the permit of whoever woke it, so it must not take one itself.
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      active++;
    }
    try {
      return await task();
    } finally {
      // Hand the permit straight to the next waiter. Releasing it first would expose a free
      // slot that a caller arriving before the waiter resumes could take, putting both over
      // the limit.
      const next = waiting.shift();
      if (next) {
        next();
      } else {
        active--;
      }
    }
  };
}

function parseExpoPushApiErrorCodes(body: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null || !("errors" in parsed)) {
      return null;
    }
    if (!Array.isArray(parsed.errors)) {
      return null;
    }
    const codes: string[] = [];
    for (const item of parsed.errors) {
      if (
        typeof item === "object" &&
        item !== null &&
        "code" in item &&
        typeof item.code === "string"
      ) {
        codes.push(item.code);
      }
    }
    return codes.length > 0 ? codes : null;
  } catch {
    return null;
  }
}

/**
 * Service for sending Expo push notifications.
 * Handles batching and invalid token removal.
 */
export class PushService {
  private readonly logger: pino.Logger;
  private readonly revokeToken: (token: string) => void;
  private readonly retryGate = createConcurrencyGate(MAX_INDIVIDUAL_RETRY_CONCURRENCY);

  constructor(logger: pino.Logger, revokeToken: (token: string) => void) {
    this.logger = logger.child({ component: "push-service" });
    this.revokeToken = revokeToken;
  }

  async sendPush(tokens: string[], payload: PushPayload): Promise<void> {
    if (tokens.length === 0) {
      return;
    }

    const messages: ExpoPushMessage[] = tokens.map((token) => ({
      to: token,
      title: payload.title,
      body: payload.body,
      data: payload.data,
      sound: "default",
    }));

    // Batch tokens (max 100 per request per Expo limits)
    const batches: ExpoPushMessage[][] = [];
    for (let i = 0; i < messages.length; i += MAX_BATCH_SIZE) {
      batches.push(messages.slice(i, i + MAX_BATCH_SIZE));
    }

    await Promise.all(batches.map((batch) => this.sendBatch(batch)));
  }

  private async sendBatch(messages: ExpoPushMessage[]): Promise<void> {
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(messages),
        // Without this a stalled request holds its retry permit until undici's own timeouts
        // fire, and five of them starve every later retry.
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const errorCodes = parseExpoPushApiErrorCodes(body);
        this.logger.error(
          {
            status: response.status,
            statusText: response.statusText,
            ...(errorCodes ? { errorCodes } : {}),
          },
          "Expo push API error",
        );
        // Expo rejects an entire request whose messages span more than one Expo project,
        // which happens once a device has both an upstream and a fork build installed.
        // Tokens carry no project id, so retrying one per request is the only recovery.
        if (messages.length > 1 && errorCodes?.includes(CROSS_PROJECT_ERROR_CODE)) {
          await this.sendIndividualRetries(messages);
        }
        return;
      }

      const result = (await response.json()) as { data: ExpoPushTicket[] };
      this.handleTickets(messages, result.data);
    } catch (error) {
      this.logger.error({ err: error }, "Failed to send push notifications");
    }
  }

  private async sendIndividualRetries(messages: ExpoPushMessage[]): Promise<void> {
    await Promise.all(messages.map((message) => this.retryGate(() => this.sendBatch([message]))));
  }

  private handleTickets(messages: ExpoPushMessage[], tickets: ExpoPushTicket[]): void {
    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      const message = messages[i];

      if (ticket.status === "error") {
        this.logger.error(
          {
            tokenSuffix: message.to.slice(-6),
            ...(ticket.details?.error ? { errorCode: ticket.details.error } : {}),
          },
          "Push failed for token",
        );

        // Remove invalid tokens
        if (
          ticket.details?.error === "DeviceNotRegistered" ||
          ticket.details?.error === "InvalidCredentials"
        ) {
          this.revokeToken(message.to);
        }
      }
    }
  }
}
