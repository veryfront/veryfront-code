/**
 * Skill type definitions
 *
 * Follows the agentskills.io specification.
 * Pure type/const file with no runtime dependencies.
 *
 * @module
 */

import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { SKILL_TOOL_ID_VALUES } from "#veryfront/tool/framework-tool-ids.ts";

// ── Constants ───────────────────────────────────────────────────────────

/** Valid skill name: lowercase alphanumeric segments separated by single hyphens, 1-64 chars. */
export const SKILL_NAME_REGEX = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,63}$/;

/** Valid allowed-tool pattern: exact ID or prefix wildcard (e.g. "api:*") */
export const SKILL_ALLOWED_TOOL_PATTERN_REGEX =
  /^[A-Za-z][A-Za-z0-9._-]*(:[A-Za-z][A-Za-z0-9._-]*)*(:\*)?$/;

/** Maximum description length in characters */
export const SKILL_DESCRIPTION_MAX_LENGTH = 1024;

/** Maximum compatibility field length in characters. */
export const SKILL_COMPATIBILITY_MAX_LENGTH = 500;

/** Maximum UTF-8 size of one SKILL.md definition. */
export const SKILL_DEFINITION_MAX_BYTES = 1_048_576;

/** Standard SKILL.md filename per agentskills.io spec */
export const SKILL_MD_FILENAME = "SKILL.md";

function createReadonlyStringSet(values: readonly string[]): ReadonlySet<string> {
  const lookup = new Set(values);
  const view: ReadonlySet<string> = Object.freeze({
    get size(): number {
      return lookup.size;
    },
    has(value: string): boolean {
      return lookup.has(value);
    },
    entries(): SetIterator<[string, string]> {
      return lookup.entries();
    },
    keys(): SetIterator<string> {
      return lookup.keys();
    },
    values(): SetIterator<string> {
      return lookup.values();
    },
    forEach(
      callback: (value: string, value2: string, set: ReadonlySet<string>) => void,
      thisArg?: unknown,
    ): void {
      lookup.forEach((value) => callback.call(thisArg, value, value, view));
    },
    union<U>(other: ReadonlySetLike<U>): Set<string | U> {
      const result = new Set<string | U>(lookup);
      const iterator = other.keys();
      for (let step = iterator.next(); !step.done; step = iterator.next()) {
        result.add(step.value);
      }
      return result;
    },
    intersection<U>(other: ReadonlySetLike<U>): Set<string & U> {
      const result = new Set<string & U>();
      const otherValues = other as ReadonlySetLike<unknown>;
      for (const value of lookup) {
        if (otherValues.has(value)) result.add(value as string & U);
      }
      return result;
    },
    difference<U>(other: ReadonlySetLike<U>): Set<string> {
      const result = new Set<string>();
      const otherValues = other as ReadonlySetLike<unknown>;
      for (const value of lookup) {
        if (!otherValues.has(value)) result.add(value);
      }
      return result;
    },
    symmetricDifference<U>(other: ReadonlySetLike<U>): Set<string | U> {
      const result = new Set<string | U>();
      const otherValues = other as ReadonlySetLike<unknown>;
      for (const value of lookup) {
        if (!otherValues.has(value)) result.add(value);
      }
      const iterator = other.keys();
      for (let step = iterator.next(); !step.done; step = iterator.next()) {
        const value = step.value;
        if (typeof value !== "string" || !lookup.has(value)) result.add(value);
      }
      return result;
    },
    isSubsetOf(other: ReadonlySetLike<unknown>): boolean {
      for (const value of lookup) {
        if (!other.has(value)) return false;
      }
      return true;
    },
    isSupersetOf(other: ReadonlySetLike<unknown>): boolean {
      const iterator = other.keys();
      for (let step = iterator.next(); !step.done; step = iterator.next()) {
        const value = step.value;
        if (typeof value !== "string" || !lookup.has(value)) return false;
      }
      return true;
    },
    isDisjointFrom(other: ReadonlySetLike<unknown>): boolean {
      for (const value of lookup) {
        if (other.has(value)) return false;
      }
      return true;
    },
    [Symbol.iterator](): SetIterator<string> {
      return lookup.values();
    },
  });
  return view;
}

/** Immutable tool IDs that belong to the skill system. */
export const SKILL_TOOL_IDS: ReadonlySet<string> = createReadonlyStringSet([
  ...SKILL_TOOL_ID_VALUES,
]);

/** Conventional directory for executable skill scripts. */
export const SKILL_SCRIPTS_DIR = "scripts";

/** Conventional directory for skill reference documents. */
export const SKILL_REFERENCES_DIR = "references";

/** Veryfront extension directory for loadable skill resources. */
export const SKILL_RESOURCES_DIR = "resources";

/** Conventional directory for static skill assets. */
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
  /** Captured standard output. */
  stdout: string;
  /** Captured standard error. */
  stderr: string;
  /** Process exit code. */
  exitCode: number;
}

/** Input for the script executor */
export interface SkillScriptExecutorInput {
  /** Validated path of the script to execute. */
  scriptPath: string;
  /** Optional script source for remote executors. */
  scriptContent?: string;
  /** Positional arguments passed to the script runtime. */
  args?: string[];
  /** Environment variables added to the script process. */
  env?: Record<string, string>;
  /** Working directory for the script process. */
  cwd?: string;
  /** Maximum duration for provisioning, execution, and cleanup, in milliseconds. */
  timeoutMs?: number;
  /** Cooperative cancellation signal for the execution lifecycle. */
  abortSignal?: AbortSignal;
}

/** Script executor interface */
export interface SkillScriptExecutor {
  /** Execute one skill script and return its captured result. */
  execute(input: SkillScriptExecutorInput): Promise<SkillScriptResult>;
}

/** Active skill context for runtime policy tracking */
export interface ActiveSkillContext {
  /** Canonical ID of the active skill. */
  skillId: string;
  /** Tool patterns allowed while the skill is active. */
  allowedTools?: string[];
}
