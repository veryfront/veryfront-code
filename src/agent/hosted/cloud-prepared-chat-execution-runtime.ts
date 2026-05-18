import { createChatStreamWatchdog } from "#veryfront/chat/stream-watchdog.ts";
import { getVeryfrontCloudProviderFromModelId } from "#veryfront/provider";
import type { AgentTraceAttributes } from "./trace-attributes.ts";
import type { HostedChatExecutionRuntimeLogger } from "./chat-execution-runtime.ts";
import type { PreparedHostedChatExecutionRuntimeOptions } from "./prepared-chat-execution.ts";

/** Input payload for create Veryfront Cloud prepared hosted chat execution runtime options. */
export type CreateVeryfrontCloudPreparedHostedChatExecutionRuntimeOptionsInput = {
  apiUrl: string | URL;
  tracer: PreparedHostedChatExecutionRuntimeOptions["tracer"];
  logger?: HostedChatExecutionRuntimeLogger;
  trace?: <TResult>(operationName: string, operation: () => Promise<TResult>) => Promise<TResult>;
  traceStream?: <TResult>(operation: () => Promise<TResult>) => Promise<TResult>;
  setActiveSpanAttributes?: (attributes: AgentTraceAttributes) => void;
  createRootStreamWatchdog?: PreparedHostedChatExecutionRuntimeOptions["createRootStreamWatchdog"];
};

/** Options accepted by create Veryfront Cloud prepared hosted chat execution runtime. */
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
