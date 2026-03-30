import { createFileSystem } from "veryfront/platform";
import { type LoadedSkill, parseSkillJson } from "./types.ts";

const CORE_SKILLS_DIR = "cli/mcp/skills";

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

  try {
    for await (const entry of fs.readDir(CORE_SKILLS_DIR)) {
      if (!entry.isDirectory) continue;
      const skill = await loadSkill(`${CORE_SKILLS_DIR}/${entry.name}`);
      if (skill) skills.push(skill);
    }
  } catch {
    // Skills directory doesn't exist yet
  }

  return skills;
}
