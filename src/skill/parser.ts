/**
 * Skill frontmatter parser
 *
 * Parses SKILL.md files with YAML frontmatter.
 *
 * @module
 */

import { extract } from "#std/front-matter/yaml.ts";
import { createError, toError } from "#veryfront/errors";
import { validateAllowedToolPatterns } from "./allowed-tools.ts";
import {
  SKILL_COMPATIBILITY_MAX_LENGTH,
  SKILL_DEFINITION_MAX_BYTES,
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_NAME_REGEX,
  type SkillMetadata,
} from "./types.ts";

/** Result of parsing a SKILL.md file */
export interface ParsedSkillContent {
  /** Parsed YAML frontmatter fields. */
  frontmatter: Record<string, unknown>;
  /** Markdown content following the frontmatter. */
  body: string;
}

const MAX_FRONTMATTER_FIELDS = 64;
const MAX_ALLOWED_TOOLS_TEXT_LENGTH = 65_536;
const MAX_LICENSE_LENGTH = 500;
const MAX_METADATA_ENTRIES = 64;
const MAX_METADATA_KEY_LENGTH = 128;
const MAX_METADATA_VALUE_LENGTH = 1_024;

function invalidMetadata(message: string): never {
  throw toError(createError({ type: "agent", message }));
}

function snapshotPlainRecord(
  value: unknown,
  label: string,
  maxEntries: number,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalidMetadata(`${label} must be a key-value mapping.`);
  }

  let prototype: object | null;
  let keys: (string | symbol)[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    invalidMetadata(`${label} must be a readable key-value mapping.`);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    invalidMetadata(`${label} must be a plain key-value mapping.`);
  }
  if (keys.length > maxEntries) {
    invalidMetadata(`${label} must contain at most ${maxEntries} fields.`);
  }

  const snapshot: Record<string, unknown> = {};
  for (const key of keys) {
    if (typeof key !== "string") {
      invalidMetadata(`${label} must use string keys.`);
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    } catch {
      invalidMetadata(`${label} must be a readable key-value mapping.`);
    }
    if (!descriptor || !("value" in descriptor)) {
      invalidMetadata(`${label} must contain data properties only.`);
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

function utf8SizeWithin(value: string, maxBytes: number): boolean {
  return value.length <= maxBytes && new TextEncoder().encode(value).byteLength <= maxBytes;
}

/**
 * Parse SKILL.md content into frontmatter + body.
 *
 * Malformed YAML is rejected so policy-bearing fields cannot be interpreted
 * with weaker fallback rules.
 */
export async function parseSkillFrontmatter(content: string): Promise<ParsedSkillContent> {
  if (typeof content !== "string" || !utf8SizeWithin(content, SKILL_DEFINITION_MAX_BYTES)) {
    throw toError(
      createError({
        type: "agent",
        message: `SKILL.md must not exceed ${SKILL_DEFINITION_MAX_BYTES} bytes.`,
      }),
    );
  }
  let result: ReturnType<typeof extract<Record<string, unknown>>>;
  try {
    result = extract<Record<string, unknown>>(content);
  } catch {
    throw toError(
      createError({
        type: "agent",
        message: "Skill frontmatter contains invalid YAML",
      }),
    );
  }
  const frontmatter = snapshotPlainRecord(
    result.attrs,
    "Skill frontmatter",
    MAX_FRONTMATTER_FIELDS,
  );
  return { frontmatter, body: result.body };
}

/**
 * Validate and normalize parsed frontmatter into SkillMetadata.
 *
 * @param frontmatter - Parsed frontmatter object
 * @param directoryName - Expected parent directory name for the skill
 */
export function validateSkillMetadata(
  frontmatter: Record<string, unknown>,
  directoryName: string,
): SkillMetadata {
  const fields = snapshotPlainRecord(frontmatter, "Skill frontmatter", MAX_FRONTMATTER_FIELDS);
  const nameValue = fields.name;
  if (typeof nameValue !== "string" || !nameValue.trim()) {
    invalidMetadata('Skill frontmatter is missing a required "name" field.');
  }
  const rawName = nameValue.trim();

  if (!SKILL_NAME_REGEX.test(rawName)) {
    throw toError(
      createError({
        type: "agent",
        message:
          "Invalid skill name: use 1-64 lowercase alphanumeric characters with single hyphen separators",
      }),
    );
  }
  if (typeof directoryName !== "string" || !SKILL_NAME_REGEX.test(directoryName)) {
    invalidMetadata("Skill directory name is invalid.");
  }
  if (rawName !== directoryName) {
    invalidMetadata(`Skill name "${rawName}" must match its directory name "${directoryName}".`);
  }

  // Description: required
  const rawDescription = fields.description;
  if (!rawDescription || typeof rawDescription !== "string" || !rawDescription.trim()) {
    throw toError(
      createError({
        type: "agent",
        message: `Skill "${rawName}" is missing a required "description" field`,
      }),
    );
  }

  const description = rawDescription.trim();
  if (description.length > SKILL_DESCRIPTION_MAX_LENGTH) {
    invalidMetadata(
      `Skill "${rawName}" description must not exceed ${SKILL_DESCRIPTION_MAX_LENGTH} characters.`,
    );
  }

  // Allowed-tools: parse from space-delimited string or array
  const hasCanonicalAllowedTools = Object.hasOwn(fields, "allowed-tools");
  const hasLegacyAllowedTools = Object.hasOwn(fields, "allowed_tools");
  if (hasCanonicalAllowedTools && hasLegacyAllowedTools) {
    invalidMetadata(
      `Skill "${rawName}" must not define both "allowed-tools" and "allowed_tools".`,
    );
  }
  const allowedToolPatterns = hasCanonicalAllowedTools
    ? fields["allowed-tools"]
    : fields.allowed_tools;
  const allowedTools = parseAllowedTools(allowedToolPatterns, rawName);

  const license = parseOptionalString(fields.license, rawName, "license", MAX_LICENSE_LENGTH);

  const compatibility = parseOptionalString(
    fields.compatibility,
    rawName,
    "compatibility",
    SKILL_COMPATIBILITY_MAX_LENGTH,
  );

  const metadata = parseMetadata(fields.metadata, rawName);

  return {
    name: rawName,
    description,
    ...(allowedTools !== undefined && { allowedTools }),
    ...(license && { license }),
    ...(compatibility && { compatibility }),
    ...(metadata && { metadata }),
  };
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
  if (value === undefined) return undefined;

  let patterns: string[];

  if (typeof value === "string") {
    if (value.length > MAX_ALLOWED_TOOLS_TEXT_LENGTH) {
      invalidMetadata(`Skill "${skillName}" allowed-tools value is too long.`);
    }
    patterns = value.split(/\s+/).filter(Boolean);
  } else {
    let isArray = false;
    let arrayLength: number | undefined;
    try {
      isArray = Array.isArray(value);
      if (isArray) {
        const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value as object, "length");
        const lengthValue = lengthDescriptor && "value" in lengthDescriptor
          ? lengthDescriptor.value
          : undefined;
        if (
          typeof lengthValue === "number" && Number.isSafeInteger(lengthValue) && lengthValue >= 0
        ) {
          arrayLength = lengthValue;
        }
      }
    } catch {
      invalidMetadata(`Skill "${skillName}" allowed-tools value must be readable.`);
    }
    if (!isArray || arrayLength === undefined) {
      throw toError(
        createError({
          type: "agent",
          message:
            `Skill "${skillName}" has invalid allowed-tools value: expected a string or array of strings, got ${typeof value}`,
        }),
      );
    }
    if (arrayLength > 256) {
      invalidMetadata(`Skill "${skillName}" allowed-tools has too many entries.`);
    }
    patterns = [];
    for (let index = 0; index < arrayLength; index += 1) {
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Reflect.getOwnPropertyDescriptor(value as object, String(index));
      } catch {
        invalidMetadata(`Skill "${skillName}" allowed-tools value must be readable.`);
      }
      if (!descriptor || !("value" in descriptor)) {
        invalidMetadata(`Skill "${skillName}" allowed-tools must be a dense array.`);
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
  }

  if (patterns.length === 0) return [];

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

function parseOptionalString(
  value: unknown,
  skillName: string,
  field: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    invalidMetadata(`Skill "${skillName}" ${field} must be a string.`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    invalidMetadata(
      `Skill "${skillName}" ${field} must contain 1-${maxLength} characters.`,
    );
  }
  return normalized;
}

/** Validate metadata as a bounded string-to-string mapping. */
function parseMetadata(
  value: unknown,
  skillName: string,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  const metadata = snapshotPlainRecord(value, "Skill metadata", MAX_METADATA_ENTRIES);

  const entries = Object.entries(metadata);
  if (entries.length === 0) return undefined;

  const result: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (!k || k.length > MAX_METADATA_KEY_LENGTH || typeof v !== "string") {
      invalidMetadata(
        `Skill "${skillName}" metadata must use bounded string keys and string values.`,
      );
    }
    if (v.length > MAX_METADATA_VALUE_LENGTH) {
      invalidMetadata(
        `Skill "${skillName}" metadata values must not exceed ${MAX_METADATA_VALUE_LENGTH} characters.`,
      );
    }
    Object.defineProperty(result, k, {
      configurable: true,
      enumerable: true,
      value: v,
      writable: true,
    });
  }
  return result;
}
