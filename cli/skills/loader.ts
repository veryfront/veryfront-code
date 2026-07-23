import { createFileSystem } from "veryfront/platform";
import { cwd } from "veryfront/platform";
import { basename } from "#std/path.ts";
import { parseSkillFrontmatter, validateSkillMetadata } from "veryfront/skill";
import type { LoadedSkill } from "./types.ts";
import { CORE_SKILLS } from "./core-skills.ts";

function getCoreSkillsDir(): string {
  return new URL("../mcp/skills", import.meta.url).pathname;
}

export async function loadSkill(
  directory: string,
): Promise<LoadedSkill | null> {
  const fs = createFileSystem();

  try {
    const content = await fs.readTextFile(`${directory}/SKILL.md`);
    const parsed = await parseSkillFrontmatter(content);
    const metadata = validateSkillMetadata(parsed.frontmatter, basename(directory));
    return { metadata, skillMd: parsed.body.trimStart(), directory };
  } catch {
    return null;
  }
}

export async function listCoreSkills(): Promise<LoadedSkill[]> {
  const fs = createFileSystem();
  const skills: LoadedSkill[] = [];
  const skillsDir = getCoreSkillsDir();

  try {
    for await (const entry of fs.readDir(skillsDir)) {
      if (!entry.isDirectory) continue;
      const skill = await loadSkill(`${skillsDir}/${entry.name}`);
      if (skill) skills.push(skill);
    }
  } catch {
    // Filesystem skills not available in compiled binaries. Use embedded skills.
  }

  // Fall back to embedded core skills if none loaded from filesystem
  if (skills.length === 0) {
    return CORE_SKILLS;
  }

  return skills;
}

/**
 * Scan the current working directory for local skill directories.
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
 * List all skills: core (built-in) + local (in cwd).
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
