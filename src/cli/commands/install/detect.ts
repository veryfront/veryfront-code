/**
 * AI Tool Detection - Detects which AI coding tools are in use
 */

import { join } from "@veryfront/platform/compat/path/index.ts";
import { cwd as getCwd } from "@veryfront/platform/compat/process.ts";
import { type AIToolId, type DetectOptions, DetectOptionsSchema } from "./types.ts";

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

const DETECTION_RULES: Record<AIToolId, (cwd: string) => Promise<boolean>> = {
  cursor: async (cwd) =>
    await exists(join(cwd, ".cursor")) || Boolean(Deno.env.get("CURSOR_SESSION")),
  "claude-code": async (cwd) => await exists(join(cwd, ".claude")),
  skill: () => Promise.resolve(true), // Always suggest - universal format
  copilot: async (cwd) => await exists(join(cwd, ".github")),
  windsurf: async (cwd) => await exists(join(cwd, ".windsurfrules")),
  agents: () => Promise.resolve(false), // Don't auto-detect
};

export async function detectAITools(options: DetectOptions = {}): Promise<AIToolId[]> {
  const { cwd = getCwd() } = DetectOptionsSchema.parse(options);
  const detected: AIToolId[] = [];

  for (const [toolId, detect] of Object.entries(DETECTION_RULES)) {
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
