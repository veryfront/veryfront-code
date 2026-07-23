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

import { INVALID_ARGUMENT } from "#veryfront/errors";
import { ScopedRegistryFacade } from "#veryfront/registry/scoped-registry-facade.ts";
import { ProjectScopedRegistryManager } from "#veryfront/registry/project-scoped-registry-manager.ts";
import { validateAllowedToolPatterns } from "./allowed-tools.ts";
import {
  type Skill,
  SKILL_COMPATIBILITY_MAX_LENGTH,
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_NAME_REGEX,
} from "./types.ts";

const MAX_SKILL_PATH_LENGTH = 4_096;
const MAX_SKILL_REGISTRY_ID_LENGTH = 256;
const MAX_SKILL_SCOPE_ID_LENGTH = 4_096;
const MAX_SKILL_RECORD_FIELDS = 16;
const MAX_SKILL_METADATA_FIELDS = 16;
const MAX_SKILL_CUSTOM_METADATA_ENTRIES = 64;
const SKILL_REGISTRY_ID_REGEX = /^[A-Za-z0-9_-]+$/;

function invalidRegistration(message: string): never {
  throw INVALID_ARGUMENT.create({ message });
}

function snapshotDataRecord(
  value: unknown,
  label: string,
  maxFields: number,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalidRegistration(`${label} must be a plain object`);
  }
  let prototype: object | null;
  let keys: (string | symbol)[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    invalidRegistration(`${label} must be readable`);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    invalidRegistration(`${label} must be a plain object`);
  }
  if (keys.length > maxFields) {
    invalidRegistration(`${label} contains too many fields`);
  }

  const snapshot: Record<string, unknown> = {};
  for (const key of keys) {
    if (typeof key !== "string") invalidRegistration(`${label} must use string keys`);
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    } catch {
      invalidRegistration(`${label} must be readable`);
    }
    if (!descriptor || !("value" in descriptor)) {
      invalidRegistration(`${label} must contain data properties only`);
    }
    Object.defineProperty(snapshot, key, {
      configurable: true,
      enumerable: true,
      value: descriptor.value,
      writable: true,
    });
  }
  return snapshot;
}

function isSafeBoundedText(value: unknown, maxLength: number): value is string {
  if (typeof value !== "string" || !value || value.length > maxLength) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return false;
  }
  return true;
}

function snapshotCustomMetadata(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  const fields = snapshotDataRecord(
    value,
    "Skill custom metadata",
    MAX_SKILL_CUSTOM_METADATA_ENTRIES,
  );
  const result: Record<string, string> = {};
  for (const [key, fieldValue] of Object.entries(fields)) {
    if (
      !isSafeBoundedText(key, 128) || typeof fieldValue !== "string" || fieldValue.length > 1_024
    ) {
      invalidRegistration("Skill custom metadata must use bounded string keys and values");
    }
    Object.defineProperty(result, key, {
      enumerable: true,
      value: fieldValue,
    });
  }
  return Object.freeze(result);
}

function snapshotSkillRegistration(id: string, value: Skill): Skill {
  const skill = snapshotDataRecord(value, "Skill registration", MAX_SKILL_RECORD_FIELDS);
  if (
    !isSafeBoundedText(id, MAX_SKILL_REGISTRY_ID_LENGTH) || !SKILL_REGISTRY_ID_REGEX.test(id)
  ) {
    invalidRegistration("Skill registry id is invalid");
  }
  if (skill.id !== id) {
    invalidRegistration("Skill registry id must match the registered skill id");
  }
  if (!isSafeBoundedText(skill.rootPath, MAX_SKILL_PATH_LENGTH)) {
    invalidRegistration("Skill root path is invalid");
  }

  const metadata = snapshotDataRecord(
    skill.metadata,
    "Skill metadata",
    MAX_SKILL_METADATA_FIELDS,
  );
  if (typeof metadata.name !== "string" || !SKILL_NAME_REGEX.test(metadata.name)) {
    invalidRegistration("Skill metadata name is invalid");
  }
  if (
    typeof metadata.description !== "string" || !metadata.description.trim() ||
    metadata.description.length > SKILL_DESCRIPTION_MAX_LENGTH ||
    metadata.description.trim() !== metadata.description
  ) {
    invalidRegistration("Skill metadata description is invalid");
  }
  if (
    metadata.license !== undefined &&
    (!isSafeBoundedText(metadata.license, 500) || metadata.license.trim() !== metadata.license)
  ) {
    invalidRegistration("Skill metadata license is invalid");
  }
  if (
    metadata.compatibility !== undefined &&
    (!isSafeBoundedText(metadata.compatibility, SKILL_COMPATIBILITY_MAX_LENGTH) ||
      metadata.compatibility.trim() !== metadata.compatibility)
  ) {
    invalidRegistration("Skill metadata compatibility is invalid");
  }

  let allowedTools: string[] | undefined;
  if (metadata.allowedTools !== undefined) {
    if (!Array.isArray(metadata.allowedTools)) {
      invalidRegistration("Skill allowed-tools policy must be an array");
    }
    allowedTools = validateAllowedToolPatterns(metadata.allowedTools as string[]);
    Object.freeze(allowedTools);
  }
  const customMetadata = snapshotCustomMetadata(metadata.metadata);
  const metadataSnapshot = Object.freeze({
    name: metadata.name,
    description: metadata.description,
    ...(allowedTools !== undefined ? { allowedTools } : {}),
    ...(metadata.license !== undefined ? { license: metadata.license as string } : {}),
    ...(metadata.compatibility !== undefined
      ? { compatibility: metadata.compatibility as string }
      : {}),
    ...(customMetadata !== undefined ? { metadata: customMetadata } : {}),
  });

  const ownerAgentId = skill.ownerAgentId;
  const shortName = skill.shortName;
  if (
    ownerAgentId !== undefined && !isSafeBoundedText(ownerAgentId, MAX_SKILL_SCOPE_ID_LENGTH)
  ) {
    invalidRegistration("Skill owner agent id is invalid");
  }
  if (shortName !== undefined && !isSafeBoundedText(shortName, MAX_SKILL_SCOPE_ID_LENGTH)) {
    invalidRegistration("Skill short name is invalid");
  }
  if (ownerAgentId === undefined) {
    if (shortName !== undefined || metadata.name !== id) {
      invalidRegistration("Global skill id must match its metadata name");
    }
  } else if (shortName === undefined || shortName !== metadata.name) {
    invalidRegistration("Owned skill short name must match its metadata name");
  }
  if (
    skill.fsAdapter !== undefined &&
    (typeof skill.fsAdapter !== "object" || skill.fsAdapter === null)
  ) {
    invalidRegistration("Skill filesystem adapter is invalid");
  }

  return Object.freeze({
    id,
    metadata: metadataSnapshot,
    rootPath: skill.rootPath,
    ...(skill.fsAdapter !== undefined ? { fsAdapter: skill.fsAdapter as Skill["fsAdapter"] } : {}),
    ...(ownerAgentId !== undefined ? { ownerAgentId: ownerAgentId as string } : {}),
    ...(shortName !== undefined ? { shortName: shortName as string } : {}),
  });
}

function cloneSkillSnapshot(skill: Skill): Skill {
  const metadata: Skill["metadata"] = {
    name: skill.metadata.name,
    description: skill.metadata.description,
    ...(skill.metadata.allowedTools !== undefined
      ? { allowedTools: [...skill.metadata.allowedTools] }
      : {}),
    ...(skill.metadata.license !== undefined ? { license: skill.metadata.license } : {}),
    ...(skill.metadata.compatibility !== undefined
      ? { compatibility: skill.metadata.compatibility }
      : {}),
    ...(skill.metadata.metadata !== undefined ? { metadata: { ...skill.metadata.metadata } } : {}),
  };

  return {
    id: skill.id,
    metadata,
    rootPath: skill.rootPath,
    ...(skill.fsAdapter !== undefined ? { fsAdapter: skill.fsAdapter } : {}),
    ...(skill.ownerAgentId !== undefined ? { ownerAgentId: skill.ownerAgentId } : {}),
    ...(skill.shortName !== undefined ? { shortName: skill.shortName } : {}),
  };
}

const skillManager = new ProjectScopedRegistryManager<Skill>("skill");

/** Caller scope used for owner-aware capability resolution. */
export type AgentCapabilityScope = {
  /** Id of the calling agent; absent for project-level/external callers. */
  agentId?: string;
};

/** Whether a skill is visible to the caller identified by the scope. */
export function isSkillVisibleTo(skill: Skill, scope?: AgentCapabilityScope): boolean {
  try {
    return skill.ownerAgentId === undefined || skill.ownerAgentId === scope?.agentId;
  } catch {
    return false;
  }
}

class SkillRegistryClass extends ScopedRegistryFacade<Skill> {
  /** Return a detached public copy while the registry retains its immutable snapshot. */
  override get(id: string): Skill | undefined {
    const skill = super.get(id);
    return skill ? cloneSkillSnapshot(skill) : undefined;
  }

  /** Return a detached copy from the current project scope only. */
  override getOwn(id: string): Skill | undefined {
    const skill = super.getOwn(id);
    return skill ? cloneSkillSnapshot(skill) : undefined;
  }

  /** Return a detached copy from the shared registry only. */
  override getShared(id: string): Skill | undefined {
    const skill = super.getShared(id);
    return skill ? cloneSkillSnapshot(skill) : undefined;
  }

  /** Return detached public copies for every visible Skill. */
  override getAll(): Map<string, Skill> {
    return new Map(
      Array.from(super.getAll(), ([id, skill]) => [id, cloneSkillSnapshot(skill)]),
    );
  }

  private assertUniqueOwnedShortName(id: string, skill: Skill): void {
    if (skill.ownerAgentId === undefined || skill.shortName === undefined) return;
    for (const [existingId, existing] of this.getAll()) {
      if (
        existingId !== id && existing.ownerAgentId === skill.ownerAgentId &&
        existing.shortName === skill.shortName
      ) {
        invalidRegistration("Owned skills must have unique short names within an agent scope");
      }
    }
  }

  /** Register an immutable skill snapshot in the current project scope. */
  override register(id: string, skill: Skill): void {
    const snapshot = snapshotSkillRegistration(id, skill);
    this.assertUniqueOwnedShortName(id, snapshot);
    super.register(id, snapshot);
  }

  /** Register an immutable framework-provided skill snapshot. */
  override registerShared(id: string, skill: Skill): void {
    const snapshot = snapshotSkillRegistration(id, skill);
    if (snapshot.ownerAgentId !== undefined) {
      invalidRegistration("Process-wide shared skills cannot be agent-owned");
    }
    this.assertUniqueOwnedShortName(id, snapshot);
    super.registerShared(id, snapshot);
  }

  /**
   * Resolve skills for an agent configuration.
   *
   * - `true` resolves to every skill visible to the caller: unowned
   *   (project-global) skills plus the caller's own skills, never another
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
   * exact id, returning only skills visible to the caller.
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

/** Project-scoped registry for discovered and manually registered skills. */
export const skillRegistry = new SkillRegistryClass(skillManager);

/** Register a skill in the current project scope. */
export function registerSkill(id: string, skill: Skill): void {
  skillRegistry.register(id, skill);
}

/** Get a detached copy of one skill visible in the current project scope. */
export function getSkill(id: string): Skill | undefined {
  return skillRegistry.get(id);
}

/** Return detached copies of skills visible in the current project scope. */
export function getAllSkills(): Map<string, Skill> {
  return skillRegistry.getAll();
}
