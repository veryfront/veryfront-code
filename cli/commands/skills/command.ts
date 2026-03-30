/**
 * Skills command — list and inspect agent skills
 *
 * @module cli/commands/skills
 */

import { listCoreSkills, loadSkill } from "../../skills/loader.ts";
import type { LoadedSkill } from "../../skills/types.ts";

export async function listSkills(): Promise<LoadedSkill[]> {
  return await listCoreSkills();
}

export async function getSkillInfo(
  name: string,
): Promise<LoadedSkill | null> {
  const skills = await listCoreSkills();
  const found = skills.find((s) => s.manifest.name === name);
  if (found) return found;

  // Try loading directly by path
  return await loadSkill(name);
}
