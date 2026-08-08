import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { isAbsolute } from "#veryfront/compat/path";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import {
  SKILL_ALLOWED_TOOL_MAX_PATTERNS,
  SKILL_ALLOWED_TOOL_PATTERN_MAX_LENGTH,
  SKILL_ID_MAX_LENGTH,
  SKILL_ROOT_PATH_MAX_LENGTH,
} from "./limits.ts";
import {
  isCanonicalAdapterRelativeSkillRoot,
  isValidProviderSafeSkillId,
  type Skill,
  SKILL_COMPATIBILITY_MAX_LENGTH,
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_LICENSE_MAX_LENGTH,
  SKILL_METADATA_KEY_MAX_LENGTH,
  SKILL_METADATA_MAX_ENTRIES,
  SKILL_METADATA_VALUE_MAX_LENGTH,
  type SkillMetadata,
} from "./types.ts";
import { hasControlCharacters, isWellFormedUtf16 } from "./string-safety.ts";

const apply = Reflect.apply;
const arrayIsArray = Array.isArray;
const defineProperty = Object.defineProperty;
const freeze = Object.freeze;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const hasOwnProperty = Object.prototype.hasOwnProperty;
const mapForEach = Map.prototype.forEach;
const NativeRangeError = RangeError;
const NativeTypeError = TypeError;
const ownKeys = Reflect.ownKeys;

function hasOwn(object: object, key: PropertyKey): boolean {
  return apply(hasOwnProperty, object, [key]) as boolean;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !arrayIsArray(value) &&
    !isProxyWithoutHooks(value);
}

function isOpaqueObjectReference(value: unknown): value is object {
  if (value === null || typeof value !== "object") return false;
  try {
    return !arrayIsArray(value);
  } catch {
    return false;
  }
}

function ownDataValue(
  record: Record<string, unknown>,
  key: string,
): unknown {
  const descriptor = getOwnPropertyDescriptor(record, key);
  if (!descriptor) return undefined;
  if (!hasOwn(descriptor, "value")) {
    throw new NativeTypeError(`Skill field "${key}" must be a data property`);
  }
  return descriptor.value;
}

function requireBoundedString(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new NativeTypeError(`${field} must be a non-empty string`);
  }
  if (value.length > maxLength) {
    throw new NativeRangeError(`${field} must be at most ${maxLength} characters`);
  }
  if (!isWellFormedUtf16(value)) {
    throw new NativeTypeError(`${field} must contain well-formed UTF-16`);
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
    throw new NativeTypeError(`${field} must not contain control characters`);
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

/**
 * Validate `allowed-tools` entries as bounded strings.
 *
 * Bounds mirror the strict parser's, so a document rejected there is not
 * silently accepted here.
 */
function normalizeAllowedToolEntries(raw: unknown[]): string[] {
  if (raw.length > SKILL_ALLOWED_TOOL_MAX_PATTERNS) {
    throw new NativeTypeError(
      `Skill metadata allowedTools must not exceed ${SKILL_ALLOWED_TOOL_MAX_PATTERNS} entries`,
    );
  }
  return raw.map((entry) => {
    if (typeof entry !== "string") {
      throw new NativeTypeError("Skill metadata allowedTools entries must be strings");
    }
    if (entry.length > SKILL_ALLOWED_TOOL_PATTERN_MAX_LENGTH) {
      throw new NativeTypeError(
        `Skill metadata allowedTools entries must not exceed ${SKILL_ALLOWED_TOOL_PATTERN_MAX_LENGTH} characters`,
      );
    }
    if (hasControlCharacters(entry) || !isWellFormedUtf16(entry)) {
      throw new NativeTypeError("Skill metadata allowedTools entries must be printable text");
    }
    return entry;
  });
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
    throw new NativeTypeError("Skill metadata.metadata must be an object");
  }
  const descriptors = getOwnPropertyDescriptors(value);
  const entries: Array<readonly [string, PropertyDescriptor]> = [];
  const descriptorKeys = ownKeys(descriptors);
  for (let index = 0; index < descriptorKeys.length; index += 1) {
    const key = descriptorKeys[index]!;
    const descriptor = descriptors[key as keyof typeof descriptors];
    if (!descriptor?.enumerable) continue;
    if (typeof key !== "string") {
      throw new NativeTypeError("Skill metadata keys must be strings");
    }
    defineProperty(entries, entries.length, {
      configurable: true,
      enumerable: true,
      value: [key, descriptor] as const,
      writable: true,
    });
  }
  if (entries.length > SKILL_METADATA_MAX_ENTRIES) {
    throw new NativeRangeError(
      `Skill metadata accepts at most ${SKILL_METADATA_MAX_ENTRIES} entries`,
    );
  }
  if (entries.length === 0) return undefined;

  const snapshot: Record<string, string> = {};
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const key = entry[0];
    const descriptor = entry[1];
    if (!hasOwn(descriptor, "value") || typeof descriptor.value !== "string") {
      throw new NativeTypeError("Skill metadata values must be strings");
    }
    if (key.length === 0 || key.length > SKILL_METADATA_KEY_MAX_LENGTH) {
      throw new NativeRangeError(
        `Skill metadata keys must be 1-${SKILL_METADATA_KEY_MAX_LENGTH} characters`,
      );
    }
    if (!isWellFormedUtf16(key) || hasControlCharacters(key)) {
      throw new NativeTypeError(
        `Skill metadata keys must be 1-${SKILL_METADATA_KEY_MAX_LENGTH} printable characters`,
      );
    }
    if (descriptor.value.length > SKILL_METADATA_VALUE_MAX_LENGTH) {
      throw new NativeRangeError(
        `Skill metadata values must be at most ${SKILL_METADATA_VALUE_MAX_LENGTH} characters`,
      );
    }
    if (!isWellFormedUtf16(descriptor.value) || hasControlCharacters(descriptor.value)) {
      throw new NativeTypeError(
        `Skill metadata values must be at most ${SKILL_METADATA_VALUE_MAX_LENGTH} printable characters`,
      );
    }
    defineProperty(snapshot, key, {
      configurable: false,
      enumerable: true,
      value: descriptor.value,
      writable: false,
    });
  }
  return freeze(snapshot);
}

function normalizeSkillMetadata(value: unknown): SkillMetadata {
  if (!isObjectRecord(value)) {
    throw new NativeTypeError("Skill metadata must be an object");
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
  const displayName = optionalBoundedIdentity(
    ownDataValue(value, "displayName"),
    "Skill metadata displayName",
    SKILL_ID_MAX_LENGTH,
  );
  const rawAllowedTools = ownDataValue(value, "allowedTools");
  if (rawAllowedTools !== undefined && !arrayIsArray(rawAllowedTools)) {
    throw new NativeTypeError("Skill metadata allowedTools must be an array");
  }
  // `allowed-tools` is spec pre-approval metadata the runtime does not enforce,
  // so entries are recorded verbatim rather than matched against a pattern
  // grammar. Not enforcing it is not a reason to stop validating its shape:
  // this value is parsed from untrusted skill files, stored, and surfaced, so
  // it still has to be strings within bounds. Dropping the grammar and dropping
  // the type check are separate decisions, and only the first was intended.
  const allowedTools = rawAllowedTools === undefined
    ? undefined
    : Object.freeze(normalizeAllowedToolEntries(rawAllowedTools)) as string[];
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

  return freeze({
    name,
    ...(displayName === undefined ? {} : { displayName }),
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
    if (isProxyWithoutHooks(value)) {
      throw new NativeTypeError("Skill definition must not be a proxy");
    }
    throw new NativeTypeError("Skill definition must be an object");
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
  const fsAdapter = ownDataValue(value, "fsAdapter");
  if (fsAdapter !== undefined && !isOpaqueObjectReference(fsAdapter)) {
    throw new NativeTypeError("Skill fsAdapter must be an object");
  }
  if (!isAbsolute(rootPath) && fsAdapter === undefined) {
    throw new NativeTypeError(
      "Skill rootPath must be absolute unless an fsAdapter owns the path namespace",
    );
  }
  if (!isAbsolute(rootPath) && !isCanonicalAdapterRelativeSkillRoot(rootPath)) {
    throw new NativeTypeError("Adapter-relative Skill rootPath must be a canonical relative path");
  }
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
    throw new NativeTypeError("Skill shortName requires ownerAgentId");
  }
  if (shortName !== undefined && !isValidProviderSafeSkillId(shortName)) {
    throw new NativeTypeError(`Skill shortName "${shortName}" is not a valid skill name`);
  }

  return freeze({
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
      ...(value.metadata.displayName === undefined
        ? {}
        : { displayName: value.metadata.displayName }),
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

  apply(mapForEach, registry, [(existing: Skill, existingId: string) => {
    if (existingId === id) return;
    if (
      existing.ownerAgentId === incoming.ownerAgentId &&
      existing.shortName === incoming.shortName
    ) {
      throw new NativeTypeError(
        `Agent "${incoming.ownerAgentId}" already owns skill short name "${incoming.shortName}" under id "${existingId}"`,
      );
    }
  }]);
}
