/**
 * Provider-neutral Claude Code agent facade.
 *
 * Core validates and snapshots requests, then delegates execution to the
 * `ClaudeCodeAgentRuntime` extension contract. The Anthropic SDK is owned by a
 * first-party extension and is never imported by this module.
 */

import { resolve } from "#veryfront/extensions/contracts.ts";
import {
  type ClaudeCodeAgentExecutionConfig,
  type ClaudeCodeAgentRuntime,
  ClaudeCodeAgentRuntimeName,
} from "./runtime-contract.ts";
import type { ClaudeCodeMode, ClaudeCodeResult, FileChange } from "./types.ts";

/** Maximum supported conversation turns for a single core agent request. */
export const MAX_CLAUDE_CODE_AGENT_TURNS = 100;

/** Caller-facing agent configuration. Omitted mode defaults to read-only analysis. */
export type AgentConfig = Omit<ClaudeCodeAgentExecutionConfig, "mode"> & {
  readonly mode?: ClaudeCodeMode;
  /** Callback awaited exactly once after a runtime returns a valid result. */
  readonly onComplete?: (result: ClaudeCodeResult) => void | Promise<void>;
};

interface NormalizedAgentConfig {
  readonly execution: ClaudeCodeAgentExecutionConfig;
  readonly onComplete?: AgentConfig["onComplete"];
}

const MODES = new Set<ClaudeCodeMode>(["analysis", "code", "custom"]);
const FILE_CHANGE_TYPES = new Set<FileChange["type"]>([
  "created",
  "modified",
  "deleted",
]);

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function optionalNonEmptyString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  return value;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean`);
  }
  return value;
}

function optionalAbortSignal(value: unknown): AbortSignal | undefined {
  if (value === undefined) return undefined;
  if (!(value instanceof AbortSignal)) {
    throw new TypeError("Agent config abortSignal must be an AbortSignal");
  }
  return value;
}

function optionalStringList(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array of non-empty strings`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new TypeError(`${label}[${index}] must be a non-empty string`);
    }
    return entry;
  });
}

function normalizeAgentConfig(config: AgentConfig): NormalizedAgentConfig {
  assertRecord(config, "Agent config");

  const mode = config.mode ?? "analysis";
  if (!MODES.has(mode)) {
    throw new TypeError("Agent config mode must be analysis, code, or custom");
  }

  const maxTurns = config.maxTurns;
  if (
    maxTurns !== undefined &&
    (!Number.isSafeInteger(maxTurns) || maxTurns < 1 ||
      maxTurns > MAX_CLAUDE_CODE_AGENT_TURNS)
  ) {
    throw new RangeError(
      `Agent config maxTurns must be a safe integer between 1 and ${MAX_CLAUDE_CODE_AGENT_TURNS}`,
    );
  }

  const maxBudgetUsd = config.maxBudgetUsd;
  if (
    maxBudgetUsd !== undefined &&
    (!Number.isFinite(maxBudgetUsd) || maxBudgetUsd <= 0)
  ) {
    throw new RangeError("Agent config maxBudgetUsd must be a positive finite number");
  }

  const onComplete = config.onComplete;
  if (onComplete !== undefined && typeof onComplete !== "function") {
    throw new TypeError("Agent config onComplete must be a function");
  }

  return {
    execution: {
      mode,
      model: optionalNonEmptyString(config.model, "Agent config model"),
      bypassPermissions: optionalBoolean(
        config.bypassPermissions,
        "Agent config bypassPermissions",
      ),
      maxTurns,
      maxBudgetUsd,
      systemPrompt: optionalNonEmptyString(
        config.systemPrompt,
        "Agent config systemPrompt",
      ),
      cwd: optionalNonEmptyString(config.cwd, "Agent config cwd"),
      allowedTools: optionalStringList(
        config.allowedTools,
        "Agent config allowedTools",
      ),
      additionalDirectories: optionalStringList(
        config.additionalDirectories,
        "Agent config additionalDirectories",
      ),
      debug: optionalBoolean(config.debug, "Agent config debug"),
      abortSignal: optionalAbortSignal(config.abortSignal),
    },
    onComplete,
  };
}

function snapshotFileChange(value: unknown, index: number): FileChange {
  assertRecord(value, `Agent result changes[${index}]`);
  const path = optionalNonEmptyString(
    value.path,
    `Agent result changes[${index}].path`,
  );
  if (path === undefined) {
    throw new TypeError(`Agent result changes[${index}].path is required`);
  }
  if (typeof value.type !== "string" || !FILE_CHANGE_TYPES.has(value.type as FileChange["type"])) {
    throw new TypeError(
      `Agent result changes[${index}].type must be created, modified, or deleted`,
    );
  }
  const change: FileChange = {
    path,
    type: value.type as FileChange["type"],
  };
  const originalChecksum = optionalNonEmptyString(
    value.originalChecksum,
    `Agent result changes[${index}].originalChecksum`,
  );
  const newChecksum = optionalNonEmptyString(
    value.newChecksum,
    `Agent result changes[${index}].newChecksum`,
  );
  if (originalChecksum !== undefined) change.originalChecksum = originalChecksum;
  if (newChecksum !== undefined) change.newChecksum = newChecksum;
  return change;
}

function requiredStringList(value: unknown, label: string): string[] {
  const result = optionalStringList(value, label);
  if (result === undefined) throw new TypeError(`${label} is required`);
  return result;
}

function snapshotRuntimeResult(value: unknown): ClaudeCodeResult {
  assertRecord(value, "ClaudeCodeAgentRuntime result");
  if (typeof value.success !== "boolean") {
    throw new TypeError("Agent result success must be a boolean");
  }
  if (!Number.isSafeInteger(value.iterations) || (value.iterations as number) < 0) {
    throw new TypeError("Agent result iterations must be a non-negative safe integer");
  }
  if (
    typeof value.executionTime !== "number" ||
    !Number.isFinite(value.executionTime) ||
    value.executionTime < 0
  ) {
    throw new TypeError("Agent result executionTime must be a non-negative finite number");
  }

  const response = optionalString(value.response, "Agent result response");
  const error = optionalNonEmptyString(value.error, "Agent result error");
  if (!value.success && error === undefined) {
    throw new TypeError("An unsuccessful agent result must include an error");
  }

  let changes: FileChange[] | undefined;
  if (value.changes !== undefined) {
    if (!Array.isArray(value.changes)) {
      throw new TypeError("Agent result changes must be an array");
    }
    changes = value.changes.map(snapshotFileChange);
  }

  const result: ClaudeCodeResult = {
    success: value.success,
    iterations: value.iterations as number,
    filesModified: requiredStringList(
      value.filesModified,
      "Agent result filesModified",
    ),
    commandsExecuted: requiredStringList(
      value.commandsExecuted,
      "Agent result commandsExecuted",
    ),
    executionTime: value.executionTime,
  };
  if (response !== undefined) result.response = response;
  if (changes !== undefined) result.changes = changes;
  if (error !== undefined) result.error = error;
  return result;
}

function getRuntime(): ClaudeCodeAgentRuntime {
  const runtime: unknown = resolve<ClaudeCodeAgentRuntime>(ClaudeCodeAgentRuntimeName);
  if (
    runtime === null || typeof runtime !== "object" ||
    typeof (runtime as { execute?: unknown }).execute !== "function"
  ) {
    throw new TypeError(
      `${ClaudeCodeAgentRuntimeName} extension contract must provide an execute function`,
    );
  }
  return runtime as ClaudeCodeAgentRuntime;
}

/** Execute a task through the configured Claude Code agent runtime extension. */
export async function executeAgent(
  task: string,
  config: AgentConfig = {},
): Promise<ClaudeCodeResult> {
  const normalizedTask = optionalNonEmptyString(task, "Agent task");
  if (normalizedTask === undefined) throw new TypeError("Agent task is required");
  const { execution, onComplete } = normalizeAgentConfig(config);
  execution.abortSignal?.throwIfAborted();
  const runtimeResult = await getRuntime().execute(normalizedTask, execution);
  execution.abortSignal?.throwIfAborted();
  const result = snapshotRuntimeResult(runtimeResult);

  if (onComplete) {
    await onComplete(snapshotRuntimeResult(result));
  }
  return result;
}

/** @internal Applies reusable-agent override policy and snapshots mutable inputs. */
export function mergeAgentConfig(
  defaults: AgentConfig,
  overrides: AgentConfig,
): AgentConfig {
  assertRecord(defaults, "Agent defaults");
  assertRecord(overrides, "Agent overrides");
  const { bypassPermissions: requestedBypass, ...safeOverrides } = overrides;
  const merged: AgentConfig = { ...defaults, ...safeOverrides };

  // Per-call overrides may reduce privileges but cannot enable bypass mode.
  if (requestedBypass === false) {
    (merged as { bypassPermissions?: boolean }).bypassPermissions = false;
  }

  const normalized = normalizeAgentConfig(merged);
  return { ...normalized.execution, onComplete: normalized.onComplete };
}

/**
 * Create a reusable agent with snapshotted defaults.
 *
 * Per-call overrides cannot enable `bypassPermissions`; only server-controlled
 * defaults can do so. An override may explicitly disable an enabled bypass.
 */
export function createAgent(
  defaults: AgentConfig = {},
): (task: string, overrides?: AgentConfig) => Promise<ClaudeCodeResult> {
  const selectedDefaults = mergeAgentConfig(defaults, {});
  return (task: string, overrides: AgentConfig = {}) => {
    return executeAgent(task, mergeAgentConfig(selectedDefaults, overrides));
  };
}
