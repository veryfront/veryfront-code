import { createChatStreamWatchdog } from "#veryfront/chat/stream-watchdog.ts";
import { getVeryfrontCloudProviderFromModelId } from "#veryfront/provider";
import type { AgentTraceAttributes } from "./agent-trace-attributes.ts";
import type { HostedChatExecutionRuntimeLogger } from "./hosted/chat-execution-runtime.ts";
import type { PreparedHostedChatExecutionRuntimeOptions } from "./prepared-hosted-chat-execution.ts";

export type CreateVeryfrontCloudPreparedHostedChatExecutionRuntimeOptionsInput = {
  apiUrl: string | URL;
  tracer: PreparedHostedChatExecutionRuntimeOptions["tracer"];
  logger?: HostedChatExecutionRuntimeLogger;
  trace?: <TResult>(operationName: string, operation: () => Promise<TResult>) => Promise<TResult>;
  traceStream?: <TResult>(operation: () => Promise<TResult>) => Promise<TResult>;
  setActiveSpanAttributes?: (attributes: AgentTraceAttributes) => void;
  createRootStreamWatchdog?: PreparedHostedChatExecutionRuntimeOptions["createRootStreamWatchdog"];
};

export function createVeryfrontCloudPreparedHostedChatExecutionRuntimeOptions(
  input: CreateVeryfrontCloudPreparedHostedChatExecutionRuntimeOptionsInput,
): PreparedHostedChatExecutionRuntimeOptions {
  return {
    apiUrl: input.apiUrl,
    tracer: input.tracer,
    resolveProvider: getVeryfrontCloudProviderFromModelId,
    trace: input.trace,
    traceStream: input.traceStream,
    createRootStreamWatchdog: input.createRootStreamWatchdog ??
      (() =>
        createChatStreamWatchdog({
          setTimeoutFn: globalThis.setTimeout,
          clearTimeoutFn: globalThis.clearTimeout,
        })),
    logger: input.logger,
    setActiveSpanAttributes: input.setActiveSpanAttributes,
  };
}
