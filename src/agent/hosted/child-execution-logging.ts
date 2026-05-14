import { HostedChildStreamIdleTimeoutError } from "./child-stream-watchdog.ts";

export type HostedChildExecutionLogLevel = "error" | "info" | "warn";

export interface HostedChildExecutionLogEntry {
  level: HostedChildExecutionLogLevel;
  message: string;
  context: Record<string, unknown>;
}

export interface HostedChildExecutionLogWriter {
  error: (message: string, context: Record<string, unknown>) => void;
  info: (message: string, context: Record<string, unknown>) => void;
  warn: (message: string, context: Record<string, unknown>) => void;
}

export function writeHostedChildExecutionLogEntry(
  entry: HostedChildExecutionLogEntry,
  writer: HostedChildExecutionLogWriter,
): void {
  if (entry.level === "error") {
    writer.error(entry.message, entry.context);
    return;
  }

  if (entry.level === "info") {
    writer.info(entry.message, entry.context);
    return;
  }

  writer.warn(entry.message, entry.context);
}

export function createHostedChildExecutionLogWriter(
  writer: HostedChildExecutionLogWriter,
): (entry: HostedChildExecutionLogEntry) => void {
  return (entry) => {
    writeHostedChildExecutionLogEntry(entry, writer);
  };
}

export function buildHostedChildExhaustedStepBudgetLog(input: {
  description: string;
  kind: string;
  stepCount: number;
  maxSteps: number;
  toolCallsLength: number;
}): HostedChildExecutionLogEntry {
  return {
    level: "warn",
    message: "Child fork exhausted step budget",
    context: {
      description: input.description,
      kind: input.kind,
      stepCount: input.stepCount,
      maxSteps: input.maxSteps,
      toolCalls: input.toolCallsLength,
    },
  };
}

export function buildHostedChildCompletedLog(input: {
  description: string;
  kind: string;
  toolCallsLength: number;
  finalText: string;
}): HostedChildExecutionLogEntry {
  return {
    level: "info",
    message: "Child fork completed",
    context: {
      description: input.description,
      kind: input.kind,
      toolCalls: input.toolCallsLength,
      resultLength: input.finalText.length,
      resultPreview: input.finalText.substring(0, 200),
    },
  };
}

export function buildHostedChildErrorLog(input: {
  description: string;
  kind: string;
  error: unknown;
  finalText: string;
  toolCallsLength: number;
  toolResultsLength: number;
}): HostedChildExecutionLogEntry {
  if (input.error instanceof HostedChildStreamIdleTimeoutError) {
    return {
      level: "warn",
      message: "Child fork stream stalled",
      context: {
        description: input.description,
        kind: input.kind,
        phase: input.error.phase,
        idleTimeoutMs: input.error.timeoutMs,
        partialTextLength: input.finalText.length,
        toolCalls: input.toolCallsLength,
        toolResults: input.toolResultsLength,
      },
    };
  }

  return {
    level: "error",
    message: "Child fork failed",
    context: {
      description: input.description,
      kind: input.kind,
      error: input.error,
    },
  };
}
