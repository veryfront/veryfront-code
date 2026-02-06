import { readTextFile } from "#veryfront/platform/compat/fs.ts";
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

export const AI_TOOLS: AITool[] = AI_TOOLS_RAW.map((tool) => AIToolSchema.parse(tool));

export function getAllToolIds(): AIToolId[] {
  return AI_TOOLS.map(({ id }) => id);
}

export function getToolById(id: string): AITool {
  const toolId = AIToolIdSchema.parse(id);
  const tool = AI_TOOLS.find((t) => t.id === toolId);

  if (!tool) throw new Error(`Tool not found: ${id}`);

  return tool;
}

export function isValidToolId(id: string): id is AIToolId {
  return AIToolIdSchema.safeParse(id).success;
}

export function getTemplateContent(toolId: string): Promise<string> {
  const { template } = getToolById(toolId);
  const templatePath = new URL(`../../templates/ai-rules/${template}`, import.meta.url).pathname;
  return readTextFile(templatePath);
}
