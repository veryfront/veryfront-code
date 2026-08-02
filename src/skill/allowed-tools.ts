/**
 * Allowed-Tools Enforcement
 *
 * Dual-layer enforcement for skill tool access restrictions.
 * Layer 1: Filter tool definitions before sending to model (planning-time)
 * Layer 2: Check individual tool calls at execution time
 *
 * @module
 */

import { isSkillInfrastructureToolId, isValidSkillAllowedToolPattern } from "./types.ts";
import { createError, toError } from "#veryfront/errors";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import {
  SKILL_ALLOWED_TOOL_MAX_PATTERNS,
  SKILL_ALLOWED_TOOL_PATTERN_MAX_LENGTH,
} from "./limits.ts";
import { hasControlCharacters, isWellFormedUtf16 } from "./string-safety.ts";

/** Active skill file-backed capabilities available to skill infrastructure tools. */
export type SkillToolAvailability = {
  readonly hasActiveSkill?: boolean;
  readonly references?: readonly string[];
  readonly scripts?: readonly string[];
};

const LOAD_SKILL_TOOL_ID = "load_skill";
const LOAD_SKILL_REFERENCE_TOOL_ID = "load_skill_reference";
const EXECUTE_SKILL_SCRIPT_TOOL_ID = "execute_skill_script";
const apply = Reflect.apply;
const arrayFilter = Array.prototype.filter;
const arrayIsArray = Array.isArray;
const defineProperty = Object.defineProperty;
const freeze = Object.freeze;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const numberIsSafeInteger = Number.isSafeInteger;
const objectHasOwnProperty = Object.prototype.hasOwnProperty;
const stringEndsWith = String.prototype.endsWith;
const stringSlice = String.prototype.slice;
const stringStartsWith = String.prototype.startsWith;

function hasOwn(value: object, key: PropertyKey): boolean {
  return apply(objectHasOwnProperty, value, [key]) as boolean;
}

function isValidAllowedToolPattern(pattern: string): boolean {
  return isValidSkillAllowedToolPattern(pattern);
}

function isSkillInfrastructureToolAllowed(
  toolName: string,
  availability: SkillToolAvailability = {},
): boolean | undefined {
  if (!isSkillInfrastructureToolId(toolName)) {
    return undefined;
  }

  if (toolName === LOAD_SKILL_TOOL_ID) {
    return true;
  }

  if (toolName === LOAD_SKILL_REFERENCE_TOOL_ID) {
    return availability.hasActiveSkill === true && (availability.references?.length ?? 0) > 0;
  }

  if (toolName === EXECUTE_SKILL_SCRIPT_TOOL_ID) {
    return availability.hasActiveSkill === true && (availability.scripts?.length ?? 0) > 0;
  }

  return false;
}

function isToolAllowedByCapturedPolicy(
  toolName: string,
  allowedTools: readonly string[] | undefined,
  availability?: SkillToolAvailability,
): boolean {
  const skillToolAvailable = isSkillInfrastructureToolAllowed(toolName, availability);
  if (skillToolAvailable !== undefined) return skillToolAvailable;
  if (allowedTools === undefined) return true;
  return matchesAnyAllowedTool(toolName, allowedTools);
}

/**
 * Check if a tool name matches a single allowed-tools pattern.
 *
 * Supports:
 * - Exact match: "Read" matches "Read"
 * - Prefix wildcard: "api:*" matches "api:list-users"
 */
export function matchesAllowedTool(toolName: string, pattern: string): boolean {
  // Invalid patterns always fail (fail closed)
  if (!isValidAllowedToolPattern(pattern)) {
    return false;
  }

  // Prefix wildcard
  if (apply(stringEndsWith, pattern, [":*"]) as boolean) {
    const prefix = apply(stringSlice, pattern, [0, -1]) as string; // keep the colon: "api:"
    return apply(stringStartsWith, toolName, [prefix]) as boolean;
  }

  // Exact match
  return toolName === pattern;
}

/**
 * Layer 1: Filter tool definitions before sending to model.
 *
 * Removes tools not in the allowed list. `load_skill` remains available for
 * skill navigation. File-backed skill tools also require an advertised file.
 *
 * @param tools - Full list of tool definitions
 * @param allowedTools - Allowed tool patterns, or undefined for no restrictions
 * @returns Filtered tool definitions
 */
export function filterToolsForSkill<T extends { name: string }>(
  tools: T[],
  allowedTools: string[] | undefined,
  skillToolAvailability?: SkillToolAvailability,
): T[] {
  if (allowedTools === undefined) {
    if (!skillToolAvailability) {
      return tools;
    }

    return apply(arrayFilter, tools, [(tool: T) => {
      const skillToolAllowed = isSkillInfrastructureToolAllowed(
        tool.name,
        skillToolAvailability,
      );
      return skillToolAllowed ?? true;
    }]) as T[];
  }

  const capturedAllowedTools = captureProgrammaticAllowedToolPatterns(allowedTools);
  return apply(arrayFilter, tools, [(tool: T) =>
    isToolAllowedByCapturedPolicy(
      tool.name,
      capturedAllowedTools,
      skillToolAvailability,
    )]) as T[];
}

/**
 * Layer 2: Check if a specific tool call is allowed at execution time.
 *
 * @param toolName - Name of the tool being called
 * @param allowedTools - Allowed tool patterns, or undefined for no restrictions
 * @returns true if the tool call is allowed
 */
export function isToolAllowedBySkill(
  toolName: string,
  allowedTools: string[] | undefined,
  skillToolAvailability?: SkillToolAvailability,
): boolean {
  return isToolAllowedByCapturedPolicy(
    toolName,
    allowedTools === undefined ? undefined : captureProgrammaticAllowedToolPatterns(allowedTools),
    skillToolAvailability,
  );
}

/** Filter provider-native or other name-only tool inventories through the same policy boundary. */
export function filterToolNamesForSkill(
  toolNames: readonly string[],
  allowedTools: string[] | undefined,
  skillToolAvailability?: SkillToolAvailability,
): string[] {
  const capturedAllowedTools = allowedTools === undefined
    ? undefined
    : captureProgrammaticAllowedToolPatterns(allowedTools);
  return apply(arrayFilter, toolNames, [(toolName: string) =>
    isToolAllowedByCapturedPolicy(
      toolName,
      capturedAllowedTools,
      skillToolAvailability,
    )]) as string[];
}

function matchesAnyAllowedTool(toolName: string, patterns: readonly string[]): boolean {
  for (let index = 0; index < patterns.length; index += 1) {
    if (matchesAllowedTool(toolName, patterns[index]!)) return true;
  }
  return false;
}

/**
 * Validate allowed-tool patterns at parse time.
 *
 * Ensures each pattern matches the expected format.
 * Rejects unsupported patterns with a descriptive error (fail closed).
 *
 * @param patterns - Array of tool patterns to validate
 * @returns A detached mutable copy of the validated patterns
 * @throws If any pattern is invalid
 */
export function validateAllowedToolPatterns(patterns: string[]): string[] {
  return captureProgrammaticAllowedToolPatterns(patterns);
}

/** Validate bounded allowed-tool patterns at filesystem and runtime trust boundaries. */
export function validateStrictAllowedToolPatterns(patterns: string[]): string[] {
  return captureStrictAllowedToolPatterns(patterns);
}

/** Validate, detach, and freeze an active authorization policy. */
export function snapshotAllowedToolPatterns(patterns: readonly string[]): string[] {
  return freeze(captureStrictAllowedToolPatterns(patterns)) as string[];
}

type AllowedToolPatternLimits = Readonly<{
  maxPatterns: number;
  maxPatternLength: number;
}>;

const STRICT_ALLOWED_TOOL_PATTERN_LIMITS: AllowedToolPatternLimits = freeze({
  maxPatterns: SKILL_ALLOWED_TOOL_MAX_PATTERNS,
  maxPatternLength: SKILL_ALLOWED_TOOL_PATTERN_MAX_LENGTH,
});

function captureProgrammaticAllowedToolPatterns(
  patterns: readonly string[],
): string[] {
  return captureAllowedToolPatterns(patterns, undefined);
}

function captureStrictAllowedToolPatterns(patterns: readonly string[]): string[] {
  return captureAllowedToolPatterns(patterns, STRICT_ALLOWED_TOOL_PATTERN_LIMITS);
}

function captureAllowedToolPatterns(
  patterns: readonly string[],
  limits: AllowedToolPatternLimits | undefined,
): string[] {
  if (
    (typeof patterns !== "object" && typeof patterns !== "function") ||
    patterns === null ||
    !arrayIsArray(patterns)
  ) {
    throw new TypeError("Allowed-tools patterns must be an array");
  }
  if (isProxyWithoutHooks(patterns)) {
    throw new TypeError("Allowed-tools patterns must not be a proxy");
  }
  const lengthDescriptor = getOwnPropertyDescriptor(patterns, "length");
  const length = lengthDescriptor && hasOwn(lengthDescriptor, "value")
    ? lengthDescriptor.value
    : undefined;
  if (!numberIsSafeInteger(length) || length < 0) {
    throw new TypeError("Allowed-tools length must be a data property");
  }
  if (limits && length > limits.maxPatterns) {
    throw new RangeError(
      `Allowed-tools accepts at most ${limits.maxPatterns} patterns`,
    );
  }

  const snapshot: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = getOwnPropertyDescriptor(patterns, index);
    if (!descriptor || !hasOwn(descriptor, "value")) {
      throw new TypeError(`Allowed-tools pattern ${index} must be a data property`);
    }
    const pattern = descriptor.value;
    if (typeof pattern !== "string") {
      throw new TypeError("Allowed-tools patterns must be strings");
    }
    if (limits && pattern.length > limits.maxPatternLength) {
      throw new RangeError(
        `Allowed-tools patterns must be at most ${limits.maxPatternLength} characters`,
      );
    }
    if (!isWellFormedUtf16(pattern) || hasControlCharacters(pattern)) {
      throw new TypeError(
        "Allowed-tools patterns must contain well-formed UTF-16 without control characters",
      );
    }
    if (!isValidAllowedToolPattern(pattern)) {
      throw toError(
        createError({
          type: "agent",
          message: "Invalid allowed-tools pattern. " +
            `Only exact tool IDs (e.g. "Read") and prefix wildcards (e.g. "api:*") are supported.`,
        }),
      );
    }
    defineProperty(snapshot, snapshot.length, {
      configurable: true,
      enumerable: true,
      value: pattern,
      writable: true,
    });
  }
  return snapshot;
}
