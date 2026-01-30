/**
 * MCP tools for skill discovery and reference loading.
 */
import { z } from "zod";
import { join } from "../../../platform/compat/path/index.js";
import { cwd } from "../../../platform/compat/process.js";
import { withSpan } from "../../../observability/tracing/otlp-setup.js";
import { directoryExists, fileExists, formatError, getFs } from "./helpers.js";
// ============================================================================
// Skill Parsing Helpers
// ============================================================================
function parseSkillFrontmatter(content) {
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match)
        return { metadata: {}, body: content };
    const [, yamlContent = "", body = ""] = match;
    const metadata = {};
    for (const line of yamlContent.split("\n")) {
        const colonIndex = line.indexOf(":");
        if (colonIndex === -1)
            continue;
        const key = line.slice(0, colonIndex).trim();
        let value = line.slice(colonIndex + 1).trim();
        if (typeof value === "string" && value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1);
        }
        metadata[key] = value;
    }
    return { metadata, body: body.trim() };
}
function getSkillsDir() {
    return join(cwd(), "src/cli/mcp/skills");
}
function parseToolsFromMetadata(metadata) {
    const metadataObj = metadata.metadata;
    if (!metadataObj?.tools)
        return undefined;
    return String(metadataObj.tools).split(",").map((t) => t.trim());
}
// ============================================================================
// Tool: vf_get_skills
// ============================================================================
const getSkillsInput = z.object({
    name: z.string().optional().describe("Specific skill name to get full content for (omit for list of all skills)"),
});
export const vfGetSkills = {
    name: "vf_get_skills",
    description: "Discover available Agent Skills for Veryfront development. Skills provide procedural knowledge for using MCP tools effectively. Call without name param to list all skills, or with name to get full skill content.",
    inputSchema: getSkillsInput,
    execute: (input) => withSpan("cli.mcp.tool.vf_get_skills", async () => {
        const fs = getFs();
        const skillsDir = getSkillsDir();
        try {
            if (input.name) {
                const skillPath = join(skillsDir, input.name, "SKILL.md");
                const content = await fs.readTextFile(skillPath);
                const { metadata, body } = parseSkillFrontmatter(content);
                const references = [];
                const refsDir = join(skillsDir, input.name, "references");
                if (await directoryExists(refsDir)) {
                    for await (const entry of fs.readDir(refsDir)) {
                        if (entry.isFile && entry.name.endsWith(".md")) {
                            references.push(`references/${entry.name}`);
                        }
                    }
                }
                const tools = parseToolsFromMetadata(metadata);
                return {
                    skill: {
                        name: String(metadata.name || input.name),
                        description: String(metadata.description || ""),
                        license: metadata.license ? String(metadata.license) : undefined,
                        compatibility: metadata.compatibility ? String(metadata.compatibility) : undefined,
                        tools,
                        content: body,
                        references: references.length ? references : undefined,
                    },
                };
            }
            if (!await directoryExists(skillsDir))
                return { skills: [] };
            const skills = [];
            for await (const entry of fs.readDir(skillsDir)) {
                if (!entry.isDirectory)
                    continue;
                const skillPath = join(skillsDir, entry.name, "SKILL.md");
                if (!await fileExists(skillPath))
                    continue;
                try {
                    const content = await fs.readTextFile(skillPath);
                    const { metadata } = parseSkillFrontmatter(content);
                    const tools = parseToolsFromMetadata(metadata);
                    skills.push({
                        name: String(metadata.name || entry.name),
                        description: String(metadata.description || "No description"),
                        license: metadata.license ? String(metadata.license) : undefined,
                        compatibility: metadata.compatibility ? String(metadata.compatibility) : undefined,
                        tools,
                    });
                }
                catch {
                    // Skip invalid skills
                }
            }
            return { skills };
        }
        catch (error) {
            return { error: formatError(error) };
        }
    }, { "tool.skill_name": input.name ?? "list_all" }),
};
// ============================================================================
// Tool: vf_get_skill_reference
// ============================================================================
const getSkillReferenceInput = z.object({
    skill: z.string().describe("Skill name"),
    reference: z.string().describe("Reference file path (e.g., 'references/ROUTES.md')"),
});
export const vfGetSkillReference = {
    name: "vf_get_skill_reference",
    description: "Get a specific reference document from a skill. Use this to load detailed documentation on demand.",
    inputSchema: getSkillReferenceInput,
    execute: async (input) => {
        const fs = getFs();
        const refPath = join(getSkillsDir(), input.skill, input.reference);
        try {
            const content = await fs.readTextFile(refPath);
            return { content };
        }
        catch (error) {
            return { error: formatError(error) };
        }
    },
};
