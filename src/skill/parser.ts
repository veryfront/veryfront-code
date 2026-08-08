/**
 * Skill frontmatter parser
 *
 * Parses SKILL.md files with YAML frontmatter.
 *
 * @module
 */

import { createError, toError } from "#veryfront/errors";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import {
  SKILL_ALLOWED_TOOL_MAX_PATTERNS,
  SKILL_ALLOWED_TOOL_PATTERN_MAX_LENGTH,
  SKILL_ID_MAX_LENGTH,
} from "./limits.ts";
import { parseBoundedSkillDocument, type ParsedSkillContent } from "./document-parser.ts";
import type { SkillDocumentParserProvider } from "../extensions/parser/skill-document-parser.ts";
import { ensureDefaultSkillDocumentParserContract } from "../extensions/parser/skill-defaults.ts";
import {
  SKILL_COMPATIBILITY_MAX_LENGTH,
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_LICENSE_MAX_LENGTH,
  SKILL_METADATA_KEY_MAX_LENGTH,
  SKILL_METADATA_MAX_ENTRIES,
  SKILL_METADATA_VALUE_MAX_LENGTH,
  type SkillMetadata,
} from "./types.ts";
import { hasControlCharacters, isWellFormedUtf16 } from "./string-safety.ts";

export type { ParsedSkillContent } from "./document-parser.ts";

const apply = Reflect.apply;
const arrayIsArray = Array.isArray;
const defineProperty = Object.defineProperty;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const numberIsSafeInteger = Number.isSafeInteger;
const objectHasOwnProperty = Object.prototype.hasOwnProperty;
const ownKeys = Reflect.ownKeys;
const NativeRegExp = RegExp;
const NativeString = String;
const regExpExec = RegExp.prototype.exec;
const stringCharCodeAt = String.prototype.charCodeAt;
const stringSlice = String.prototype.slice;
const stringTrim = String.prototype.trim;

// Keep authorization regexes private: the exported compatibility regexes are
// intentionally mutable inspection values and must not control strict parsing.
const STRICT_SKILL_NAME_REGEX = new NativeRegExp(
  "^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$",
);
const LEGACY_SKILL_NAME_REGEX = new NativeRegExp("^[a-z0-9][a-z0-9-]{0,63}$");
const PROVIDER_SAFE_SKILL_ID_REGEX = new NativeRegExp("^[A-Za-z0-9_-]{1,64}$");
const SKILL_CANONICAL_NAME_MAX_LENGTH = 64;
const SKILL_ALLOWED_TOOL_DECLARATION_MAX_LENGTH = SKILL_ALLOWED_TOOL_MAX_PATTERNS *
  (SKILL_ALLOWED_TOOL_PATTERN_MAX_LENGTH + 1);

function trim(value: string): string {
  return apply(stringTrim, value, []) as string;
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return apply(objectHasOwnProperty, value, [key]) as boolean;
}

function push<T>(values: T[], value: T): void {
  defineProperty(values, values.length, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function regexMatches(regex: RegExp, value: string): boolean {
  return apply(regExpExec, regex, [value]) !== null;
}

/** Skill descriptions are authored prose: preserve LF-delimited YAML blocks. */
function hasUnsafeDescriptionControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = apply(stringCharCodeAt, value, [index]) as number;
    if (code === 0x0a) continue;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/**
 * Parse SKILL.md content through the bounded, fail-closed format.
 * Malformed YAML, invalid Unicode, and oversized documents are rejected.
 * YAML frontmatter is decoded by the explicit provider, or by the active
 * `SkillDocumentParserProvider` registration when the argument is omitted.
 */
export async function parseSkillFrontmatter(
  content: string,
  provider?: SkillDocumentParserProvider,
): Promise<ParsedSkillContent> {
  if (provider === undefined) await ensureDefaultSkillDocumentParserContract();
  return parseBoundedSkillDocument(content, provider);
}

/**
 * Parse and bound an untrusted SKILL.md document read from a filesystem
 * boundary. YAML frontmatter is decoded by the explicit provider, or by the
 * active `SkillDocumentParserProvider` registration when the argument is
 * omitted.
 */
export async function parseSkillFileFrontmatter(
  content: string,
  provider?: SkillDocumentParserProvider,
): Promise<ParsedSkillContent> {
  if (provider === undefined) await ensureDefaultSkillDocumentParserContract();
  return parseBoundedSkillDocument(content, provider);
}

function ownDataValue(
  record: Record<string, unknown>,
  key: string,
): unknown {
  const descriptor = getOwnPropertyDescriptor(record, key);
  if (!descriptor) return undefined;
  if (!hasOwn(descriptor, "value")) {
    throw new TypeError(`Skill frontmatter field "${key}" must be a data property`);
  }
  return descriptor.value;
}

function ownDataField(
  record: Record<string, unknown>,
  key: string,
): { present: boolean; value: unknown } {
  const descriptor = getOwnPropertyDescriptor(record, key);
  if (!descriptor) return { present: false, value: undefined };
  if (!hasOwn(descriptor, "value")) {
    throw new TypeError(`Skill frontmatter field "${key}" must be a data property`);
  }
  return { present: true, value: descriptor.value };
}

function optionalBoundedString(
  value: unknown,
  field: string,
  maxLength: number,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new TypeError(`Skill ${field} must be a string`);
  }
  if (value.length > maxLength) {
    throw new RangeError(`Skill ${field} exceeds ${maxLength} characters`);
  }
  if (!isWellFormedUtf16(value) || hasControlCharacters(value)) {
    throw new TypeError(
      `Skill ${field} must contain well-formed UTF-16 without control characters`,
    );
  }
  const normalized = trim(value);
  return normalized || undefined;
}

function captureProviderSafeNameOption(
  options: { providerSafeName?: boolean },
): boolean {
  if (
    options === null ||
    (typeof options !== "object" && typeof options !== "function")
  ) {
    throw new TypeError("Skill metadata validation options must be an object");
  }
  if (isProxyWithoutHooks(options)) {
    throw new TypeError("Skill metadata validation options must not be a proxy");
  }
  if (typeof options !== "object" || arrayIsArray(options)) {
    throw new TypeError("Skill metadata validation options must be an object");
  }

  const field = ownDataField(
    options as Record<string, unknown>,
    "providerSafeName",
  );
  if (!field.present || field.value === undefined) return false;
  if (typeof field.value !== "boolean") {
    throw new TypeError("Skill providerSafeName option must be a boolean");
  }
  return field.value;
}

/**
 * Validate and normalize parsed frontmatter into SkillMetadata.
 *
 * @param frontmatter - Parsed frontmatter object
 * @param directoryName - Canonical directory/runtime identity for the skill
 */
export function validateSkillMetadata(
  frontmatter: Record<string, unknown>,
  directoryName: string,
  options: { providerSafeName?: boolean } = {},
): SkillMetadata {
  if (
    frontmatter === null ||
    (typeof frontmatter !== "object" && typeof frontmatter !== "function")
  ) {
    throw new TypeError("Skill frontmatter must be an object");
  }
  if (isProxyWithoutHooks(frontmatter)) {
    throw new TypeError("Skill frontmatter must not be a proxy");
  }
  if (typeof frontmatter !== "object" || arrayIsArray(frontmatter)) {
    throw new TypeError("Skill frontmatter must be an object");
  }
  if (typeof directoryName !== "string") {
    throw new TypeError("Skill canonical name must be a string");
  }

  const providerSafeName = captureProviderSafeNameOption(options);
  const nameRegex = providerSafeName ? PROVIDER_SAFE_SKILL_ID_REGEX : LEGACY_SKILL_NAME_REGEX;
  const nameExpectation = providerSafeName
    ? "must be provider-safe letters, numbers, underscores, or hyphens, 1-64 characters"
    : "must be lowercase alphanumeric with hyphens, 1-64 characters";
  if (!regexMatches(nameRegex, directoryName)) {
    throw toError(
      createError({
        type: "agent",
        message: `Invalid skill name: ${nameExpectation}`,
      }),
    );
  }

  const declaredName = ownDataValue(frontmatter, "name");
  const rawName = typeof declaredName === "string" ? trim(declaredName) : undefined;
  if (
    rawName !== undefined &&
    (!isWellFormedUtf16(rawName) || hasControlCharacters(rawName))
  ) {
    throw new TypeError(
      "Skill display name must contain well-formed UTF-16 without control characters",
    );
  }

  const rawDescription = ownDataValue(frontmatter, "description");
  if (typeof rawDescription !== "string" || trim(rawDescription).length === 0) {
    throw toError(
      createError({
        type: "agent",
        message: `Skill "${directoryName}" is missing a required "description" field`,
      }),
    );
  }
  if (
    !isWellFormedUtf16(rawDescription) ||
    hasUnsafeDescriptionControlCharacters(rawDescription)
  ) {
    throw new TypeError(
      "Skill description must contain well-formed UTF-16 and no control characters other than line feeds",
    );
  }
  const description = apply(stringSlice, trim(rawDescription), [
    0,
    SKILL_DESCRIPTION_MAX_LENGTH,
  ]) as string;

  const allowedToolPatterns = ownDataValue(frontmatter, "allowed-tools") ??
    ownDataValue(frontmatter, "allowed_tools");
  const allowedTools = parseLegacyAllowedTools(allowedToolPatterns, directoryName);
  const license = optionalLegacyString(ownDataValue(frontmatter, "license"), "license");
  const compatibility = optionalLegacyString(
    ownDataValue(frontmatter, "compatibility"),
    "compatibility",
  );
  const metadata = parseLegacyMetadata(ownDataValue(frontmatter, "metadata"));
  const explicitDisplayName = validateLegacyDisplayName(getMetadataDisplayName(metadata));
  const legacyDisplayName = rawName && rawName !== directoryName ? rawName : undefined;
  const displayName = explicitDisplayName ?? legacyDisplayName;

  return {
    name: directoryName,
    ...(displayName ? { displayName } : {}),
    description,
    ...(allowedTools ? { allowedTools } : {}),
    ...(license ? { license } : {}),
    ...(compatibility ? { compatibility } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function optionalLegacyString(value: unknown, field: string): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!isWellFormedUtf16(value) || hasControlCharacters(value)) {
    throw new TypeError(
      `Skill ${field} must contain well-formed UTF-16 without control characters`,
    );
  }
  const normalized = trim(value);
  return normalized || undefined;
}

function validateLegacyDisplayName(displayName: string | undefined): string | undefined {
  if (displayName === undefined) return undefined;
  if (!isWellFormedUtf16(displayName) || hasControlCharacters(displayName)) {
    throw new TypeError(
      "Skill display name must contain well-formed UTF-16 without control characters",
    );
  }
  return displayName;
}

/** Validate bounded, untrusted skill metadata at filesystem boundaries. */
function validateStrictSkillMetadata(
  frontmatter: Record<string, unknown>,
  canonicalName: string,
  options: { providerSafeName?: boolean },
): SkillMetadata {
  if (
    frontmatter === null ||
    (typeof frontmatter !== "object" && typeof frontmatter !== "function")
  ) {
    throw new TypeError("Skill frontmatter must be an object");
  }
  if (isProxyWithoutHooks(frontmatter)) {
    throw new TypeError("Skill frontmatter must not be a proxy");
  }
  if (typeof frontmatter !== "object" || arrayIsArray(frontmatter)) {
    throw new TypeError("Skill frontmatter must be an object");
  }
  if (typeof canonicalName !== "string") {
    throw new TypeError("Skill canonical name must be a string");
  }
  if (canonicalName.length > SKILL_CANONICAL_NAME_MAX_LENGTH) {
    throw toError(
      createError({
        type: "agent",
        message: `Invalid skill name: exceeds ${SKILL_CANONICAL_NAME_MAX_LENGTH} characters`,
      }),
    );
  }

  const providerSafeName = captureProviderSafeNameOption(options);
  const nameRegex = providerSafeName ? PROVIDER_SAFE_SKILL_ID_REGEX : STRICT_SKILL_NAME_REGEX;
  const nameExpectation = providerSafeName
    ? "must be provider-safe letters, numbers, underscores, or hyphens, 1-64 characters"
    : "must be 1-64 lowercase alphanumeric characters or single hyphens, without leading or trailing hyphens";
  if (!regexMatches(nameRegex, canonicalName)) {
    throw toError(
      createError({
        type: "agent",
        message: `Invalid skill name: ${nameExpectation}`,
      }),
    );
  }

  // The caller-supplied directory/runtime id is the only lookup identity.
  // A differing authored name is retained as presentation metadata.
  const declaredName = ownDataValue(frontmatter, "name");
  if (typeof declaredName !== "string") {
    throw new TypeError(
      `Skill "${canonicalName}" is missing required field "name"`,
    );
  }
  if (declaredName.length > SKILL_ID_MAX_LENGTH) {
    throw new RangeError(
      `Skill name exceeds ${SKILL_ID_MAX_LENGTH} characters`,
    );
  }
  const authoredName = trim(declaredName);
  if (authoredName.length === 0) {
    throw new TypeError(
      `Skill "${canonicalName}" is missing required field "name"`,
    );
  }
  if (!isWellFormedUtf16(authoredName) || hasControlCharacters(authoredName)) {
    throw new TypeError(
      "Skill name must contain well-formed UTF-16 without control characters",
    );
  }

  // Description: required
  const rawDescription = ownDataValue(frontmatter, "description");
  if (typeof rawDescription !== "string") {
    throw toError(
      createError({
        type: "agent",
        message: `Skill "${canonicalName}" is missing a required "description" field`,
      }),
    );
  }
  if (rawDescription.length > SKILL_DESCRIPTION_MAX_LENGTH) {
    throw new RangeError(
      `Skill "${canonicalName}" description exceeds ${SKILL_DESCRIPTION_MAX_LENGTH} characters`,
    );
  }
  if (
    !isWellFormedUtf16(rawDescription) ||
    hasUnsafeDescriptionControlCharacters(rawDescription)
  ) {
    throw new TypeError(
      "Skill description must contain well-formed UTF-16 and no control characters other than line feeds",
    );
  }

  const description = trim(rawDescription);
  if (description.length === 0) {
    throw toError(
      createError({
        type: "agent",
        message: `Skill "${canonicalName}" is missing a required "description" field`,
      }),
    );
  }
  // Allowed-tools: parse from space-delimited string or array
  const canonicalAllowedTools = ownDataField(frontmatter, "allowed-tools");
  const compatibilityAllowedTools = ownDataField(frontmatter, "allowed_tools");
  if (canonicalAllowedTools.present && compatibilityAllowedTools.present) {
    throw new TypeError(
      `Skill "${canonicalName}" must not declare both "allowed-tools" and "allowed_tools"`,
    );
  }
  const hasAllowedTools = canonicalAllowedTools.present || compatibilityAllowedTools.present;
  const allowedToolPatterns = canonicalAllowedTools.present
    ? canonicalAllowedTools.value
    : compatibilityAllowedTools.value;
  const allowedTools = hasAllowedTools
    ? parseStrictAllowedTools(allowedToolPatterns, canonicalName)
    : undefined;

  const license = optionalBoundedString(
    ownDataValue(frontmatter, "license"),
    "license",
    SKILL_LICENSE_MAX_LENGTH,
  );
  const compatibility = optionalBoundedString(
    ownDataValue(frontmatter, "compatibility"),
    "compatibility",
    SKILL_COMPATIBILITY_MAX_LENGTH,
  );

  const metadata = parseStrictMetadata(ownDataValue(frontmatter, "metadata"));
  const explicitDisplayName = validateStrictDisplayName(getMetadataDisplayName(metadata));
  const legacyDisplayName = authoredName !== canonicalName ? authoredName : undefined;
  const displayName = explicitDisplayName ?? legacyDisplayName;

  return {
    name: canonicalName,
    ...(displayName ? { displayName } : {}),
    description,
    ...(allowedTools && { allowedTools }),
    ...(license && { license }),
    ...(compatibility && { compatibility }),
    ...(metadata && { metadata }),
  };
}

/**
 * Validate metadata loaded from a filesystem skill. The caller-supplied
 * directory/runtime identity remains canonical; a differing authored `name`
 * is display metadata and never participates in lookup or authorization.
 */
export function validateSkillFileMetadata(
  frontmatter: Record<string, unknown>,
  directoryName: string,
  options: { providerSafeName?: boolean } = {},
): SkillMetadata {
  return validateStrictSkillMetadata(frontmatter, directoryName, options);
}

function getMetadataDisplayName(metadata: Record<string, string> | undefined): string | undefined {
  if (!metadata) return undefined;
  const rawDisplayName = ownDataValue(metadata, "display_name");
  const displayName = typeof rawDisplayName === "string" ? trim(rawDisplayName) : undefined;
  return displayName ? displayName : undefined;
}

function validateStrictDisplayName(displayName: string | undefined): string | undefined {
  if (displayName === undefined) return undefined;
  if (displayName.length > SKILL_ID_MAX_LENGTH) {
    throw new RangeError(`Skill display name exceeds ${SKILL_ID_MAX_LENGTH} characters`);
  }
  if (!isWellFormedUtf16(displayName) || hasControlCharacters(displayName)) {
    throw new TypeError(
      "Skill display name must contain well-formed UTF-16 without control characters",
    );
  }
  return displayName;
}

/** Preserve the historical public allowed-tools shape outside file boundaries. */
function parseLegacyAllowedTools(
  value: unknown,
  skillName: string,
): string[] | undefined {
  if (value === undefined || value === null) return undefined;

  let patterns: string[];
  if (typeof value === "string") {
    patterns = parseLegacyAllowedToolString(value);
  } else {
    if (
      (typeof value === "object" || typeof value === "function") &&
      isProxyWithoutHooks(value)
    ) {
      throw new TypeError(`Skill "${skillName}" allowed-tools must not be a proxy`);
    }
    if (!arrayIsArray(value)) {
      throw toError(
        createError({
          type: "agent",
          message:
            `Skill "${skillName}" has invalid allowed-tools value: expected a string or array of strings, got ${typeof value}`,
        }),
      );
    }

    const lengthDescriptor = getOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor && hasOwn(lengthDescriptor, "value")
      ? lengthDescriptor.value
      : undefined;
    if (typeof length !== "number" || !numberIsSafeInteger(length) || length < 0) {
      throw new TypeError(`Skill "${skillName}" allowed-tools length must be a data property`);
    }

    patterns = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = getOwnPropertyDescriptor(value, index);
      if (!descriptor || !hasOwn(descriptor, "value")) {
        throw new TypeError(
          `Skill "${skillName}" allowed-tools entry ${index} must be a data property`,
        );
      }
      const rawPattern = descriptor.value;
      if (typeof rawPattern !== "string") {
        throw toError(
          createError({
            type: "agent",
            message:
              `Skill "${skillName}" has invalid allowed-tools value: expected all entries to be strings`,
          }),
        );
      }
      const pattern = trim(rawPattern);
      if (!pattern) {
        throw toError(
          createError({
            type: "agent",
            message: `Skill "${skillName}" has invalid allowed-tools pattern: empty value`,
          }),
        );
      }
      push(patterns, pattern);
    }
  }

  if (patterns.length === 0) return undefined;
  // Patterns are recorded verbatim. `allowed-tools` is pre-approval metadata in the
  // Agent Skills spec, not an authorization boundary, so the runtime does not act on
  // it and must not reject spec-conformant values such as `Bash(git:*)`.
  return patterns;
}

function parseLegacyAllowedToolString(value: string): string[] {
  const patterns: string[] = [];
  let index = 0;
  while (index < value.length) {
    while (index < value.length && isWhitespaceAt(value, index)) index += 1;
    if (index >= value.length) break;

    const start = index;
    while (index < value.length && !isWhitespaceAt(value, index)) index += 1;
    push(patterns, apply(stringSlice, value, [start, index]) as string);
  }
  return patterns;
}

/** Safely coerce primitive metadata values through the historical public API. */
function parseLegacyMetadata(
  value: unknown,
): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" && typeof value !== "function") return undefined;
  if (isProxyWithoutHooks(value)) {
    throw new TypeError("Skill metadata must not be a proxy");
  }
  if (typeof value !== "object" || arrayIsArray(value)) return undefined;

  const keys = ownKeys(value);
  const result: Record<string, string> = {};
  let hasEnumerableEntries = false;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== "string") continue;
    const descriptor = getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable) continue;
    if (!hasOwn(descriptor, "value")) {
      throw new TypeError("Skill metadata values must be own data properties");
    }
    if (!isWellFormedUtf16(key) || hasControlCharacters(key)) {
      throw new TypeError("Skill metadata keys must not contain control characters");
    }
    const rawValue = descriptor.value;
    if (
      rawValue !== null &&
      (typeof rawValue === "object" || typeof rawValue === "function")
    ) {
      throw new TypeError("Skill metadata compatibility values must be primitive");
    }
    const metadataValue = NativeString(rawValue);
    if (!isWellFormedUtf16(metadataValue) || hasControlCharacters(metadataValue)) {
      throw new TypeError("Skill metadata values must not contain control characters");
    }
    hasEnumerableEntries = true;
    defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: metadataValue,
      writable: true,
    });
  }
  return hasEnumerableEntries ? result : undefined;
}

/** Parse and bound allowed tools declared by an untrusted skill file. */
function parseStrictAllowedTools(
  value: unknown,
  skillName: string,
): string[] | undefined {
  if (value === undefined || value === null) {
    throw new TypeError("Allowed-tools must be a string or array of strings");
  }

  let patterns: string[];

  if (typeof value === "string") {
    patterns = parseStrictAllowedToolString(value);
  } else {
    if (
      (typeof value === "object" || typeof value === "function") &&
      isProxyWithoutHooks(value)
    ) {
      throw new TypeError(`Skill "${skillName}" allowed-tools must not be a proxy`);
    }
    if (!arrayIsArray(value)) {
      throw toError(
        createError({
          type: "agent",
          message:
            `Skill "${skillName}" has invalid allowed-tools value: expected a string or array of strings, got ${typeof value}`,
        }),
      );
    }

    const lengthDescriptor = getOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor && hasOwn(lengthDescriptor, "value")
      ? lengthDescriptor.value
      : undefined;
    if (typeof length !== "number" || !numberIsSafeInteger(length) || length < 0) {
      throw new TypeError(`Skill "${skillName}" allowed-tools length must be a data property`);
    }
    if (length > SKILL_ALLOWED_TOOL_MAX_PATTERNS) {
      throw new RangeError(
        `Allowed-tools accepts at most ${SKILL_ALLOWED_TOOL_MAX_PATTERNS} patterns`,
      );
    }

    patterns = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = getOwnPropertyDescriptor(value, index);
      if (!descriptor || !hasOwn(descriptor, "value")) {
        throw new TypeError(
          `Skill "${skillName}" allowed-tools entry ${index} must be a data property`,
        );
      }
      const rawPattern = descriptor.value;
      if (typeof rawPattern !== "string") {
        throw toError(
          createError({
            type: "agent",
            message:
              `Skill "${skillName}" has invalid allowed-tools value: expected all entries to be strings`,
          }),
        );
      }
      if (rawPattern.length > SKILL_ALLOWED_TOOL_PATTERN_MAX_LENGTH) {
        throw new RangeError(
          `Allowed-tools patterns must be at most ${SKILL_ALLOWED_TOOL_PATTERN_MAX_LENGTH} characters`,
        );
      }
      const pattern = trim(rawPattern);
      if (!pattern) {
        throw toError(
          createError({
            type: "agent",
            message: `Skill "${skillName}" has invalid allowed-tools pattern: empty value`,
          }),
        );
      }
      push(patterns, pattern);
    }
  }

  return patterns;
}

function parseStrictAllowedToolString(value: string): string[] {
  if (value.length > SKILL_ALLOWED_TOOL_DECLARATION_MAX_LENGTH) {
    throw new RangeError(
      `Allowed-tools declaration exceeds ${SKILL_ALLOWED_TOOL_DECLARATION_MAX_LENGTH} characters`,
    );
  }

  const patterns: string[] = [];
  let index = 0;
  while (index < value.length) {
    while (index < value.length && isWhitespaceAt(value, index)) index += 1;
    if (index >= value.length) break;

    const start = index;
    while (index < value.length && !isWhitespaceAt(value, index)) {
      index += 1;
      if (index - start > SKILL_ALLOWED_TOOL_PATTERN_MAX_LENGTH) {
        throw new RangeError(
          `Allowed-tools patterns must be at most ${SKILL_ALLOWED_TOOL_PATTERN_MAX_LENGTH} characters`,
        );
      }
    }
    if (patterns.length >= SKILL_ALLOWED_TOOL_MAX_PATTERNS) {
      throw new RangeError(
        `Allowed-tools accepts at most ${SKILL_ALLOWED_TOOL_MAX_PATTERNS} patterns`,
      );
    }
    push(patterns, apply(stringSlice, value, [start, index]) as string);
  }
  return patterns;
}

function isWhitespaceAt(value: string, index: number): boolean {
  const code = apply(stringCharCodeAt, value, [index]) as number;
  return (
    (code >= 0x0009 && code <= 0x000d) ||
    code === 0x0020 ||
    code === 0x00a0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

/** Validate optional string-to-string metadata without coercing caller values. */
function parseStrictMetadata(
  value: unknown,
): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" && typeof value !== "function") {
    throw new TypeError("Skill metadata must be an object with string values");
  }
  if (isProxyWithoutHooks(value)) {
    throw new TypeError("Skill metadata must not be a proxy");
  }
  if (typeof value !== "object" || arrayIsArray(value)) {
    throw new TypeError("Skill metadata must be an object with string values");
  }

  const keys = ownKeys(value);
  if (keys.length > SKILL_METADATA_MAX_ENTRIES) {
    throw new RangeError(`Skill metadata accepts at most ${SKILL_METADATA_MAX_ENTRIES} entries`);
  }
  if (keys.length === 0) return undefined;

  const result: Record<string, string> = {};
  let hasEnumerableEntries = false;
  for (let index = 0; index < keys.length; index += 1) {
    const k = keys[index];
    if (typeof k !== "string") {
      throw new TypeError("Skill metadata keys must be strings");
    }
    const descriptor = getOwnPropertyDescriptor(value, k);
    if (!descriptor) {
      throw new TypeError("Skill metadata entries must be own data properties");
    }
    if (!descriptor.enumerable) continue;
    hasEnumerableEntries = true;
    if (k.length === 0 || k.length > SKILL_METADATA_KEY_MAX_LENGTH) {
      throw new RangeError(
        `Skill metadata keys must be 1-${SKILL_METADATA_KEY_MAX_LENGTH} characters`,
      );
    }
    if (!isWellFormedUtf16(k) || hasControlCharacters(k)) {
      throw new TypeError(
        `Skill metadata keys must be 1-${SKILL_METADATA_KEY_MAX_LENGTH} printable characters`,
      );
    }
    if (!hasOwn(descriptor, "value")) {
      throw new TypeError("Skill metadata values must be own data properties");
    }
    if (typeof descriptor.value !== "string") {
      throw new TypeError("Skill metadata values must be strings");
    }
    const metadataValue = descriptor.value;
    if (metadataValue.length > SKILL_METADATA_VALUE_MAX_LENGTH) {
      throw new RangeError(
        `Skill metadata values must be at most ${SKILL_METADATA_VALUE_MAX_LENGTH} characters`,
      );
    }
    if (!isWellFormedUtf16(metadataValue) || hasControlCharacters(metadataValue)) {
      throw new TypeError(
        `Skill metadata values must be at most ${SKILL_METADATA_VALUE_MAX_LENGTH} printable characters`,
      );
    }
    // Assignment treats `__proto__` specially on ordinary objects and would
    // silently drop an otherwise valid metadata key. Define an own data
    // property so every admitted string key round-trips exactly.
    defineProperty(result, k, {
      configurable: true,
      enumerable: true,
      value: metadataValue,
      writable: true,
    });
  }
  return hasEnumerableEntries ? result : undefined;
}
