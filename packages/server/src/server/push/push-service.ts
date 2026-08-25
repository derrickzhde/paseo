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

interface ExpoPushApiError {
  code?: string;
  message?: string;
}

function parseExpoPushApiErrors(body: string): ExpoPushApiError[] | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null || !("errors" in parsed)) {
      return null;
    }
    if (!Array.isArray(parsed.errors)) {
      return null;
    }
    return parsed.errors.map((item) => {
      const error: ExpoPushApiError = {};
      if (typeof item !== "object" || item === null) {
        return error;
      }
      if ("code" in item && typeof item.code === "string") {
        error.code = item.code;
      }
      if ("message" in item && typeof item.message === "string") {
        error.message = item.message;
      }
      return error;
    });
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
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const errors = parseExpoPushApiErrors(body);
        this.logger.error(
          {
            status: response.status,
            statusText: response.statusText,
            ...(errors ? { errors } : {}),
          },
          "Expo push API error",
        );
        // Expo rejects an entire request whose messages span more than one Expo project,
        // which happens once a device has both an upstream and a fork build installed.
        // Tokens carry no project id, so retrying one per request is the only recovery.
        if (
          messages.length > 1 &&
          errors?.some((error) => error.code === CROSS_PROJECT_ERROR_CODE)
        ) {
          await Promise.all(messages.map((message) => this.sendBatch([message])));
        }
        return;
      }

      const result = (await response.json()) as { data: ExpoPushTicket[] };
      this.handleTickets(messages, result.data);
    } catch (error) {
      this.logger.error({ err: error }, "Failed to send push notifications");
    }
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
