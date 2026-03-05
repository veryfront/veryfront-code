/**
 * Skill type definitions
 *
 * Follows the agentskills.io specification.
 * Pure type/const file — no runtime dependencies.
 *
 * @module
 */

import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";

// ── Constants ───────────────────────────────────────────────────────────

/** Valid skill name: lowercase alphanumeric + hyphens, 1-64 chars */
export const SKILL_NAME_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Valid allowed-tool pattern: exact ID or prefix wildcard (e.g. "api:*") */
export const SKILL_ALLOWED_TOOL_PATTERN_REGEX = /^[A-Za-z0-9._:-]+(?:\:\*)?$/;

/** Maximum description length in characters */
export const SKILL_DESCRIPTION_MAX_LENGTH = 1024;

/** Standard SKILL.md filename per agentskills.io spec */
export const SKILL_MD_FILENAME = "SKILL.md";

/** Tool IDs that belong to the skill system (single source of truth) */
export const SKILL_TOOL_IDS = new Set([
  "load-skill",
  "load-skill-reference",
  "execute-skill-script",
]);

/** Conventional subdirectory names */
export const SKILL_SCRIPTS_DIR = "scripts";
export const SKILL_REFERENCES_DIR = "references";
export const SKILL_ASSETS_DIR = "assets";

// ── Interfaces ──────────────────────────────────────────────────────────

/** Parsed frontmatter metadata from SKILL.md */
export interface SkillMetadata {
  /** Skill identifier (lowercase, hyphenated) */
  name: string;
  /** Human-readable description */
  description: string;
  /** Tool access restrictions (space-delimited in YAML, parsed to array) */
  allowedTools?: string[];
  /** SPDX license identifier */
  license?: string;
  /** Compatibility constraints */
  compatibility?: string;
  /** Arbitrary key-value metadata */
  metadata?: Record<string, string>;
}

/** Full skill content returned by load-skill tool */
export interface SkillContent {
  /** Markdown instructions (body after frontmatter) */
  instructions: string;
  /** Tool access restrictions from frontmatter */
  allowedTools?: string[];
  /** Available reference file paths */
  references: string[];
  /** Available script file paths */
  scripts: string[];
}

/** Registered skill instance */
export interface Skill {
  /** Unique skill ID (matches directory name) */
  id: string;
  /** Parsed frontmatter metadata */
  metadata: SkillMetadata;
  /** Absolute path to the skill directory */
  rootPath: string;
  /** Optional filesystem adapter for VFS/cloud-backed projects */
  fsAdapter?: FileSystemAdapter;
}

/** Result from executing a skill script */
export interface SkillScriptResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Input for the script executor */
export interface SkillScriptExecutorInput {
  scriptPath: string;
  scriptContent?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
}

/** Script executor interface */
export interface SkillScriptExecutor {
  execute(input: SkillScriptExecutorInput): Promise<SkillScriptResult>;
}

/** Active skill context for runtime policy tracking */
export interface ActiveSkillContext {
  skillId: string;
  allowedTools?: string[];
}
