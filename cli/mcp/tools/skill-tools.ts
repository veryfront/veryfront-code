/**
 * MCP tools for skill discovery and reference loading.
 */

import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { withSpan } from "veryfront/observability/otlp-setup";
import type { MCPTool } from "../tools.ts";
import { formatError } from "./helpers.ts";
import { listCoreSkills, readCoreSkillDocument } from "../../skills/loader.ts";
import type { LoadedSkill } from "../../skills/types.ts";

function toSkillMetadata({ metadata }: LoadedSkill): SkillMetadata {
  return {
    name: metadata.name,
    description: metadata.description,
    license: metadata.license,
    compatibility: metadata.compatibility,
    tools: metadata.metadata?.tools?.split(",").map((tool) => tool.trim()),
  };
}

const getSkillsInput = lazySchema(defineSchema((v) =>
  v.object({
    name: v.string().optional().describe(
      "Specific skill name to get full content for (omit for list of all skills)",
    ),
  })
));

type GetSkillsInput = InferSchema<typeof getSkillsInput>;

interface SkillMetadata {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  tools?: string[];
}

interface SkillContent extends SkillMetadata {
  content: string;
  references?: string[];
}

interface GetSkillsResult {
  skills?: SkillMetadata[];
  skill?: SkillContent;
  error?: string;
}

export const vfGetSkills: MCPTool<GetSkillsInput, GetSkillsResult> = {
  name: "vf_get_skills",
  title: "Get Skills",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  description:
    "Use this when you need to discover available Agent Skills or load a specific skill's procedural knowledge. Returns skill names and descriptions, or full skill content when name is provided. Do not use for skill reference docs. Use vf_get_skill_reference instead.",
  inputSchema: getSkillsInput,
  execute: (input) =>
    withSpan(
      "cli.mcp.tool.vf_get_skills",
      async () => {
        try {
          const skills = await listCoreSkills();
          if (!input.name) return { skills: skills.map(toSkillMetadata) };

          const skill = skills.find((s) => s.metadata.name === input.name);
          if (!skill) return { error: `Skill not found: ${input.name}` };

          const references = Object.keys(skill.references ?? {});
          return {
            skill: {
              ...toSkillMetadata(skill),
              content: skill.skillMd,
              references: references.length ? references : undefined,
            },
          };
        } catch (error) {
          return { error: formatError(error) };
        }
      },
      { "tool.skill_name": input.name ?? "list_all" },
    ),
};

const getSkillReferenceInput = lazySchema(defineSchema((v) =>
  v.object({
    skill: v.string().describe("Skill name"),
    reference: v.string().describe("Reference file path (e.g., 'references/ROUTES.md')"),
  })
));

type GetSkillReferenceInput = InferSchema<typeof getSkillReferenceInput>;

interface GetSkillReferenceResult {
  content?: string;
  error?: string;
}

export const vfGetSkillReference: MCPTool<GetSkillReferenceInput, GetSkillReferenceResult> = {
  name: "vf_get_skill_reference",
  title: "Get Skill Reference",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  description:
    "Use this when you need to load a specific reference document from a skill. Returns the document content as text. Do not use for skill discovery. Use vf_get_skills instead.",
  inputSchema: getSkillReferenceInput,
  execute: async (input) => {
    const content = await readCoreSkillDocument(input.skill, input.reference);
    if (content === undefined) {
      return { error: `Reference not found: ${input.skill}/${input.reference}` };
    }
    return { content };
  },
};
