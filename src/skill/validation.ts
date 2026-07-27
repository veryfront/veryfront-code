import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { snapshotAllowedToolPatterns } from "./allowed-tools.ts";
import { SKILL_ID_MAX_LENGTH, SKILL_ROOT_PATH_MAX_LENGTH } from "./limits.ts";
import {
  type Skill,
  SKILL_COMPATIBILITY_MAX_LENGTH,
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_LICENSE_MAX_LENGTH,
  SKILL_METADATA_KEY_MAX_LENGTH,
  SKILL_METADATA_MAX_ENTRIES,
  SKILL_METADATA_VALUE_MAX_LENGTH,
  SKILL_STRICT_NAME_REGEX,
  type SkillMetadata,
} from "./types.ts";
import { hasControlCharacters, isWellFormedUtf16 } from "./string-safety.ts";

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function ownDataValue(
  record: Record<string, unknown>,
  key: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) {
    throw new TypeError(`Skill field "${key}" must be a data property`);
  }
  return descriptor.value;
}

function requireBoundedString(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  if (value.length > maxLength) {
    throw new RangeError(`${field} must be at most ${maxLength} characters`);
  }
  if (!isWellFormedUtf16(value)) {
    throw new TypeError(`${field} must contain well-formed UTF-16`);
  }
  return value;
}

function requireBoundedIdentity(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  const normalized = requireBoundedString(value, field, maxLength);
  if (hasControlCharacters(normalized)) {
    throw new TypeError(`${field} must not contain control characters`);
  }
  return normalized;
}

function optionalBoundedIdentity(
  value: unknown,
  field: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  return requireBoundedIdentity(value, field, maxLength);
}

function optionalBoundedString(
  value: unknown,
  field: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  return requireBoundedString(value, field, maxLength);
}

function normalizeStringMetadata(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isObjectRecord(value)) {
    throw new TypeError("Skill metadata.metadata must be an object");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const entries = Object.entries(descriptors).filter(([, descriptor]) => descriptor.enumerable);
  if (entries.length > SKILL_METADATA_MAX_ENTRIES) {
    throw new RangeError(`Skill metadata accepts at most ${SKILL_METADATA_MAX_ENTRIES} entries`);
  }
  if (entries.length === 0) return undefined;

  const snapshot: Record<string, string> = {};
  for (const [key, descriptor] of entries) {
    if (!("value" in descriptor) || typeof descriptor.value !== "string") {
      throw new TypeError("Skill metadata values must be strings");
    }
    if (key.length === 0 || key.length > SKILL_METADATA_KEY_MAX_LENGTH) {
      throw new RangeError(
        `Skill metadata keys must be 1-${SKILL_METADATA_KEY_MAX_LENGTH} characters`,
      );
    }
    if (descriptor.value.length > SKILL_METADATA_VALUE_MAX_LENGTH) {
      throw new RangeError(
        `Skill metadata values must be at most ${SKILL_METADATA_VALUE_MAX_LENGTH} characters`,
      );
    }
    Object.defineProperty(snapshot, key, {
      configurable: false,
      enumerable: true,
      value: descriptor.value,
      writable: false,
    });
  }
  return Object.freeze(snapshot);
}

function normalizeSkillMetadata(value: unknown): SkillMetadata {
  if (!isObjectRecord(value)) {
    throw new TypeError("Skill metadata must be an object");
  }

  // Programmatic definitions historically permit a display-oriented name.
  // Filesystem discovery applies the stricter Agent Skills identifier rule.
  const name = requireBoundedIdentity(
    ownDataValue(value, "name"),
    "Skill metadata name",
    SKILL_ID_MAX_LENGTH,
  );
  const description = requireBoundedString(
    ownDataValue(value, "description"),
    "Skill metadata description",
    SKILL_DESCRIPTION_MAX_LENGTH,
  );
  const rawAllowedTools = ownDataValue(value, "allowedTools");
  if (rawAllowedTools !== undefined && !Array.isArray(rawAllowedTools)) {
    throw new TypeError("Skill metadata allowedTools must be an array");
  }
  const allowedTools = rawAllowedTools === undefined
    ? undefined
    : snapshotAllowedToolPatterns(rawAllowedTools as string[]);
  const license = optionalBoundedString(
    ownDataValue(value, "license"),
    "Skill metadata license",
    SKILL_LICENSE_MAX_LENGTH,
  );
  const compatibility = optionalBoundedString(
    ownDataValue(value, "compatibility"),
    "Skill metadata compatibility",
    SKILL_COMPATIBILITY_MAX_LENGTH,
  );
  const metadata = normalizeStringMetadata(ownDataValue(value, "metadata"));

  return Object.freeze({
    name,
    description,
    ...(allowedTools === undefined ? {} : { allowedTools }),
    ...(license === undefined ? {} : { license }),
    ...(compatibility === undefined ? {} : { compatibility }),
    ...(metadata === undefined ? {} : { metadata }),
  });
}

/**
 * Validate, detach, and freeze a skill before it crosses the registry boundary.
 * Filesystem adapters remain shared infrastructure references; all advertised
 * identity and policy metadata is captured by value.
 */
export function normalizeSkillDefinition(id: string, value: Skill): Skill {
  const registryId = requireBoundedIdentity(id, "Skill registry id", SKILL_ID_MAX_LENGTH);
  if (!isObjectRecord(value)) {
    throw new TypeError("Skill definition must be an object");
  }

  requireBoundedIdentity(
    ownDataValue(value, "id"),
    "Skill definition id",
    SKILL_ID_MAX_LENGTH,
  );

  const metadata = normalizeSkillMetadata(ownDataValue(value, "metadata"));
  const rootPath = requireBoundedIdentity(
    ownDataValue(value, "rootPath"),
    "Skill rootPath",
    SKILL_ROOT_PATH_MAX_LENGTH,
  );
  const ownerAgentId = optionalBoundedIdentity(
    ownDataValue(value, "ownerAgentId"),
    "Skill ownerAgentId",
    SKILL_ID_MAX_LENGTH,
  );
  const shortName = optionalBoundedIdentity(
    ownDataValue(value, "shortName"),
    "Skill shortName",
    64,
  );
  if (ownerAgentId === undefined && shortName !== undefined) {
    throw new TypeError("Skill shortName requires ownerAgentId");
  }
  if (shortName !== undefined && !SKILL_STRICT_NAME_REGEX.test(shortName)) {
    throw new TypeError(`Skill shortName "${shortName}" is not a valid skill name`);
  }

  const fsAdapter = ownDataValue(value, "fsAdapter");
  if (fsAdapter !== undefined && !isObjectRecord(fsAdapter)) {
    throw new TypeError("Skill fsAdapter must be an object");
  }

  return Object.freeze({
    id: registryId,
    metadata,
    rootPath,
    ...(fsAdapter === undefined ? {} : { fsAdapter: fsAdapter as unknown as FileSystemAdapter }),
    ...(ownerAgentId === undefined ? {} : { ownerAgentId }),
    ...(shortName === undefined ? {} : { shortName }),
  });
}

/**
 * Return a mutable detached public view while the registry retains its frozen
 * authorization snapshot. This preserves the historical mutable Skill API
 * without allowing callers to change registered policy.
 */
export function cloneSkillDefinition(value: Skill): Skill {
  return {
    id: value.id,
    metadata: {
      name: value.metadata.name,
      description: value.metadata.description,
      ...(value.metadata.allowedTools === undefined
        ? {}
        : { allowedTools: [...value.metadata.allowedTools] }),
      ...(value.metadata.license === undefined ? {} : { license: value.metadata.license }),
      ...(value.metadata.compatibility === undefined
        ? {}
        : { compatibility: value.metadata.compatibility }),
      ...(value.metadata.metadata === undefined
        ? {}
        : { metadata: { ...value.metadata.metadata } }),
    },
    rootPath: value.rootPath,
    ...(value.fsAdapter === undefined ? {} : { fsAdapter: value.fsAdapter }),
    ...(value.ownerAgentId === undefined ? {} : { ownerAgentId: value.ownerAgentId }),
    ...(value.shortName === undefined ? {} : { shortName: value.shortName }),
  };
}

/** Reject owner/short-name ambiguity before a registry generation is published. */
export function validateSkillRegistryCandidate(
  registry: ReadonlyMap<string, Skill>,
  id: string,
  incoming: Skill,
): void {
  if (incoming.ownerAgentId === undefined || incoming.shortName === undefined) return;

  for (const [existingId, existing] of registry) {
    if (existingId === id) continue;
    if (
      existing.ownerAgentId === incoming.ownerAgentId &&
      existing.shortName === incoming.shortName
    ) {
      throw new TypeError(
        `Agent "${incoming.ownerAgentId}" already owns skill short name "${incoming.shortName}" under id "${existingId}"`,
      );
    }
  }
}
