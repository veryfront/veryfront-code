/**
 * Skill frontmatter parser
 *
 * Parses SKILL.md files with YAML frontmatter.
 * Primary parser: gray-matter shim (#std/front-matter/yaml.ts)
 * Fallback: regex + line-by-line parser
 *
 * @module
 */

import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import {
  SKILL_ALLOWED_TOOL_PATTERN_REGEX,
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_NAME_REGEX,
  type SkillMetadata,
} from "./types.ts";

/** Result of parsing a SKILL.md file */
export interface ParsedSkillContent {
  frontmatter: Record<string, unknown>;
  body: string;
}

/**
 * Parse SKILL.md content into frontmatter + body.
 *
 * Uses gray-matter shim as primary parser with a regex fallback
 * for environments where gray-matter is not available.
 */
export async function parseSkillFrontmatter(content: string): Promise<ParsedSkillContent> {
  // Try primary parser: gray-matter shim
  try {
    const { extract } = await import("#std/front-matter/yaml.ts");
    const result = extract<Record<string, unknown>>(content);
    return { frontmatter: result.attrs, body: result.body };
  } catch {
    // Fall through to fallback
  }

  // Fallback: regex-based parser
  return parseFrontmatterFallback(content);
}

/**
 * Regex-based fallback parser for YAML frontmatter.
 * Handles simple key: value pairs (no nested YAML).
 */
function parseFrontmatterFallback(content: string): ParsedSkillContent {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const rawFrontmatter = match[1]!;
  const body = match[2]!;
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

/**
 * Validate and normalize parsed frontmatter into SkillMetadata.
 *
 * @param frontmatter - Parsed frontmatter object
 * @param directoryName - Directory name used as fallback for skill name
 */
export function validateSkillMetadata(
  frontmatter: Record<string, unknown>,
  directoryName: string,
): SkillMetadata {
  // Name: from frontmatter or directory name
  const rawName = typeof frontmatter.name === "string" ? frontmatter.name.trim() : directoryName;

  if (!SKILL_NAME_REGEX.test(rawName)) {
    throw toError(
      createError({
        type: "agent",
        message:
          `Invalid skill name "${rawName}": must be lowercase alphanumeric with hyphens, 1-64 characters`,
      }),
    );
  }

  // Description: required
  const rawDescription = frontmatter.description;
  if (!rawDescription || typeof rawDescription !== "string" || !rawDescription.trim()) {
    throw toError(
      createError({
        type: "agent",
        message: `Skill "${rawName}" is missing a required "description" field`,
      }),
    );
  }

  const description = rawDescription.trim().slice(0, SKILL_DESCRIPTION_MAX_LENGTH);

  // Allowed-tools: parse from space-delimited string or array
  const allowedTools = parseAllowedTools(frontmatter["allowed-tools"], rawName);

  // License: optional string passthrough
  const license = typeof frontmatter.license === "string" ? frontmatter.license.trim() : undefined;

  // Compatibility: optional string passthrough
  const compatibility = typeof frontmatter.compatibility === "string"
    ? frontmatter.compatibility.trim()
    : undefined;

  // Metadata: convert nested object values to strings
  const metadata = parseMetadata(frontmatter.metadata);

  return {
    name: rawName,
    description,
    ...(allowedTools && { allowedTools }),
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
  if (!value) return undefined;

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
    return undefined;
  }

  if (patterns.length === 0) return undefined;

  // Validate each pattern (fail closed)
  for (const pattern of patterns) {
    if (!SKILL_ALLOWED_TOOL_PATTERN_REGEX.test(pattern)) {
      throw toError(
        createError({
          type: "agent",
          message: `Skill "${skillName}" has invalid allowed-tools pattern "${pattern}". ` +
            `Only exact tool IDs (e.g. "Read") and prefix wildcards (e.g. "api:*") are supported.`,
        }),
      );
    }
  }

  return patterns;
}

/** Convert metadata object values to strings */
function parseMetadata(
  value: unknown,
): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    result[k] = String(v);
  }

  return Object.keys(result).length > 0 ? result : undefined;
}
