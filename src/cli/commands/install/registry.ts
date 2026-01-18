/**
 * AI Tool Registry - Single source of truth for supported AI coding tools
 * To add a new IDE: just add an entry to AI_TOOLS array
 */

import { readTextFile } from "@veryfront/platform/compat/fs.ts";
import { type AITool, type AIToolId, AIToolIdSchema, AIToolSchema } from "./types.ts";

const AI_TOOLS_RAW = [
  {
    id: "cursor",
    label: "Cursor",
    file: ".cursorrules",
    description: ".cursorrules",
    template: "cursor.md",
  },
  {
    id: "claude-code",
    label: "Claude Code",
    file: ".claude/CLAUDE.md",
    description: ".claude/CLAUDE.md",
    template: "claude-code.md",
  },
  {
    id: "skill",
    label: "Agent Skills",
    file: "SKILL.md",
    description: "SKILL.md (open standard)",
    template: "skill.md",
  },
  {
    id: "copilot",
    label: "GitHub Copilot",
    file: ".github/copilot-instructions.md",
    description: ".github/copilot-instructions.md",
    template: "copilot.md",
  },
  {
    id: "windsurf",
    label: "Windsurf",
    file: ".windsurfrules",
    description: ".windsurfrules",
    template: "windsurf.md",
  },
  {
    id: "agents",
    label: "Codex / Gemini CLI",
    file: "AGENTS.md",
    description: "AGENTS.md",
    template: "agents.md",
  },
] as const;

// Validate all tools at module load - fail fast if registry is misconfigured
export const AI_TOOLS: AITool[] = AI_TOOLS_RAW.map((tool) => AIToolSchema.parse(tool));

export function getAllToolIds(): AIToolId[] {
  return AI_TOOLS.map((t) => t.id);
}

export function getToolById(id: string): AITool {
  const parsed = AIToolIdSchema.parse(id);
  const tool = AI_TOOLS.find((t) => t.id === parsed);
  if (!tool) throw new Error(`Tool not found: ${id}`);
  return tool;
}

export function isValidToolId(id: string): id is AIToolId {
  return AIToolIdSchema.safeParse(id).success;
}

export async function getTemplateContent(toolId: string): Promise<string> {
  const tool = getToolById(toolId);
  const templatePath =
    new URL(`../../templates/ai-rules/${tool.template}`, import.meta.url).pathname;
  return await readTextFile(templatePath);
}
