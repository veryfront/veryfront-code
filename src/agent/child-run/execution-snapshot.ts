import type { ChildRunResultSummary } from "./result-summary.ts";

/** Public API contract for child run execution usage. */
export interface ChildRunExecutionUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/** Public API contract for child run tool call snapshot. */
export interface ChildRunToolCallSnapshot {
  toolName: string;
  toolCallId: string;
  input?: unknown;
}

/** Public API contract for child run tool result snapshot. */
export interface ChildRunToolResultSnapshot {
  toolName: string;
  toolCallId: string;
  input: unknown;
  output: unknown;
}

/** Public API contract for child run execution snapshot. */
export interface ChildRunExecutionSnapshot {
  success: boolean;
  description: string;
  fullResultText: string | null;
  error: string | null;
  steps: number;
  toolCalls: ChildRunToolCallSnapshot[];
  toolResults: ChildRunToolResultSnapshot[];
  usage?: ChildRunExecutionUsage;
  durationMs: number;
}

/** Result returned from child run execution. */
export type ChildRunExecutionResult =
  | {
    success: true;
    description: string;
    summary: ChildRunResultSummary;
    steps: number;
    toolCalls: ChildRunToolCallSnapshot[];
    toolResults: ChildRunToolResultSnapshot[];
    usage?: ChildRunExecutionUsage;
    durationMs: number;
  }
  | {
    success: false;
    description: string;
    error: string;
    steps: number;
    toolCalls: ChildRunToolCallSnapshot[];
    toolResults: ChildRunToolResultSnapshot[];
    usage?: ChildRunExecutionUsage;
    durationMs: number;
  };

/** Public API contract for child run result common. */
export interface ChildRunResultCommon {
  description: string;
  steps: number;
  toolCalls: ChildRunToolCallSnapshot[];
  toolResults: ChildRunToolResultSnapshot[];
  usage?: ChildRunExecutionUsage;
  durationMs: number;
}

/** Return child run snapshot usage. */
export function getChildRunSnapshotUsage(
  snapshot: ChildRunExecutionSnapshot | null,
): ChildRunExecutionSnapshot["usage"] | undefined {
  return snapshot?.usage;
}

/** Builds child run execution snapshot. */
export function buildChildRunExecutionSnapshot(
  result: ChildRunExecutionResult,
): ChildRunExecutionSnapshot {
  return {
    success: result.success,
    description: result.description,
    fullResultText: result.success ? result.summary.text : null,
    error: result.success ? null : result.error,
    steps: result.steps,
    toolCalls: result.toolCalls ?? [],
    toolResults: result.toolResults ?? [],
    usage: result.usage,
    durationMs: result.durationMs ?? 0,
  };
}

/** Builds child run result common. */
export function buildChildRunResultCommon(input: ChildRunResultCommon): ChildRunResultCommon {
  return input;
}

/** Result returned from build child run success. */
export function buildChildRunSuccessResult(
  common: ChildRunResultCommon,
  summary: ChildRunResultSummary,
): ChildRunExecutionResult & { success: true } {
  return {
    success: true,
    description: common.description,
    summary,
    steps: common.steps,
    toolCalls: common.toolCalls,
    toolResults: common.toolResults,
    usage: common.usage,
    durationMs: common.durationMs,
  };
}

/** Result returned from build child run failure. */
export function buildChildRunFailureResult(
  common: ChildRunResultCommon,
  error: string,
): ChildRunExecutionResult & { success: false } {
  return {
    success: false,
    description: common.description,
    error,
    steps: common.steps,
    toolCalls: common.toolCalls,
    toolResults: common.toolResults,
    usage: common.usage,
    durationMs: common.durationMs,
  };
}

/** Builds child run failure snapshot. */
export function buildChildRunFailureSnapshot(
  common: ChildRunResultCommon,
  error: string,
  fullResultText: string | null,
): ChildRunExecutionSnapshot {
  return {
    success: false,
    description: common.description,
    fullResultText,
    error,
    steps: common.steps,
    toolCalls: common.toolCalls,
    toolResults: common.toolResults,
    usage: common.usage,
    durationMs: common.durationMs,
  };
}

/** Builds child run success snapshot. */
export function buildChildRunSuccessSnapshot(
  common: ChildRunResultCommon,
  fullResultText: string,
): ChildRunExecutionSnapshot {
  return {
    success: true,
    description: common.description,
    fullResultText,
    error: null,
    steps: common.steps,
    toolCalls: common.toolCalls,
    toolResults: common.toolResults,
    usage: common.usage,
    durationMs: common.durationMs,
  };
}
