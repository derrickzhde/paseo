import { z } from "zod";
import type { AgentModelDefinition } from "../../agent-sdk-types.js";
import { getClaudeManifestModels, normalizeClaudeManifestModelId } from "./model-manifest.js";

export const CLAUDE_API_ORIGIN = "https://api.anthropic.com";

export interface ClaudeModelApiConfig {
  baseUrl: string;
  authHeaders: Record<string, string>;
}

const modelPageSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      display_name: z.string().nullish(),
      name: z.string().nullish(),
      max_input_tokens: z.number().int().nonnegative().nullish(),
    }),
  ),
  has_more: z.boolean().optional(),
  last_id: z.string().nullish(),
});

function claudeModelsUrl(baseUrl: string): URL {
  const url = new URL(baseUrl);
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    throw new Error("Invalid Claude API base URL");
  }
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath.endsWith("/v1") ? basePath : `${basePath}/v1`}/models`;
  url.hash = "";
  if (url.origin === CLAUDE_API_ORIGIN) {
    url.searchParams.set("limit", "100");
  }
  return url;
}

export async function fetchClaudeApiModels(
  { baseUrl, authHeaders }: ClaudeModelApiConfig,
  claudeCodeVersion: string | undefined,
  refreshSignal?: AbortSignal,
): Promise<AgentModelDefinition[]> {
  const url = claudeModelsUrl(baseUrl);
  const deadline = AbortSignal.timeout(5_000);
  const signal = refreshSignal ? AbortSignal.any([refreshSignal, deadline]) : deadline;
  const manifest = new Map(
    getClaudeManifestModels(claudeCodeVersion).map((model) => [model.id, model]),
  );
  const models = new Map<string, AgentModelDefinition>();
  const cursors = new Set<string>();

  for (;;) {
    const response = await fetch(url.toString(), {
      headers: { ...authHeaders, "anthropic-version": "2023-06-01" },
      redirect: "error",
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Claude Models API returned HTTP ${response.status}`);
    }
    const page = modelPageSchema.parse(await response.json());
    for (const { id, display_name, name, max_input_tokens } of page.data) {
      if (models.has(id)) continue;
      const knownModel = manifest.get(normalizeClaudeManifestModelId(id) ?? id);
      models.set(id, {
        provider: "claude",
        id,
        label: display_name?.trim() || name?.trim() || id,
        ...(models.size === 0 ? { isDefault: true } : {}),
        ...(max_input_tokens ? { contextWindowMaxTokens: max_input_tokens } : {}),
        ...(knownModel?.thinkingOptions
          ? {
              thinkingOptions: knownModel.thinkingOptions,
              defaultThinkingOptionId: knownModel.defaultThinkingOptionId,
            }
          : {}),
      });
    }
    if (!page.has_more) return [...models.values()];
    const cursor = page.last_id;
    if (!cursor || cursors.has(cursor)) {
      throw new Error("Claude Models API returned an invalid pagination cursor");
    }
    cursors.add(cursor);
    url.searchParams.set("after_id", cursor);
  }
}
