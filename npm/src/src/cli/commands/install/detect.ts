/**
 * AI Tool Detection - Detects which AI coding tools are in use
 */

import { join } from "../../../platform/compat/path/index.js";
import { cwd as getCwd } from "../../../platform/compat/process.js";
import { exists } from "../../../platform/compat/fs.js";
import { type AIToolId, type DetectOptions, DetectOptionsSchema } from "./types.js";
import { getRuntimeEnv, type RuntimeEnv } from "../../../config/runtime-env.js";

function createDetectionRules(
  env: RuntimeEnv,
): Record<AIToolId, (cwd: string) => Promise<boolean>> {
  return {
    cursor: async (cwd) => (await exists(join(cwd, ".cursor"))) || Boolean(env.cursorSession),
    "claude-code": async (cwd) => await exists(join(cwd, ".claude")),
    skill: (_cwd) => Promise.resolve(true), // Always suggest - universal format
    copilot: async (cwd) => await exists(join(cwd, ".github")),
    windsurf: async (cwd) => await exists(join(cwd, ".windsurfrules")),
    agents: (_cwd) => Promise.resolve(false), // Don't auto-detect
  };
}

export async function detectAITools(
  options: DetectOptions = {},
  env: RuntimeEnv = getRuntimeEnv(),
): Promise<AIToolId[]> {
  const { cwd = getCwd() } = DetectOptionsSchema.parse(options);
  const rules = createDetectionRules(env);
  const detected: AIToolId[] = [];

  for (const toolId of Object.keys(rules) as AIToolId[]) {
    if (await rules[toolId](cwd)) detected.push(toolId);
  }

  return detected;
}

export function formatDetectionHint(detected: AIToolId[]): string {
  const meaningful = detected.filter((id) => id !== "skill");
  if (meaningful.length === 0) return "No AI tools detected - select the ones you use";

  const names: Partial<Record<AIToolId, string>> = {
    cursor: "Cursor",
    "claude-code": "Claude Code",
    copilot: "GitHub Copilot",
    windsurf: "Windsurf",
  };

  return `Auto-detected ${meaningful.map((id) => names[id] ?? id).join(", ")} from project`;
}
