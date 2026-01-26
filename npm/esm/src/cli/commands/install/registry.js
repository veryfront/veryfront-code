import { readTextFile } from "../../../platform/compat/fs.js";
import { AIToolIdSchema, AIToolSchema } from "./types.js";
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
];
export const AI_TOOLS = AI_TOOLS_RAW.map((tool) => AIToolSchema.parse(tool));
export function getAllToolIds() {
    return AI_TOOLS.map((tool) => tool.id);
}
export function getToolById(id) {
    const toolId = AIToolIdSchema.parse(id);
    const tool = AI_TOOLS.find((t) => t.id === toolId);
    if (tool)
        return tool;
    throw new Error(`Tool not found: ${id}`);
}
export function isValidToolId(id) {
    return AIToolIdSchema.safeParse(id).success;
}
export function getTemplateContent(toolId) {
    const { template } = getToolById(toolId);
    const templatePath = new URL(`../../templates/ai-rules/${template}`, globalThis[Symbol.for("import-meta-ponyfill-esmodule")](import.meta).url).pathname;
    return readTextFile(templatePath);
}
