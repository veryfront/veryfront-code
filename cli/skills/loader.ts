import { createFileSystem } from "veryfront/platform";
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
