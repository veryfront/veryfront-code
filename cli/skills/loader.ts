import { createFileSystem } from "veryfront/platform";
import { cwd } from "veryfront/platform";
import { basename } from "veryfront/platform/path";
import { parseSkillFrontmatter, validateSkillMetadata } from "veryfront/skill";
import type { LoadedSkill } from "./types.ts";

function getCoreSkillsDir(): string {
  return new URL("../mcp/skills", import.meta.url).pathname;
}

export async function loadSkill(
  directory: string,
  options: { references?: boolean } = {},
): Promise<LoadedSkill | null> {
  const fs = createFileSystem();

  try {
    const content = await fs.readTextFile(`${directory}/SKILL.md`);
    const parsed = await parseSkillFrontmatter(content);
    const metadata = validateSkillMetadata(parsed.frontmatter, basename(directory));
    const skill: LoadedSkill = { metadata, skillMd: parsed.body.trimStart(), directory };
    const references = options.references
      ? await loadReferences(`${directory}/references`)
      : undefined;
    if (references) skill.references = references;
    return skill;
  } catch {
    return null;
  }
}

async function loadReferences(
  directory: string,
): Promise<Record<string, string> | undefined> {
  const fs = createFileSystem();
  const names: string[] = [];

  try {
    for await (const entry of fs.readDir(directory)) {
      if (entry.isFile && entry.name.endsWith(".md")) names.push(entry.name);
    }
  } catch {
    return undefined;
  }
  if (names.length === 0) return undefined;

  const references: Record<string, string> = {};
  for (const name of names.sort((a, b) => a.localeCompare(b))) {
    references[`references/${name}`] = await fs.readTextFile(`${directory}/${name}`);
  }
  return references;
}

export async function listCoreSkills(
  skillsDir: string = getCoreSkillsDir(),
): Promise<LoadedSkill[]> {
  const fs = createFileSystem();
  const skills: LoadedSkill[] = [];

  try {
    for await (const entry of fs.readDir(skillsDir)) {
      if (!entry.isDirectory) continue;
      const skill = await loadSkill(`${skillsDir}/${entry.name}`, { references: true });
      if (skill) skills.push(skill);
    }
  } catch {
    // Filesystem skills not available in compiled binaries. Use embedded skills.
  }

  // The npm package and compiled binaries do not ship cli/mcp/skills/, so fall
  // back to the copy embedded at build time. Loaded lazily so the generator,
  // which imports loadSkill, can run before the embedded copy exists.
  if (skills.length === 0) {
    const { CORE_SKILLS } = await import("./core-skills.generated.ts");
    return CORE_SKILLS;
  }

  return skills;
}

/**
 * Read a core skill's SKILL.md body or one of its references, such as
 * `references/ROUTES.md`. Works in the npm package and compiled binary too.
 */
export async function readCoreSkillDocument(
  skillName: string,
  path: string,
  skillsDir: string = getCoreSkillsDir(),
): Promise<string | undefined> {
  const skill = (await listCoreSkills(skillsDir)).find((s) => s.metadata.name === skillName);
  if (!skill) return undefined;
  return path === "SKILL.md" ? skill.skillMd : skill.references?.[path];
}

/**
 * Scan the provided project directory for local skill directories.
 * A local skill is any skills/<id>/ directory containing a SKILL.md file.
 */
export async function listLocalSkills(baseDir: string = cwd()): Promise<LoadedSkill[]> {
  const fs = createFileSystem();
  const skills: LoadedSkill[] = [];
  const skillsDir = `${baseDir}/skills`;

  try {
    for await (const entry of fs.readDir(skillsDir)) {
      if (!entry.isDirectory) continue;
      const skill = await loadSkill(`${skillsDir}/${entry.name}`);
      if (skill) skills.push(skill);
    }
  } catch {
    // local skills directory not readable
  }

  return skills;
}

/**
 * Find a skill by name, local skills first, with its reference documents.
 * Listing leaves out local references; only the selected skill reads them.
 */
export async function findSkill(
  name: string,
  baseDir: string = cwd(),
): Promise<LoadedSkill | null> {
  const found = (await listAllSkills(baseDir)).find((s) => s.metadata.name === name);
  if (!found) return null;
  if (found.directory.startsWith("core:")) return found;
  return await loadSkill(found.directory, { references: true });
}

/**
 * List all skills: core (built-in) + local (under baseDir).
 */
export async function listAllSkills(baseDir: string = cwd()): Promise<LoadedSkill[]> {
  const [core, local] = await Promise.all([
    listCoreSkills(),
    listLocalSkills(baseDir),
  ]);

  // Deduplicate by name, local skills override core
  const seen = new Set<string>();
  const result: LoadedSkill[] = [];

  for (const skill of local) {
    seen.add(skill.metadata.name);
    result.push(skill);
  }
  for (const skill of core) {
    if (!seen.has(skill.metadata.name)) {
      result.push(skill);
    }
  }

  return result;
}
