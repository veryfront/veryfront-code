/**
 * Skill Registry
 *
 * Project-scoped registry for discovered skills.
 * Follows the same pattern as src/tool/registry.ts.
 *
 * @module
 */

import type { Skill } from "./types.ts";
import { ProjectScopedRegistryManager } from "#veryfront/ai/registry-manager.ts";
import { ScopedRegistryFacade } from "#veryfront/ai/registry-facade.ts";

const skillManager = new ProjectScopedRegistryManager<Skill>("skill");

class SkillRegistryClass extends ScopedRegistryFacade<Skill> {
  /**
   * Resolve skills for an agent configuration.
   *
   * @param skillsConfig - `true` for all skills, or array of specific skill IDs
   * @returns Map of resolved skills (missing IDs are silently skipped)
   */
  resolveForAgent(skillsConfig: true | string[]): Map<string, Skill> {
    if (skillsConfig === true) {
      return this.getAll();
    }

    const result = new Map<string, Skill>();
    for (const id of skillsConfig) {
      const skill = this.get(id);
      if (skill) {
        result.set(id, skill);
      }
    }
    return result;
  }
}

export const skillRegistry = new SkillRegistryClass(skillManager);

export function registerSkill(id: string, skill: Skill): void {
  skillRegistry.register(id, skill);
}

export function getSkill(id: string): Skill | undefined {
  return skillRegistry.get(id);
}

export function getAllSkills(): Map<string, Skill> {
  return skillRegistry.getAll();
}
