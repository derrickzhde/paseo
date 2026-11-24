import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = import.meta.dirname;
const marker = "readonly reportsUpstreamCacheHit = true";

const covered = [
  "providers/claude/agent.ts",
  "providers/pi/agent.ts",
  "providers/omp/agent.ts",
  "providers/opencode/v2/session.ts",
];

const uncovered = [
  "providers/codex-app-server-agent.ts",
  "providers/opencode-agent.ts",
  "providers/acp-agent.ts",
  "providers/copilot-acp-agent.ts",
  "providers/cursor-acp-agent.ts",
  "providers/kimi-acp-agent.ts",
  "providers/kiro-acp-agent.ts",
  "providers/trae-acp-agent.ts",
  "plugin-provider.ts",
];

function source(file: string): string {
  return readFileSync(path.join(root, file), "utf8");
}

describe("upstream cache-hit sessions", () => {
  it.each(covered)("%s publishes upstream cache hit", (file) => {
    expect(source(file)).toContain(marker);
  });

  it.each(uncovered)("%s keeps the fork cache hit", (file) => {
    expect(source(file)).not.toContain(marker);
  });
});
