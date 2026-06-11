/**
 * Skill Registry
 *
 * Project-scoped registry for discovered skills.
 * Follows the same pattern as src/tool/registry.ts.
 *
 * Capability visibility is owner-aware: a skill registered with an
 * `ownerAgentId` is visible only to that agent; unowned skills are
 * project-global. One resolver rule applies to every agent kind (TS, flat
 * markdown, directory markdown) and to the skill tools.
 *
 * @module
 */

import type { Skill } from "./types.ts";
import { ScopedRegistryFacade } from "#veryfront/registry/scoped-registry-facade.ts";
import { ProjectScopedRegistryManager } from "#veryfront/registry/project-scoped-registry-manager.ts";

const skillManager = new ProjectScopedRegistryManager<Skill>("skill");

/** Caller scope used for owner-aware capability resolution. */
export type AgentCapabilityScope = {
  /** Id of the calling agent; absent for project-level/external callers. */
  agentId?: string;
};

/** Whether a skill is visible to the caller identified by the scope. */
export function isSkillVisibleTo(skill: Skill, scope?: AgentCapabilityScope): boolean {
  return skill.ownerAgentId === undefined || skill.ownerAgentId === scope?.agentId;
}

class SkillRegistryClass extends ScopedRegistryFacade<Skill> {
  /**
   * Resolve skills for an agent configuration.
   *
   * - `true` resolves to every skill visible to the caller: unowned
   *   (project-global) skills plus the caller's own skills — never another
   *   agent's owned skills.
   * - An explicit list resolves each entry as the caller's own short name
   *   first, then as an exact id of a visible skill (missing/invisible ids are
   *   silently skipped, preserving prior behavior for missing ids).
   *
   * @param skillsConfig - `true` for all visible skills, or array of ids/short names
   * @param scope - caller scope; omit for project-level callers
   */
  resolveForAgent(
    skillsConfig: true | string[],
    scope?: AgentCapabilityScope,
  ): Map<string, Skill> {
    const result = new Map<string, Skill>();

    if (skillsConfig === true) {
      for (const [id, skill] of this.getAll()) {
        if (isSkillVisibleTo(skill, scope)) {
          result.set(id, skill);
        }
      }
      return result;
    }

    for (const requested of skillsConfig) {
      const skill = this.resolveVisibleSkill(requested, scope);
      if (skill) {
        result.set(skill.id, skill);
      }
    }
    return result;
  }

  /**
   * Resolve a single requested skill for a caller: own short name first, then
   * exact id — returning only skills visible to the caller.
   */
  resolveVisibleSkill(requested: string, scope?: AgentCapabilityScope): Skill | undefined {
    if (scope?.agentId !== undefined) {
      for (const skill of this.getAll().values()) {
        if (skill.ownerAgentId === scope.agentId && skill.shortName === requested) {
          return skill;
        }
      }
    }

    const skill = this.get(requested);
    if (skill && isSkillVisibleTo(skill, scope)) {
      return skill;
    }
    return undefined;
  }

  /** Ids of every skill visible to the caller (for manifests and error messages). */
  getVisibleSkillIds(scope?: AgentCapabilityScope): string[] {
    const ids: string[] = [];
    for (const [id, skill] of this.getAll()) {
      if (isSkillVisibleTo(skill, scope)) {
        ids.push(id);
      }
    }
    return ids;
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
