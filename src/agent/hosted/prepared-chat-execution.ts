import type { AgentTraceAttributes } from "./trace-attributes.ts";
import { createAgUiChatUiTrackedBrowserResponse } from "../ag-ui/chat-ui-chunk-browser-encoder.ts";
import {
  type BootstrappedHostedChatExecutionRuntime,
  createBootstrappedHostedChatExecutionRuntime,
  type CreateBootstrappedHostedChatExecutionRuntimeInput,
} from "./chat-execution-runtime.ts";
import type { HostedAgentRunSpanFinalState } from "./agent-run-lifecycle.ts";
import { runHostedLifecycle } from "./lifecycle.ts";
import type { AgUiRuntimeRequest } from "../runtime/ag-ui-contract.ts";

/** Public API contract for prepared hosted chat execution. */
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

/** Options accepted by prepared hosted chat execution runtime. */
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
    | "streamBootstrapKeepaliveIntervalMs"
    | "streamBootstrapTimeoutMs"
    | "createTerminalAdapter"
  >
  & {
    apiUrl: string | URL;
    trace?: <TResult>(operationName: string, operation: () => Promise<TResult>) => Promise<TResult>;
    setActiveSpanAttributes?: (attributes: AgentTraceAttributes) => void;
  };

/** Input payload for prepared hosted chat execution stream. */
export type PreparedHostedChatExecutionStreamInput<
  TExecution extends PreparedHostedChatExecution = PreparedHostedChatExecution,
> = TExecution & {
  requestAbortSignal: AbortSignal;
  agUiInput: AgUiRuntimeRequest;
};

/** Input payload for prepared hosted chat execution detached. */
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
      ...input.execution.traceAttributes,
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
    ...(input.runtime.streamBootstrapKeepaliveIntervalMs !== undefined
      ? { streamBootstrapKeepaliveIntervalMs: input.runtime.streamBootstrapKeepaliveIntervalMs }
      : {}),
    ...(input.runtime.streamBootstrapTimeoutMs !== undefined
      ? { streamBootstrapTimeoutMs: input.runtime.streamBootstrapTimeoutMs }
      : {}),
    createTerminalAdapter: input.runtime.createTerminalAdapter,
    ...(input.responseMessageId ? { responseMessageId: input.responseMessageId } : {}),
  });
}

/** Response payload for stream prepared hosted chat execution to AG-UI. */
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

/** Run prepared hosted chat execution detached. */
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
        const result = await agentRunSpan.withContext(async () => {
          return await runHostedLifecycle({
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
        agentRunSpan.finalize({ status: result.terminalState.status });
      } catch (error) {
        const finalStatus: HostedAgentRunSpanFinalState["status"] = input.execution.abortSignal
            .aborted
          ? "cancelled"
          : "failed";
        agentRunSpan.finalize({
          status: finalStatus,
          terminalErrorCode: finalStatus === "cancelled" ? "ABORTED" : "STREAM_ERROR",
          terminalErrorMessage: error instanceof Error ? error.message : String(error),
        });
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
