/**
 * AI Tool Detection - Detects which AI coding tools are in use
 */

import { join } from "#veryfront/platform/compat/path/index.ts";
import { cwd as getCwd } from "#veryfront/platform/compat/process.ts";
import { exists } from "#veryfront/platform/compat/fs.ts";
import { type AIToolId, type DetectOptions, DetectOptionsSchema } from "./types.ts";
import { getRuntimeEnv, type RuntimeEnv } from "#veryfront/config/runtime-env.ts";

function createDetectionRules(
  env: RuntimeEnv,
): Record<AIToolId, (cwd: string) => Promise<boolean>> {
  return {
    cursor: async (cwd) => await exists(join(cwd, ".cursor")) || Boolean(env.cursorSession),
    "claude-code": async (cwd) => await exists(join(cwd, ".claude")),
    skill: () => Promise.resolve(true), // Always suggest - universal format
    copilot: async (cwd) => await exists(join(cwd, ".github")),
    windsurf: async (cwd) => await exists(join(cwd, ".windsurfrules")),
    agents: () => Promise.resolve(false), // Don't auto-detect
  };
}

export async function detectAITools(
  options: DetectOptions = {},
  env: RuntimeEnv = getRuntimeEnv(),
): Promise<AIToolId[]> {
  const { cwd = getCwd() } = DetectOptionsSchema.parse(options);
  const detected: AIToolId[] = [];
  const rules = createDetectionRules(env);

  for (const [toolId, detect] of Object.entries(rules)) {
    if (await detect(cwd)) {
      detected.push(toolId as AIToolId);
    }
  }

  return detected;
}

export function formatDetectionHint(detected: AIToolId[]): string {
  const meaningful = detected.filter((id) => id !== "skill");
  if (meaningful.length === 0) return "No AI tools detected - select the ones you use";

  const names: Record<string, string> = {
    cursor: "Cursor",
    "claude-code": "Claude Code",
    copilot: "GitHub Copilot",
    windsurf: "Windsurf",
  };

  return `Auto-detected ${meaningful.map((id) => names[id] ?? id).join(", ")} from project`;
}
