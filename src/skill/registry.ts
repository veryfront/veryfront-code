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
import {
  ScopedRegistryFacade,
  ScopedRegistryView,
} from "#veryfront/registry/scoped-registry-facade.ts";
import {
  assertResolvedSkillSelector,
  type ResolvedSkillSelectorSnapshot,
  resolveSkillSelector,
} from "./selector.ts";
import { ProjectScopedRegistryManager } from "#veryfront/registry/project-scoped-registry-manager.ts";
import {
  cloneSkillDefinition,
  normalizeSkillDefinition,
  validateSkillRegistryCandidate,
} from "./validation.ts";

const defineOwnProperty = Object.defineProperty;
const freeze = Object.freeze;

function appendOwnArrayElement<T>(values: T[], value: T): void {
  defineOwnProperty(values, values.length, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

const skillManager = new ProjectScopedRegistryManager<Skill>("skill", {
  validateRegistryCandidate: validateSkillRegistryCandidate,
});
const publicSkillViews = new WeakMap<Skill, Skill>();

function getPublicSkillView(snapshot: Skill): Skill {
  let view = publicSkillViews.get(snapshot);
  if (!view) {
    view = cloneSkillDefinition(snapshot);
    publicSkillViews.set(snapshot, view);
  }
  return view;
}

/** Caller scope used for owner-aware capability resolution. */
export type AgentCapabilityScope = {
  /** Id of the calling agent; absent for project-level/external callers. */
  agentId?: string;
};

/** Whether a skill is visible to the caller identified by the scope. */
export function isSkillVisibleTo(skill: Skill, scope?: AgentCapabilityScope): boolean {
  return skill.ownerAgentId === undefined || skill.ownerAgentId === scope?.agentId;
}

class SkillRegistryInternal extends ScopedRegistryFacade<Skill> {
  override register(id: string, skill: Skill): void {
    super.register(id, normalizeSkillDefinition(id, skill));
  }

  registerPublic(id: string, skill: Skill): void {
    const snapshot = normalizeSkillDefinition(id, skill);
    super.register(id, snapshot);
    publicSkillViews.set(snapshot, skill);
  }

  override registerShared(id: string, skill: Skill): void {
    super.registerShared(id, normalizeSkillDefinition(id, skill));
  }

  /**
   * Resolve a presence-aware, execution-facing skill selector snapshot.
   *
   * Omitted and `true` resolve to all visible skills, `[]` resolves to none,
   * and explicit entries must resolve to this caller's own short names or
   * exact visible ids. Explicit misses fail closed with a generic error.
   */
  resolveSelectorForAgent(
    skillsConfig: true | string[] | undefined,
    scope?: AgentCapabilityScope,
  ): ResolvedSkillSelectorSnapshot<Skill> {
    const snapshot = resolveSkillSelector({
      definitions: [...this.getAll().values()],
      selector: skillsConfig,
      getId: (skill) => skill.id,
      isVisible: (skill) => isSkillVisibleTo(skill, scope),
      getShortName: (skill) => skill.shortName,
      isOwnShortNameCandidate: (skill) =>
        scope?.agentId !== undefined && skill.ownerAgentId === scope.agentId,
      getSourcePath: (skill) => `${skill.rootPath}/SKILL.md`,
    });
    assertResolvedSkillSelector(snapshot);
    return snapshot;
  }

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
        appendOwnArrayElement(ids, id);
      }
    }
    return ids;
  }

  /** Whether at least one skill is visible without materializing a catalog. */
  hasVisibleSkills(scope?: AgentCapabilityScope): boolean {
    return this.manager.some((skill) => isSkillVisibleTo(skill, scope));
  }
}

/** Framework-only skill registry with process-wide maintenance capabilities. */
export const skillRegistryInternal = new SkillRegistryInternal(skillManager);

/**
 * Application-facing project-scoped skill registry API.
 *
 * Process-wide maintenance methods remain for compatibility; framework
 * composition roots should use `skillRegistryInternal` for that behavior.
 */
class SkillRegistry extends ScopedRegistryView<Skill> {
  readonly #registry: SkillRegistryInternal;

  constructor(registry: SkillRegistryInternal) {
    super(registry);
    this.#registry = registry;
  }

  override register(id: string, skill: Skill): void {
    this.#registry.registerPublic(id, skill);
  }

  override get(id: string): Skill | undefined {
    const skill = this.#registry.get(id);
    return skill ? getPublicSkillView(skill) : undefined;
  }

  override getOwn(id: string): Skill | undefined {
    const skill = this.#registry.getOwn(id);
    return skill ? getPublicSkillView(skill) : undefined;
  }

  override getAll(): Map<string, Skill> {
    return new Map(
      [...this.#registry.getAll()].map(([id, skill]) => [
        id,
        getPublicSkillView(skill),
      ]),
    );
  }

  resolveSelectorForAgent(
    skillsConfig: true | string[] | undefined,
    scope?: AgentCapabilityScope,
  ): ResolvedSkillSelectorSnapshot<Skill> {
    const snapshot = this.#registry.resolveSelectorForAgent(skillsConfig, scope);
    const definitions: Skill[] = [];
    for (let index = 0; index < snapshot.definitions.length; index += 1) {
      appendOwnArrayElement(
        definitions,
        getPublicSkillView(snapshot.definitions[index]!),
      );
    }
    freeze(definitions);
    return freeze({
      ...snapshot,
      definitions,
    });
  }

  resolveForAgent(
    skillsConfig: true | string[],
    scope?: AgentCapabilityScope,
  ): Map<string, Skill> {
    const result = new Map<string, Skill>();
    for (const [id, skill] of this.#registry.resolveForAgent(skillsConfig, scope)) {
      result.set(id, getPublicSkillView(skill));
    }
    return result;
  }

  resolveVisibleSkill(requested: string, scope?: AgentCapabilityScope): Skill | undefined {
    const skill = this.#registry.resolveVisibleSkill(requested, scope);
    return skill ? getPublicSkillView(skill) : undefined;
  }

  getVisibleSkillIds(scope?: AgentCapabilityScope): string[] {
    return this.#registry.getVisibleSkillIds(scope);
  }

  hasVisibleSkills(scope?: AgentCapabilityScope): boolean {
    return this.#registry.hasVisibleSkills(scope);
  }
}

export const skillRegistry = new SkillRegistry(skillRegistryInternal);

export function registerSkill(id: string, skill: Skill): void {
  skillRegistry.register(id, skill);
}

export function getSkill(id: string): Skill | undefined {
  return skillRegistry.get(id);
}

export function getAllSkills(): Map<string, Skill> {
  return skillRegistry.getAll();
}
