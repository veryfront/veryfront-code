import type { AgentTraceAttributes } from "./trace-attributes.ts";
import { createAgUiChatUiTrackedBrowserResponse } from "../ag-ui/chat-ui-chunk-browser-encoder.ts";
import {
  type BootstrappedHostedChatExecutionRuntime,
  createBootstrappedHostedChatExecutionRuntime,
  type CreateBootstrappedHostedChatExecutionRuntimeInput,
} from "./chat-execution-runtime.ts";
import { runHostedLifecycle } from "./lifecycle.ts";
import type { AgUiRuntimeRequest } from "../runtime/ag-ui-contract.ts";

export type PreparedHostedChatExecution =
  & Omit<
    CreateBootstrappedHostedChatExecutionRuntimeInput,
    | "apiUrl"
    | "abortSignal"
    | "responseMessageId"
    | "tracer"
    | "resolveProvider"
    | "traceStream"
    | "logger"
    | "spanName"
    | "terminalErrorCode"
    | "incompleteToolCallsPartErrorText"
    | "createRootStreamWatchdog"
    | "createTerminalAdapter"
  >
  & {
    runtimeKind?: string;
  };

export type PreparedHostedChatExecutionRuntimeOptions =
  & Pick<
    CreateBootstrappedHostedChatExecutionRuntimeInput,
    | "tracer"
    | "resolveProvider"
    | "traceStream"
    | "logger"
    | "spanName"
    | "terminalErrorCode"
    | "incompleteToolCallsPartErrorText"
    | "createRootStreamWatchdog"
    | "createTerminalAdapter"
  >
  & {
    apiUrl: string | URL;
    trace?: <TResult>(operationName: string, operation: () => Promise<TResult>) => Promise<TResult>;
    setActiveSpanAttributes?: (attributes: AgentTraceAttributes) => void;
  };

export type PreparedHostedChatExecutionStreamInput<
  TExecution extends PreparedHostedChatExecution = PreparedHostedChatExecution,
> = TExecution & {
  requestAbortSignal: AbortSignal;
  agUiInput: AgUiRuntimeRequest;
};

export type PreparedHostedChatExecutionDetachedInput<
  TExecution extends PreparedHostedChatExecution = PreparedHostedChatExecution,
> = TExecution & {
  abortSignal: AbortSignal;
};

function tracePreparedHostedChatExecution<TResult>(input: {
  spanName: string;
  execution: PreparedHostedChatExecution;
  runtime: PreparedHostedChatExecutionRuntimeOptions;
  run: () => Promise<TResult>;
}): Promise<TResult> {
  const run = async () => {
    input.runtime.setActiveSpanAttributes?.({
      "conversation.id": input.execution.conversationId,
      "project.id": input.execution.projectId ?? "none",
      "agent.runtime.kind": input.execution.runtimeKind,
    });
    return await input.run();
  };

  if (!input.runtime.trace) {
    return run();
  }

  return input.runtime.trace(input.spanName, run);
}

function createBootstrappedPreparedHostedChatExecutionRuntime(input: {
  execution: PreparedHostedChatExecution;
  abortSignal: AbortSignal;
  runtime: PreparedHostedChatExecutionRuntimeOptions;
  responseMessageId?: string;
}): Promise<BootstrappedHostedChatExecutionRuntime> {
  return createBootstrappedHostedChatExecutionRuntime({
    ...input.execution,
    apiUrl: input.runtime.apiUrl.toString(),
    abortSignal: input.abortSignal,
    tracer: input.runtime.tracer,
    resolveProvider: input.runtime.resolveProvider,
    traceStream: input.runtime.traceStream,
    logger: input.runtime.logger,
    spanName: input.runtime.spanName,
    terminalErrorCode: input.runtime.terminalErrorCode,
    incompleteToolCallsPartErrorText: input.runtime.incompleteToolCallsPartErrorText,
    createRootStreamWatchdog: input.runtime.createRootStreamWatchdog,
    createTerminalAdapter: input.runtime.createTerminalAdapter,
    ...(input.responseMessageId ? { responseMessageId: input.responseMessageId } : {}),
  });
}

export async function streamPreparedHostedChatExecutionToAgUiResponse<
  TExecution extends PreparedHostedChatExecution,
>(input: {
  execution: PreparedHostedChatExecutionStreamInput<TExecution>;
  runtime: PreparedHostedChatExecutionRuntimeOptions;
}): Promise<Response> {
  return await tracePreparedHostedChatExecution({
    spanName: "chat.streamToAgUiResponse",
    execution: input.execution,
    runtime: input.runtime,
    run: async () => {
      const agUiRunId = input.execution.agUiInput.runId ??
        input.execution.rootRunContext.durableRootRun?.runId;
      const { execution } = await createBootstrappedPreparedHostedChatExecutionRuntime({
        execution: input.execution,
        abortSignal: input.execution.requestAbortSignal,
        runtime: input.runtime,
        ...(agUiRunId ? { responseMessageId: `${agUiRunId}:assistant` } : {}),
      });

      return createAgUiChatUiTrackedBrowserResponse({
        agUiInput: input.execution.agUiInput,
        defaults: {
          ...(input.execution.conversationId ? { threadId: input.execution.conversationId } : {}),
          ...(agUiRunId ? { runId: agUiRunId } : {}),
        },
        agentId: input.execution.agentId,
        modelId: input.execution.modelId,
        execution,
      });
    },
  });
}

export async function runPreparedHostedChatExecutionDetached<
  TExecution extends PreparedHostedChatExecution,
>(input: {
  execution: PreparedHostedChatExecutionDetachedInput<TExecution>;
  runtime: PreparedHostedChatExecutionRuntimeOptions;
}): Promise<void> {
  await tracePreparedHostedChatExecution({
    spanName: "chat.runDetached",
    execution: input.execution,
    runtime: input.runtime,
    run: async () => {
      const { agentRunSpan, execution } =
        await createBootstrappedPreparedHostedChatExecutionRuntime({
          execution: input.execution,
          abortSignal: input.execution.abortSignal,
          runtime: input.runtime,
        });

      try {
        await agentRunSpan.withContext(async () => {
          await runHostedLifecycle({
            abortSignal: input.execution.abortSignal,
            execution: {
              stream: execution.agentUIStream,
              waitForFinish: execution.waitForFinish,
            },
            adapter: {
              startRun: () => ({
                runId: input.execution.rootRunContext.durableRootRun?.runId ?? "detached-run",
              }),
            },
            resolveTerminalState: () => ({
              status: input.execution.abortSignal.aborted ? "cancelled" : "completed",
            }),
          });
        });
      } catch (error) {
        input.runtime.logger?.error("Detached durable chat execution failed", {
          conversationId: input.execution.conversationId,
          runId: input.execution.rootRunContext.durableRootRun?.runId,
          error: error instanceof Error ? error.message : String(error),
        });
        await execution.fail(error);
      }
    },
  });
}
