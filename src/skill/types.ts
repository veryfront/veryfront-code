/**
 * Skill type definitions
 *
 * Implements the Agent Skills metadata format. Veryfront intentionally uses a
 * documented, fail-closed subset of the experimental allowed-tools syntax.
 * Pure type/const file — no runtime dependencies.
 *
 * @module
 */

import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";

// ── Constants ───────────────────────────────────────────────────────────

const apply = Reflect.apply;
const NativeRegExp = RegExp;
const regExpExec = RegExp.prototype.exec;

/** Historical public skill-name matcher. */
export const SKILL_NAME_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Strict filesystem skill-name matcher: 1-64 lowercase alphanumeric
 * characters or single hyphens, without leading or trailing hyphens.
 */
export const SKILL_STRICT_NAME_REGEX = /^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Provider-safe owned skill id: sanitized namespace + short name, max 64 chars */
export const SKILL_PROVIDER_SAFE_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

const SKILL_ALLOWED_TOOL_PATTERN_SOURCE =
  "^[A-Za-z][A-Za-z0-9._-]*(:[A-Za-z][A-Za-z0-9._-]*)*(:\\*)?$";
const INTERNAL_SKILL_ALLOWED_TOOL_PATTERN_REGEX = new NativeRegExp(
  SKILL_ALLOWED_TOOL_PATTERN_SOURCE,
);

/**
 * Public inspection matcher for exact tool IDs and prefix wildcards.
 * Mutating this compatibility value does not alter authorization decisions.
 */
export const SKILL_ALLOWED_TOOL_PATTERN_REGEX = new NativeRegExp(
  SKILL_ALLOWED_TOOL_PATTERN_SOURCE,
);

/** Framework-owned allowed-tool grammar check. */
export function isValidSkillAllowedToolPattern(value: unknown): value is string {
  return typeof value === "string" &&
    apply(regExpExec, INTERNAL_SKILL_ALLOWED_TOOL_PATTERN_REGEX, [value]) !== null;
}

/** Maximum description length in characters */
export const SKILL_DESCRIPTION_MAX_LENGTH = 1024;

/** Maximum compatibility declaration length from the Agent Skills specification. */
export const SKILL_COMPATIBILITY_MAX_LENGTH = 500;

/** Framework resource budgets for optional skill metadata. */
export const SKILL_LICENSE_MAX_LENGTH = 256;
export const SKILL_METADATA_MAX_ENTRIES = 64;
export const SKILL_METADATA_KEY_MAX_LENGTH = 128;
export const SKILL_METADATA_VALUE_MAX_LENGTH = 2_048;

/** Standard SKILL.md filename per agentskills.io spec */
export const SKILL_MD_FILENAME = "SKILL.md";

const SKILL_TOOL_ID_VALUES = [
  "load_skill",
  "load_skill_reference",
  "execute_skill_script",
] as const;

const INTERNAL_SKILL_TOOL_IDS = new Set<string>(SKILL_TOOL_ID_VALUES);
const setHas = Set.prototype.has;

/**
 * Public snapshot of tool IDs that belong to the skill system.
 *
 * Mutating this compatibility value does not alter framework authorization
 * policy. Use it only for inspection.
 */
export const SKILL_TOOL_IDS = new Set<string>(SKILL_TOOL_ID_VALUES);

/** Framework-owned membership check that cannot be changed by public Set mutation. */
export function isSkillInfrastructureToolId(toolId: string): boolean {
  return apply(setHas, INTERNAL_SKILL_TOOL_IDS, [toolId]) as boolean;
}

/** Conventional subdirectory names */
export const SKILL_SCRIPTS_DIR = "scripts";
export const SKILL_REFERENCES_DIR = "references";
export const SKILL_RESOURCES_DIR = "resources";
export const SKILL_ASSETS_DIR = "assets";
/** Canonical read-only skill directories exposed through reference loading. */
export const SKILL_READABLE_DIRS = Object.freeze(
  [
    SKILL_REFERENCES_DIR,
    SKILL_RESOURCES_DIR,
    SKILL_ASSETS_DIR,
  ] as const,
);

// ── Interfaces ──────────────────────────────────────────────────────────

/** Parsed frontmatter metadata from SKILL.md */
export interface SkillMetadata {
  /** Skill identifier (lowercase, hyphenated) */
  name: string;
  /** Optional human-readable label; never used for skill lookup/reference. */
  displayName?: string;
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

/** Full skill content returned by load_skill tool */
export interface SkillContent {
  /** Loaded skill identifier */
  skillId: string;
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
  /**
   * Owning agent id for agent-scoped skills. Unowned (undefined) skills are
   * project-global. Owned skills are invisible to other agents in selector
   * resolution and skill tools.
   */
  ownerAgentId?: string;
  /** Short name used by the owning agent's `skills:` selector (e.g. "cite"). */
  shortName?: string;
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
  /**
   * Already-validated script content. When omitted with
   * `validatedSourceRoot`, the executor bounded-reads the contained script and
   * binds that decoded content to the same filesystem identity before local
   * execution or cloud upload.
   */
  scriptContent?: string;
  args?: string[];
  /** Passed as structured environment data, never embedded in a shell command. */
  env?: Record<string, string>;
  /**
   * Local execution working directory. Cloud execution maps this intent to a
   * fresh remote directory containing only the selected uploaded script.
   */
  cwd?: string;
  /**
   * Canonical source-containment root supplied after framework path validation.
   * Local execution uses it for strict resource limits and final containment,
   * content, and filesystem-identity checks before executing the original
   * validated path. Cloud execution applies the same containment and identity
   * checks before reading omitted `scriptContent`. Omit it for generic executor
   * calls that do not carry that validation contract.
   */
  validatedSourceRoot?: string;
  timeoutMs?: number;
  /** Cooperative cancellation propagated from the active tool request. */
  abortSignal?: AbortSignal;
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
