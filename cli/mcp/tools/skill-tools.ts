/**
 * MCP tools for skill discovery and reference loading.
 */

import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import type { SkillDocumentParserProvider } from "veryfront/extensions/parser";
import { join } from "veryfront/platform/path";
import { cwd } from "veryfront/platform";
import { withSpan } from "veryfront/observability/otlp-setup";
import {
  listStrictSkillSubdir,
  parseSkillFileFrontmatter,
  SKILL_RELATIVE_PATH_MAX_LENGTH,
  SKILL_STRICT_NAME_REGEX,
  SKILL_SUBDIR_MAX_ENTRIES,
  type SkillMetadata as ValidatedSkillMetadata,
  validateSkillFileMetadata,
  validateStrictSkillPath,
} from "veryfront/skill";
import { readSkillDocument } from "../../skills/read-skill-document.ts";
import { ensureCliSkillDocumentParser } from "#cli/shared/default-contracts";
import { assertSkillDirectoryIdentity } from "../../skills/validation.ts";
import type { MCPTool } from "../tools.ts";
import { directoryExists, formatError, getFs } from "./helpers.ts";

function getSkillsDir(): string {
  return join(cwd(), "cli/mcp/skills");
}

function parseToolsFromMetadata(metadata: ValidatedSkillMetadata): string[] | undefined {
  const tools = metadata.metadata?.tools;
  if (!tools) return undefined;
  const parsed = tools
    .split(",")
    .map((toolName) => toolName.trim())
    .filter((toolName) => toolName.length > 0);
  return parsed.length > 0 ? parsed : undefined;
}

type DiscoveredBundledSkill = {
  id: string;
  directory: string;
  metadata: ValidatedSkillMetadata;
  body: string;
  references: string[];
};

async function isNonSymlinkDirectory(path: string): Promise<boolean> {
  const fs = getFs();
  const info = fs.lstat ? await fs.lstat(path) : await fs.stat(path);
  return info.isDirectory && !info.isSymlink;
}

async function loadBundledSkill(
  skillsDir: string,
  entry: { name: string; isDirectory: boolean; isSymlink?: boolean },
  parser: Readonly<SkillDocumentParserProvider>,
): Promise<DiscoveredBundledSkill | null> {
  if (
    !entry.isDirectory ||
    entry.isSymlink === true ||
    !SKILL_STRICT_NAME_REGEX.test(entry.name)
  ) {
    return null;
  }

  const directory = join(skillsDir, entry.name);
  try {
    if (!await isNonSymlinkDirectory(directory)) {
      return null;
    }
    const skillPath = await validateStrictSkillPath(directory, "SKILL.md", []);
    const content = await readSkillDocument(skillPath);
    const parsed = await parseSkillFileFrontmatter(content, parser);
    assertSkillDirectoryIdentity(parsed.frontmatter, entry.name);
    const metadata = validateSkillFileMetadata(parsed.frontmatter, entry.name);
    const references = (await listStrictSkillSubdir(directory, "references"))
      .filter((reference) => reference.endsWith(".md"));

    return {
      id: entry.name,
      directory,
      metadata,
      body: parsed.body.trim(),
      references,
    };
  } catch {
    // Invalid, oversized, or unsafe bundled skills are unavailable.
    return null;
  }
}

async function discoverBundledSkills(
  skillsDir: string,
): Promise<Map<string, DiscoveredBundledSkill>> {
  const discovered = new Map<string, DiscoveredBundledSkill>();
  if (!await directoryExists(skillsDir) || !await isNonSymlinkDirectory(skillsDir)) {
    return discovered;
  }
  const parser = await ensureCliSkillDocumentParser();

  let entryCount = 0;
  for await (const entry of getFs().readDir(skillsDir)) {
    entryCount += 1;
    if (entryCount > SKILL_SUBDIR_MAX_ENTRIES) {
      throw new RangeError(
        `Bundled skill directory may contain at most ${SKILL_SUBDIR_MAX_ENTRIES} entries`,
      );
    }

    const skill = await loadBundledSkill(skillsDir, entry, parser);
    if (skill) {
      discovered.set(skill.id, skill);
    }
  }

  return discovered;
}

async function loadBundledSkillById(
  skillsDir: string,
  skillId: string,
): Promise<DiscoveredBundledSkill | null> {
  if (
    !isValidSkillId(skillId) ||
    !await directoryExists(skillsDir) ||
    !await isNonSymlinkDirectory(skillsDir)
  ) {
    return null;
  }
  const parser = await ensureCliSkillDocumentParser();

  return await loadBundledSkill(skillsDir, {
    name: skillId,
    isDirectory: true,
    isSymlink: false,
  }, parser);
}

function isValidSkillId(value: unknown): value is string {
  return typeof value === "string" && SKILL_STRICT_NAME_REGEX.test(value);
}

function isValidReferenceRequest(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= SKILL_RELATIVE_PATH_MAX_LENGTH;
}

const getSkillsInput = lazySchema(defineSchema((v) =>
  v.object({
    name: v.string().regex(
      SKILL_STRICT_NAME_REGEX,
      "Skill name must be a lowercase directory-matching identifier",
    ).optional().describe(
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

/** Create the bundled-skill discovery/load tool for a specific immutable root. */
export function createVfGetSkills(
  skillsDir: string = getSkillsDir(),
): MCPTool<GetSkillsInput, GetSkillsResult> {
  return {
    name: "vf_get_skills",
    title: "Get Skills",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    description:
      "Use this when you need to discover available Agent Skills or load a specific skill's procedural knowledge. Returns skill names and descriptions, or full skill content when name is provided. Do not use for skill reference docs — use vf_get_skill_reference instead.",
    inputSchema: getSkillsInput,
    execute: (input) =>
      withSpan(
        "cli.mcp.tool.vf_get_skills",
        async () => {
          try {
            if (input.name !== undefined && !isValidSkillId(input.name)) {
              return { error: "Invalid skill name" };
            }

            if (input.name !== undefined) {
              const skill = await loadBundledSkillById(skillsDir, input.name);
              if (!skill) {
                return { error: `Skill not found: ${input.name}` };
              }

              return {
                skill: {
                  name: skill.metadata.name,
                  description: skill.metadata.description,
                  license: skill.metadata.license,
                  compatibility: skill.metadata.compatibility,
                  tools: parseToolsFromMetadata(skill.metadata),
                  content: skill.body,
                  references: skill.references.length > 0 ? [...skill.references] : undefined,
                },
              };
            }

            const discovered = await discoverBundledSkills(skillsDir);
            return {
              skills: [...discovered.values()]
                .map((skill): SkillMetadata => ({
                  name: skill.metadata.name,
                  description: skill.metadata.description,
                  license: skill.metadata.license,
                  compatibility: skill.metadata.compatibility,
                  tools: parseToolsFromMetadata(skill.metadata),
                }))
                .sort((left, right) => left.name.localeCompare(right.name)),
            };
          } catch (error) {
            return { error: formatError(error) };
          }
        },
        { "tool.skill_name": input.name ?? "list_all" },
      ),
  };
}

const getSkillReferenceInput = lazySchema(defineSchema((v) =>
  v.object({
    skill: v.string().regex(
      SKILL_STRICT_NAME_REGEX,
      "Skill name must be a lowercase directory-matching identifier",
    ).describe("Skill name"),
    reference: v.string().min(1).max(SKILL_RELATIVE_PATH_MAX_LENGTH).describe(
      "Reference file path (e.g., 'references/ROUTES.md')",
    ),
  })
));

type GetSkillReferenceInput = InferSchema<typeof getSkillReferenceInput>;

interface GetSkillReferenceResult {
  content?: string;
  error?: string;
}

/** Create the bundled-skill reference tool for a specific immutable root. */
export function createVfGetSkillReference(
  skillsDir: string = getSkillsDir(),
): MCPTool<GetSkillReferenceInput, GetSkillReferenceResult> {
  return {
    name: "vf_get_skill_reference",
    title: "Get Skill Reference",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    description:
      "Use this when you need to load a specific reference document from a skill. Returns the document content as text. Do not use for skill discovery — use vf_get_skills instead.",
    inputSchema: getSkillReferenceInput,
    execute: async (input) => {
      if (!isValidSkillId(input.skill) || !isValidReferenceRequest(input.reference)) {
        return { error: "Invalid skill reference request" };
      }

      try {
        const skill = await loadBundledSkillById(skillsDir, input.skill);
        if (!skill || !skill.references.includes(input.reference)) {
          return { error: `Skill reference not found: ${input.skill}/${input.reference}` };
        }

        const referencePath = await validateStrictSkillPath(
          skill.directory,
          input.reference,
          ["references"],
        );
        return { content: await readSkillDocument(referencePath) };
      } catch (error) {
        return { error: formatError(error) };
      }
    },
  };
}

export const vfGetSkills = createVfGetSkills();
export const vfGetSkillReference = createVfGetSkillReference();
