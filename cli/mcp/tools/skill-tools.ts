/**
 * MCP tools for skill discovery and reference loading.
 */

import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { cwd, type FileSystem } from "veryfront/platform";
import { join, relative } from "veryfront/platform/path";
import { withSpan } from "veryfront/observability/otlp-setup";
import {
  parseSkillFrontmatter,
  SKILL_DEFINITION_MAX_BYTES,
  SKILL_NAME_REGEX,
  validateSkillMetadata,
} from "veryfront/skill";
import type { MCPTool } from "../tools.ts";
import { getFs } from "./helpers.ts";

const MAX_REFERENCE_PATH_LENGTH = 512;
const MAX_DIRECTORY_ENTRIES = 1_000;
const MAX_REFERENCE_TEXT_FILE_BYTES = 4 * 1024 * 1024;
const SKILL_NOT_FOUND = "Skill not found.";
const SKILL_REFERENCE_NOT_FOUND = "Skill reference not found.";
const SKILLS_UNAVAILABLE = "Skills are unavailable.";

function getSkillsDir(): string {
  return join(cwd(), "cli/mcp/skills");
}

function isSafeSkillName(value: unknown): value is string {
  return typeof value === "string" && SKILL_NAME_REGEX.test(value);
}

function isSafeEntryName(value: string): boolean {
  if (
    !value || value === "." || value === ".." || value.length > 255 || value.includes("/") ||
    value.includes("\\") || value.includes("%")
  ) {
    return false;
  }

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return false;
  }
  return true;
}

function isSafeReferencePath(value: unknown): value is string {
  if (
    typeof value !== "string" || value.length === 0 ||
    value.length > MAX_REFERENCE_PATH_LENGTH
  ) {
    return false;
  }

  const prefix = "references/";
  if (!value.startsWith(prefix)) return false;
  const fileName = value.slice(prefix.length);
  return isSafeEntryName(fileName) && fileName.endsWith(".md");
}

function requireLocalPathInspection(fs: FileSystem): {
  lstat: NonNullable<FileSystem["lstat"]>;
  realPath: NonNullable<FileSystem["realPath"]>;
} {
  if (!fs.lstat || !fs.realPath) {
    throw new Error("Local path inspection is unavailable");
  }
  return { lstat: fs.lstat.bind(fs), realPath: fs.realPath.bind(fs) };
}

async function assertCanonicalRelativePath(
  fs: FileSystem,
  basePath: string,
  targetPath: string,
  expectedRelativePath: string,
): Promise<string> {
  const { realPath } = requireLocalPathInspection(fs);
  const [realBase, realTarget] = await Promise.all([
    realPath(basePath),
    realPath(targetPath),
  ]);
  if (relative(realBase, realTarget) !== expectedRelativePath) {
    throw new Error("Path is outside its allowed directory");
  }
  return realTarget;
}

async function assertRegularPath(
  fs: FileSystem,
  path: string,
  kind: "file" | "directory",
): Promise<void> {
  const { lstat } = requireLocalPathInspection(fs);
  const info = await lstat(path);
  const matchesKind = kind === "file" ? info.isFile : info.isDirectory;
  if (!matchesKind || info.isSymlink) throw new Error(`Expected a regular ${kind}`);
}

async function readBoundedTextFile(
  fs: FileSystem,
  basePath: string,
  path: string,
  expectedRelativePath: string,
  maxBytes: number,
): Promise<string> {
  await assertRegularPath(fs, path, "file");
  const initialRealPath = await assertCanonicalRelativePath(
    fs,
    basePath,
    path,
    expectedRelativePath,
  );
  const before = await fs.stat(path);
  if (
    !before.isFile || !Number.isSafeInteger(before.size) || before.size < 0 ||
    before.size > maxBytes
  ) {
    throw new Error("Skill text file is invalid");
  }

  const bytes = await fs.readFile(path);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > maxBytes) {
    throw new Error("Skill text file is too large");
  }

  await assertRegularPath(fs, path, "file");
  const finalRealPath = await assertCanonicalRelativePath(
    fs,
    basePath,
    path,
    expectedRelativePath,
  );
  if (initialRealPath !== finalRealPath) throw new Error("Skill text file changed while reading");

  const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (content.includes("\0")) throw new Error("Skill text file contains invalid text");
  return content;
}

async function resolveSkillRoot(fs: FileSystem, skillName: string): Promise<string> {
  if (!isSafeSkillName(skillName)) throw new Error("Invalid skill name");

  const skillsDir = getSkillsDir();
  await assertRegularPath(fs, skillsDir, "directory");
  let entriesScanned = 0;
  let found = false;
  for await (const entry of fs.readDir(skillsDir)) {
    entriesScanned += 1;
    if (entriesScanned > MAX_DIRECTORY_ENTRIES) {
      throw new Error("Skill directory entry limit exceeded");
    }
    if (entry.name !== skillName) continue;
    found = entry.isDirectory && entry.isSymlink !== true;
  }
  if (!found) throw new Error("Skill is not advertised");

  const skillRoot = join(skillsDir, skillName);
  await assertRegularPath(fs, skillRoot, "directory");
  await assertCanonicalRelativePath(fs, skillsDir, skillRoot, skillName);
  return skillRoot;
}

async function listSkillRoots(fs: FileSystem): Promise<Array<{ name: string; path: string }>> {
  const skillsDir = getSkillsDir();
  if (!await fs.exists(skillsDir)) return [];
  await assertRegularPath(fs, skillsDir, "directory");

  const skills: Array<{ name: string; path: string }> = [];
  const seen = new Set<string>();
  let entriesScanned = 0;
  for await (const entry of fs.readDir(skillsDir)) {
    entriesScanned += 1;
    if (entriesScanned > MAX_DIRECTORY_ENTRIES) {
      throw new Error("Skill directory entry limit exceeded");
    }
    if (
      !isSafeSkillName(entry.name) || !entry.isDirectory || entry.isSymlink === true ||
      seen.has(entry.name)
    ) {
      continue;
    }

    const skillRoot = join(skillsDir, entry.name);
    try {
      await assertRegularPath(fs, skillRoot, "directory");
      await assertCanonicalRelativePath(fs, skillsDir, skillRoot, entry.name);
      seen.add(entry.name);
      skills.push({ name: entry.name, path: skillRoot });
    } catch {
      // Ignore entries that cannot be inspected safely.
    }
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

function parseToolsFromMetadata(
  metadata: { metadata?: Record<string, string> },
): string[] | undefined {
  const tools = metadata.metadata?.tools;
  if (!tools) return undefined;
  return String(tools)
    .split(",")
    .map((t) => t.trim());
}

async function getSkillReferences(
  fs: FileSystem,
  skillRoot: string,
): Promise<string[] | undefined> {
  const refsDir = join(skillRoot, "references");
  if (!await fs.exists(refsDir)) return undefined;
  await assertRegularPath(fs, refsDir, "directory");
  await assertCanonicalRelativePath(fs, skillRoot, refsDir, "references");

  const references: string[] = [];
  const seen = new Set<string>();
  let entriesScanned = 0;
  for await (const entry of fs.readDir(refsDir)) {
    entriesScanned += 1;
    if (entriesScanned > MAX_DIRECTORY_ENTRIES) {
      throw new Error("Skill reference entry limit exceeded");
    }
    if (
      entry.isFile && entry.isSymlink !== true && isSafeEntryName(entry.name) &&
      entry.name.endsWith(".md") && !seen.has(entry.name)
    ) {
      seen.add(entry.name);
      references.push(`references/${entry.name}`);
    }
  }

  return references.length ? references.sort() : undefined;
}

const getSkillsInput = lazySchema(defineSchema((v) =>
  v.object({
    name: v.string().optional().describe(
      "Specific skill name to get full content for (omit for list of all skills)",
    ),
  })
));

type GetSkillsInput = InferSchema<typeof getSkillsInput>;

interface ListedSkillMetadata {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  tools?: string[];
}

interface SkillContent extends ListedSkillMetadata {
  content: string;
  references?: string[];
}

interface GetSkillsResult {
  skills?: ListedSkillMetadata[];
  skill?: SkillContent;
  error?: string;
}

export const vfGetSkills: MCPTool<GetSkillsInput, GetSkillsResult> = {
  name: "vf_get_skills",
  title: "Get Skills",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  description:
    "Use this when you need to discover available Agent Skills or load a specific skill's procedural knowledge. Returns skill names and descriptions, or full skill content when name is provided. For skill reference docs, use vf_get_skill_reference instead.",
  inputSchema: getSkillsInput,
  execute: (input) =>
    withSpan(
      "cli.mcp.tool.vf_get_skills",
      async () => {
        const fs = getFs();

        try {
          if (input.name !== undefined) {
            const skillRoot = await resolveSkillRoot(fs, input.name);
            const skillPath = join(skillRoot, "SKILL.md");
            const content = await readBoundedTextFile(
              fs,
              skillRoot,
              skillPath,
              "SKILL.md",
              SKILL_DEFINITION_MAX_BYTES,
            );
            const parsed = await parseSkillFrontmatter(content);
            const metadata = validateSkillMetadata(parsed.frontmatter, input.name);

            return {
              skill: {
                name: metadata.name,
                description: metadata.description,
                license: metadata.license,
                compatibility: metadata.compatibility,
                tools: parseToolsFromMetadata(metadata),
                content: parsed.body.trim(),
                references: await getSkillReferences(fs, skillRoot),
              },
            };
          }

          const skills: ListedSkillMetadata[] = [];
          for (const entry of await listSkillRoots(fs)) {
            const skillPath = join(entry.path, "SKILL.md");
            try {
              const content = await readBoundedTextFile(
                fs,
                entry.path,
                skillPath,
                "SKILL.md",
                SKILL_DEFINITION_MAX_BYTES,
              );
              const parsed = await parseSkillFrontmatter(content);
              const metadata = validateSkillMetadata(parsed.frontmatter, entry.name);

              skills.push({
                name: metadata.name,
                description: metadata.description,
                license: metadata.license,
                compatibility: metadata.compatibility,
                tools: parseToolsFromMetadata(metadata),
              });
            } catch {
              // Skip invalid skills
            }
          }

          return { skills };
        } catch {
          return { error: input.name === undefined ? SKILLS_UNAVAILABLE : SKILL_NOT_FOUND };
        }
      },
      { "tool.skill_lookup": input.name === undefined ? "list" : "named" },
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
    "Use this when you need to load a specific reference document from a skill. Returns the document content as text. For skill discovery, use vf_get_skills instead.",
  inputSchema: getSkillReferenceInput,
  execute: async (input) => {
    const fs = getFs();

    try {
      if (!isSafeReferencePath(input.reference)) {
        return { error: SKILL_REFERENCE_NOT_FOUND };
      }
      const skillRoot = await resolveSkillRoot(fs, input.skill);
      const references = await getSkillReferences(fs, skillRoot);
      if (!references?.includes(input.reference)) {
        return { error: SKILL_REFERENCE_NOT_FOUND };
      }

      const refPath = join(skillRoot, input.reference);
      const content = await readBoundedTextFile(
        fs,
        skillRoot,
        refPath,
        input.reference,
        MAX_REFERENCE_TEXT_FILE_BYTES,
      );
      return { content };
    } catch {
      return { error: SKILL_REFERENCE_NOT_FOUND };
    }
  },
};
