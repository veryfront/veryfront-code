import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  buildHostedChildCompletedLog,
  buildHostedChildErrorLog,
  buildHostedChildExhaustedStepBudgetLog,
  createHostedChildExecutionLogWriter,
  writeHostedChildExecutionLogEntry,
} from "./hosted-child-execution-logging.ts";
import { HostedChildStreamIdleTimeoutError } from "./hosted-child-stream-watchdog.ts";

Deno.test("buildHostedChildExhaustedStepBudgetLog builds warning context", () => {
  assertEquals(
    buildHostedChildExhaustedStepBudgetLog({
      description: "Summarize docs",
      kind: "invoke_agent",
      stepCount: 10,
      maxSteps: 10,
      toolCallsLength: 3,
    }),
    {
      level: "warn",
      message: "Child fork exhausted step budget",
      context: {
        description: "Summarize docs",
        kind: "invoke_agent",
        stepCount: 10,
        maxSteps: 10,
        toolCalls: 3,
      },
    },
  );
});

Deno.test("buildHostedChildCompletedLog includes result length and preview", () => {
  const finalText = `${"a".repeat(210)}tail`;
  const result = buildHostedChildCompletedLog({
    description: "Summarize docs",
    kind: "invoke_agent",
    toolCallsLength: 2,
    finalText,
  });

  assertEquals(result.level, "info");
  assertEquals(result.message, "Child fork completed");
  assertEquals(result.context.resultLength, 214);
  assertEquals(result.context.resultPreview, "a".repeat(200));
});

Deno.test("buildHostedChildErrorLog returns stalled warning for idle timeout errors", () => {
  const result = buildHostedChildErrorLog({
    description: "Summarize docs",
    kind: "invoke_agent",
    error: new HostedChildStreamIdleTimeoutError({
      phase: "generic_idle",
      timeoutMs: 45_000,
    }),
    finalText: "partial",
    toolCallsLength: 4,
    toolResultsLength: 3,
  });

  assertEquals(result, {
    level: "warn",
    message: "Child fork stream stalled",
    context: {
      description: "Summarize docs",
      kind: "invoke_agent",
      phase: "generic_idle",
      idleTimeoutMs: 45_000,
      partialTextLength: 7,
      toolCalls: 4,
      toolResults: 3,
    },
  });
});

Deno.test("buildHostedChildErrorLog returns failure error for generic errors", () => {
  const error = new Error("boom");
  const result = buildHostedChildErrorLog({
    description: "Summarize docs",
    kind: "invoke_agent",
    error,
    finalText: "partial",
    toolCallsLength: 4,
    toolResultsLength: 3,
  });

  assertEquals(result, {
    level: "error",
    message: "Child fork failed",
    context: {
      description: "Summarize docs",
      kind: "invoke_agent",
      error,
    },
  });
});

Deno.test("writeHostedChildExecutionLogEntry dispatches entries by level", () => {
  const calls: Array<{
    level: "error" | "info" | "warn";
    message: string;
    context: Record<string, unknown>;
  }> = [];
  const writer = {
    error: (message: string, context: Record<string, unknown>) => {
      calls.push({ level: "error", message, context });
    },
    info: (message: string, context: Record<string, unknown>) => {
      calls.push({ level: "info", message, context });
    },
    warn: (message: string, context: Record<string, unknown>) => {
      calls.push({ level: "warn", message, context });
    },
  };

  const errorContext = { error: "boom" };
  const infoContext = { resultLength: 7 };
  const warnContext = { stepCount: 10 };

  writeHostedChildExecutionLogEntry(
    {
      level: "error",
      message: "Child fork failed",
      context: errorContext,
    },
    writer,
  );
  writeHostedChildExecutionLogEntry(
    {
      level: "info",
      message: "Child fork completed",
      context: infoContext,
    },
    writer,
  );
  writeHostedChildExecutionLogEntry(
    {
      level: "warn",
      message: "Child fork exhausted step budget",
      context: warnContext,
    },
    writer,
  );

  assertEquals(calls, [
    { level: "error", message: "Child fork failed", context: errorContext },
    { level: "info", message: "Child fork completed", context: infoContext },
    {
      level: "warn",
      message: "Child fork exhausted step budget",
      context: warnContext,
    },
  ]);
});

Deno.test("createHostedChildExecutionLogWriter adapts a logger to an entry writer", () => {
  const calls: Array<{
    level: "error" | "info" | "warn";
    message: string;
    context: Record<string, unknown>;
  }> = [];
  const writeLog = createHostedChildExecutionLogWriter({
    error: (message: string, context: Record<string, unknown>) => {
      calls.push({ level: "error", message, context });
    },
    info: (message: string, context: Record<string, unknown>) => {
      calls.push({ level: "info", message, context });
    },
    warn: (message: string, context: Record<string, unknown>) => {
      calls.push({ level: "warn", message, context });
    },
  });
  const context = { phase: "generic_idle" };

  writeLog({
    level: "warn",
    message: "Child fork stream stalled",
    context,
  });

  assertEquals(calls, [
    {
      level: "warn",
      message: "Child fork stream stalled",
      context,
    },
  ]);
});
