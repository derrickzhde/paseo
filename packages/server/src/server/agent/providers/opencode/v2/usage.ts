import type { ModelRef, OpenCodeEvent, SessionInfo, TokenUsageInfo } from "@opencode/client";
import type {
  AgentGenerationSample,
  AgentStreamEvent,
  AgentUsageSample,
} from "../../../agent-sdk-types.js";
import type { V2Api } from "./api.js";
import { generationSampleFromV2, usageFromV2, usageSampleFromV2 } from "./mapping.js";

interface UsageOptions {
  client(): V2Api;
  cwd: string;
  info(): SessionInfo;
  emit(event: AgentStreamEvent): void;
  reportError(error: unknown): void;
}

// A step is one model call, so its tokens are the context that call used.
function contextWindowUsedTokens(tokens: TokenUsageInfo) {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
}

interface StepTiming {
  started?: number;
  streamed?: number;
}

export class SessionUsage {
  private readonly limits = new Map<string, Promise<number | undefined>>();
  private readonly stepTiming = new Map<string, StepTiming>();
  private reports: Promise<void> = Promise.resolve();
  constructor(private readonly options: UsageOptions) {}
  observe(event: OpenCodeEvent) {
    if (
      event.type !== "session.step.started" &&
      event.type !== "session.step.streamed" &&
      event.type !== "session.step.ended" &&
      event.type !== "session.step.failed"
    ) {
      return;
    }
    if (event.data.sessionID !== this.options.info().id) return;
    if (event.type === "session.step.started") {
      this.stepTiming.set(event.data.assistantMessageID, { started: event.data.started });
      return;
    }
    if (event.type === "session.step.streamed") {
      const timing = this.stepTiming.get(event.data.assistantMessageID) ?? {};
      this.stepTiming.set(event.data.assistantMessageID, { ...timing, streamed: event.created });
      return;
    }
    // Snapshot before the catalog lookup. A later step.started for this response resets timing.
    const generationSample = generationSampleFromV2(
      event,
      this.stepTiming.get(event.data.assistantMessageID),
    );
    const usageSample = usageSampleFromV2(event);
    const tokens = event.data.tokens;
    // Reports stay in step order while a model's context limit is still being looked up.
    this.reports = this.reports
      .then(() => this.report(tokens, usageSample, generationSample))
      .catch((error: unknown) => this.options.reportError(error));
  }
  private async report(
    tokens: TokenUsageInfo | undefined,
    usageSample: AgentUsageSample | undefined,
    generationSample: AgentGenerationSample,
  ) {
    const info = this.options.info();
    const model = info.model;
    const contextWindowMaxTokens = tokens && model ? await this.contextLimit(model) : undefined;
    this.options.emit({
      type: "usage_updated",
      provider: "opencode",
      usage: {
        ...usageFromV2(info),
        ...(tokens ? { contextWindowUsedTokens: contextWindowUsedTokens(tokens) } : {}),
        ...(contextWindowMaxTokens === undefined ? {} : { contextWindowMaxTokens }),
      },
      ...(usageSample ? { usageSample } : {}),
      generationSample,
    });
  }
  private contextLimit(model: ModelRef) {
    const key = `${model.providerID}/${model.id}`;
    const cached = this.limits.get(key);
    if (cached) return cached;
    const limit = this.options
      .client()
      .model.list({ location: { directory: this.options.cwd } })
      .then(
        (catalog) =>
          catalog.data.find(
            (entry) => entry.providerID === model.providerID && entry.id === model.id,
          )?.limit.context,
      );
    this.limits.set(key, limit);
    limit.catch(() => this.limits.delete(key));
    return limit;
  }
}
