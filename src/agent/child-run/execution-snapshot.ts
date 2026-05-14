export interface ChildRunExecutionUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ChildRunToolCallSnapshot {
  toolName: string;
  toolCallId: string;
  input?: unknown;
}

export interface ChildRunToolResultSnapshot {
  toolName: string;
  toolCallId: string;
  input: unknown;
  output: unknown;
}

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

export type ChildRunExecutionResult =
  | {
    success: true;
    description: string;
    summary: { text: string };
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

export interface ChildRunResultCommon {
  description: string;
  steps: number;
  toolCalls: ChildRunToolCallSnapshot[];
  toolResults: ChildRunToolResultSnapshot[];
  usage?: ChildRunExecutionUsage;
  durationMs: number;
}

export function getChildRunSnapshotUsage(
  snapshot: ChildRunExecutionSnapshot | null,
): ChildRunExecutionSnapshot["usage"] | undefined {
  return snapshot?.usage;
}

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

export function buildChildRunResultCommon(input: ChildRunResultCommon): ChildRunResultCommon {
  return input;
}

export function buildChildRunSuccessResult(
  common: ChildRunResultCommon,
  summary: { text: string },
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
