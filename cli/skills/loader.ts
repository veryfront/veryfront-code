import { createFileSystem } from "veryfront/platform";
import { cwd } from "veryfront/platform";
import { type LoadedSkill, parseSkillJson } from "./types.ts";
import { CORE_SKILLS } from "./core-skills.ts";

function getCoreSkillsDir(): string {
  return new URL("../mcp/skills", import.meta.url).pathname;
}

export async function loadSkill(
  directory: string,
): Promise<LoadedSkill | null> {
  const fs = createFileSystem();

  try {
    const manifestRaw = await fs.readTextFile(`${directory}/skill.json`);
    const manifest = parseSkillJson(JSON.parse(manifestRaw));
    if (!manifest.success) return null;

    const skillMd = await fs.readTextFile(`${directory}/SKILL.md`).catch(
      () => "",
    );
    return { manifest: manifest.data, skillMd, directory };
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
    // Filesystem skills not available (compiled binary) — use embedded
  }

  // Fall back to embedded core skills if none loaded from filesystem
  if (skills.length === 0) {
    return CORE_SKILLS;
  }

  return skills;
}

/**
 * Scan the current working directory for local skill directories.
 * A local skill is any subdirectory containing a skill.json file.
 */
export async function listLocalSkills(): Promise<LoadedSkill[]> {
  const fs = createFileSystem();
  const skills: LoadedSkill[] = [];
  const dir = cwd();

  try {
    for await (const entry of fs.readDir(dir)) {
      if (!entry.isDirectory) continue;
      const skill = await loadSkill(`${dir}/${entry.name}`);
      if (skill) skills.push(skill);
    }
  } catch {
    // cwd not readable
  }

  return skills;
}

/**
 * List all skills: core (built-in) + local (in cwd).
 */
export async function listAllSkills(): Promise<LoadedSkill[]> {
  const [core, local] = await Promise.all([
    listCoreSkills(),
    listLocalSkills(),
  ]);

  // Deduplicate by name, local skills override core
  const seen = new Set<string>();
  const result: LoadedSkill[] = [];

  for (const skill of local) {
    seen.add(skill.manifest.name);
    result.push(skill);
  }
  for (const skill of core) {
    if (!seen.has(skill.manifest.name)) {
      result.push(skill);
    }
  }

  return result;
}
