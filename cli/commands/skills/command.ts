/**
 * Skills command, list and inspect agent skills
 *
 * @module cli/commands/skills
 */

import { findSkill, listAllSkills, loadSkill } from "../../skills/loader.ts";
import type { LoadedSkill } from "../../skills/types.ts";

export async function listSkills(): Promise<LoadedSkill[]> {
  return await listAllSkills();
}

export async function getSkillInfo(
  name: string,
): Promise<LoadedSkill | null> {
  const found = await findSkill(name);
  if (found) return found;

  // Try loading directly by path
  return await loadSkill(name, { references: true });
}
