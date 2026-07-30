/**
 * Skill frontmatter parser
 *
 * Parses SKILL.md files with YAML frontmatter.
 *
 * @module
 */

import { createError, toError } from "#veryfront/errors";
import { validateAllowedToolPatterns, validateStrictAllowedToolPatterns } from "./allowed-tools.ts";
import { SKILL_DOCUMENT_MAX_CHARACTERS, SKILL_ID_MAX_LENGTH } from "./limits.ts";
import {
  SKILL_COMPATIBILITY_MAX_LENGTH,
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_LICENSE_MAX_LENGTH,
  SKILL_METADATA_KEY_MAX_LENGTH,
  SKILL_METADATA_MAX_ENTRIES,
  SKILL_METADATA_VALUE_MAX_LENGTH,
  SKILL_NAME_REGEX,
  SKILL_PROVIDER_SAFE_ID_REGEX,
  SKILL_STRICT_NAME_REGEX,
  type SkillMetadata,
} from "./types.ts";
import { hasControlCharacters, isWellFormedUtf16 } from "./string-safety.ts";

/** Result of parsing a SKILL.md file */
interface ParsedSkillContent {
  frontmatter: Record<string, unknown>;
  body: string;
}

/**
 * Parse SKILL.md content through the bounded, fail-closed format.
 * Malformed YAML, invalid Unicode, and oversized documents are rejected.
 */
export async function parseSkillFrontmatter(content: string): Promise<ParsedSkillContent> {
  return await parseSkillFileFrontmatter(content);
}

/**
 * Parse using the historical unbounded, lossy YAML fallback.
 *
 * @deprecated This parser can reinterpret malformed YAML. Use
 * {@link parseSkillFrontmatter} or {@link parseSkillFileFrontmatter}.
 */
export async function parseUnsafeLegacySkillFrontmatter(
  content: string,
): Promise<ParsedSkillContent> {
  try {
    const { extract } = await import("#std/front-matter/yaml.ts");
    const result = extract<Record<string, unknown>>(content);
    return { frontmatter: result.attrs, body: result.body };
  } catch {
    return parseFrontmatterFallback(content);
  }
}

/** Parse and bound an untrusted SKILL.md document read from a filesystem boundary. */
export async function parseSkillFileFrontmatter(content: string): Promise<ParsedSkillContent> {
  if (typeof content !== "string") {
    throw new TypeError("Skill document content must be a string");
  }
  if (!isWellFormedUtf16(content)) {
    throw new TypeError("Skill document content must contain well-formed UTF-16");
  }
  if (content.length > SKILL_DOCUMENT_MAX_CHARACTERS) {
    throw new RangeError(
      `Skill document exceeds ${SKILL_DOCUMENT_MAX_CHARACTERS} characters`,
    );
  }

  const { extract } = await import("#std/front-matter/yaml.ts");
  const result = extract<Record<string, unknown>>(content);
  return { frontmatter: result.attrs, body: result.body };
}

function parseFrontmatterFallback(content: string): ParsedSkillContent {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const rawFrontmatter = match[1] ?? "";
  const body = match[2] ?? "";
  const frontmatter: Record<string, unknown> = {};

  for (const line of rawFrontmatter.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    const value = trimmed.slice(colonIndex + 1).trim();
    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

function ownDataValue(
  record: Record<string, unknown>,
  key: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) {
    throw new TypeError(`Skill frontmatter field "${key}" must be a data property`);
  }
  return descriptor.value;
}

function ownDataField(
  record: Record<string, unknown>,
  key: string,
): { present: boolean; value: unknown } {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor) return { present: false, value: undefined };
  if (!("value" in descriptor)) {
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
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new RangeError(`Skill ${field} exceeds ${maxLength} characters`);
  }
  return normalized || undefined;
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
  const canonicalName = directoryName;
  const nameRegex = options.providerSafeName ? SKILL_PROVIDER_SAFE_ID_REGEX : SKILL_NAME_REGEX;
  const nameExpectation = options.providerSafeName
    ? "must be provider-safe letters, numbers, underscores, or hyphens, 1-64 characters"
    : "must be lowercase alphanumeric with hyphens, 1-64 characters";

  if (!nameRegex.test(canonicalName)) {
    throw toError(
      createError({
        type: "agent",
        message: `Invalid skill name "${canonicalName}": ${nameExpectation}`,
      }),
    );
  }

  const rawName = typeof frontmatter.name === "string" ? frontmatter.name.trim() : undefined;

  const rawDescription = frontmatter.description;
  if (!rawDescription || typeof rawDescription !== "string" || !rawDescription.trim()) {
    throw toError(
      createError({
        type: "agent",
        message: `Skill "${canonicalName}" is missing a required "description" field`,
      }),
    );
  }

  const description = rawDescription.trim().slice(0, SKILL_DESCRIPTION_MAX_LENGTH);
  const allowedToolPatterns = frontmatter["allowed-tools"] ?? frontmatter.allowed_tools;
  const allowedTools = parseAllowedTools(allowedToolPatterns, canonicalName);
  const license = typeof frontmatter.license === "string" ? frontmatter.license.trim() : undefined;
  const compatibility = typeof frontmatter.compatibility === "string"
    ? frontmatter.compatibility.trim()
    : undefined;
  const metadata = parseMetadata(frontmatter.metadata);
  const explicitDisplayName = getMetadataDisplayName(metadata);
  const legacyDisplayName = rawName && rawName !== canonicalName ? rawName : undefined;
  const displayName = explicitDisplayName ?? legacyDisplayName;

  return {
    name: canonicalName,
    ...(displayName && { displayName }),
    description,
    ...(allowedTools && { allowedTools }),
    ...(license && { license }),
    ...(compatibility && { compatibility }),
    ...(metadata && { metadata }),
  };
}

/** Validate bounded, untrusted skill metadata at filesystem boundaries. */
function validateStrictSkillMetadata(
  frontmatter: Record<string, unknown>,
  canonicalName: string,
  options: { providerSafeName?: boolean },
): SkillMetadata {
  if (
    !frontmatter ||
    typeof frontmatter !== "object" ||
    Array.isArray(frontmatter)
  ) {
    throw new TypeError("Skill frontmatter must be an object");
  }
  if (typeof canonicalName !== "string") {
    throw new TypeError("Skill canonical name must be a string");
  }

  const nameRegex = options.providerSafeName
    ? SKILL_PROVIDER_SAFE_ID_REGEX
    : SKILL_STRICT_NAME_REGEX;
  const nameExpectation = options.providerSafeName
    ? "must be provider-safe letters, numbers, underscores, or hyphens, 1-64 characters"
    : "must be 1-64 lowercase alphanumeric characters or single hyphens, without leading or trailing hyphens";
  if (!nameRegex.test(canonicalName)) {
    throw toError(
      createError({
        type: "agent",
        message: `Invalid skill name "${canonicalName}": ${nameExpectation}`,
      }),
    );
  }

  // The caller-supplied directory/runtime id is the only lookup identity.
  // A differing authored name is retained as presentation metadata.
  const declaredName = ownDataValue(frontmatter, "name");
  if (typeof declaredName !== "string" || declaredName.trim().length === 0) {
    throw new TypeError(
      `Skill "${canonicalName}" is missing required field "name"`,
    );
  }
  const authoredName = declaredName.trim();
  if (authoredName.length > SKILL_ID_MAX_LENGTH) {
    throw new RangeError(
      `Skill name exceeds ${SKILL_ID_MAX_LENGTH} characters`,
    );
  }
  if (!isWellFormedUtf16(authoredName) || hasControlCharacters(authoredName)) {
    throw new TypeError(
      "Skill name must contain well-formed UTF-16 without control characters",
    );
  }

  // Description: required
  const rawDescription = ownDataValue(frontmatter, "description");
  if (!rawDescription || typeof rawDescription !== "string" || !rawDescription.trim()) {
    throw toError(
      createError({
        type: "agent",
        message: `Skill "${canonicalName}" is missing a required "description" field`,
      }),
    );
  }

  const description = rawDescription.trim();
  if (description.length > SKILL_DESCRIPTION_MAX_LENGTH) {
    throw new RangeError(
      `Skill "${canonicalName}" description exceeds ${SKILL_DESCRIPTION_MAX_LENGTH} characters`,
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
  const displayName = metadata?.display_name?.trim();
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

/**
 * Parse `allowed-tools` from frontmatter.
 * Accepts a space-delimited string or an array of strings.
 * Validates each pattern against SKILL_ALLOWED_TOOL_PATTERN_REGEX.
 */
function parseAllowedTools(
  value: unknown,
  skillName: string,
): string[] | undefined {
  if (value === undefined || value === null) return undefined;

  let patterns: string[];

  if (typeof value === "string") {
    patterns = value.split(/\s+/).filter(Boolean);
  } else if (Array.isArray(value)) {
    patterns = [];
    for (const rawPattern of value) {
      if (typeof rawPattern !== "string") {
        throw toError(
          createError({
            type: "agent",
            message:
              `Skill "${skillName}" has invalid allowed-tools value: expected all entries to be strings`,
          }),
        );
      }
      const pattern = rawPattern.trim();
      if (!pattern) {
        throw toError(
          createError({
            type: "agent",
            message: `Skill "${skillName}" has invalid allowed-tools pattern: empty value`,
          }),
        );
      }
      patterns.push(pattern);
    }
  } else {
    throw toError(
      createError({
        type: "agent",
        message:
          `Skill "${skillName}" has invalid allowed-tools value: expected a string or array of strings, got ${typeof value}`,
      }),
    );
  }

  if (patterns.length === 0) return undefined;

  try {
    return validateAllowedToolPatterns(patterns);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw toError(
      createError({
        type: "agent",
        message: `Skill "${skillName}" has ${message.charAt(0).toLowerCase()}${message.slice(1)}`,
      }),
    );
  }
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
    patterns = value.split(/\s+/).filter(Boolean);
  } else if (Array.isArray(value)) {
    patterns = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      if (!descriptor || !("value" in descriptor)) {
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
      const pattern = rawPattern.trim();
      if (!pattern) {
        throw toError(
          createError({
            type: "agent",
            message: `Skill "${skillName}" has invalid allowed-tools pattern: empty value`,
          }),
        );
      }
      patterns.push(pattern);
    }
  } else {
    throw toError(
      createError({
        type: "agent",
        message:
          `Skill "${skillName}" has invalid allowed-tools value: expected a string or array of strings, got ${typeof value}`,
      }),
    );
  }

  try {
    return validateStrictAllowedToolPatterns([...patterns]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw toError(
      createError({
        type: "agent",
        message: `Skill "${skillName}" has ${message.charAt(0).toLowerCase()}${message.slice(1)}`,
      }),
    );
  }
}

/** Convert metadata object values to strings through the historical public contract. */
function parseMetadata(
  value: unknown,
): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return undefined;

  const result: Record<string, string> = {};
  for (const [key, metadataValue] of entries) {
    result[key] = String(metadataValue);
  }
  return result;
}

/** Validate optional string-to-string metadata without coercing caller values. */
function parseStrictMetadata(
  value: unknown,
): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Skill metadata must be an object with string values");
  }

  const entries = Object.entries(
    Object.getOwnPropertyDescriptors(value),
  ).filter(([, descriptor]) => descriptor.enumerable);
  if (entries.length === 0) return undefined;
  if (entries.length > SKILL_METADATA_MAX_ENTRIES) {
    throw new RangeError(`Skill metadata accepts at most ${SKILL_METADATA_MAX_ENTRIES} entries`);
  }

  const result: Record<string, string> = {};
  for (const [k, descriptor] of entries) {
    if (k.length === 0 || k.length > SKILL_METADATA_KEY_MAX_LENGTH) {
      throw new RangeError(
        `Skill metadata keys must be 1-${SKILL_METADATA_KEY_MAX_LENGTH} characters`,
      );
    }
    if (!("value" in descriptor) || typeof descriptor.value !== "string") {
      throw new TypeError("Skill metadata values must be strings");
    }
    const metadataValue = descriptor.value;
    if (metadataValue.length > SKILL_METADATA_VALUE_MAX_LENGTH) {
      throw new RangeError(
        `Skill metadata values must be at most ${SKILL_METADATA_VALUE_MAX_LENGTH} characters`,
      );
    }
    result[k] = metadataValue;
  }
  return result;
}
