import {
  type ChatStreamWatchdogOptions,
  createChatStreamWatchdog,
} from "#veryfront/chat/stream-watchdog.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { getVeryfrontCloudProviderFromModelId } from "#veryfront/provider";
import type { AgentTraceAttributes } from "./trace-attributes.ts";
import type { HostedChatExecutionRuntimeLogger } from "./chat-execution-runtime.ts";
import type { PreparedHostedChatExecutionRuntimeOptions } from "./prepared-chat-execution.ts";

/** Environment key for hosted chat stream idle timeout. */
export const VERYFRONT_CHAT_STREAM_IDLE_TIMEOUT_ENV = "VERYFRONT_CHAT_STREAM_IDLE_TIMEOUT_MS";
/** Environment key for hosted chat stream active tool timeout. */
export const VERYFRONT_CHAT_STREAM_TOOL_TIMEOUT_ENV = "VERYFRONT_CHAT_STREAM_TOOL_TIMEOUT_MS";

type ChatStreamWatchdogEnv = Record<string, string | undefined>;

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** Resolve Veryfront Cloud chat stream watchdog timeout overrides from environment values. */
export function resolveVeryfrontCloudChatStreamWatchdogOptions(
  env: ChatStreamWatchdogEnv = {
    [VERYFRONT_CHAT_STREAM_IDLE_TIMEOUT_ENV]: getEnv(VERYFRONT_CHAT_STREAM_IDLE_TIMEOUT_ENV),
    [VERYFRONT_CHAT_STREAM_TOOL_TIMEOUT_ENV]: getEnv(VERYFRONT_CHAT_STREAM_TOOL_TIMEOUT_ENV),
  },
): Pick<ChatStreamWatchdogOptions, "idleTimeoutMs" | "toolRunningTimeoutMs"> {
  const idleTimeoutMs = parsePositiveInteger(env[VERYFRONT_CHAT_STREAM_IDLE_TIMEOUT_ENV]);
  const toolRunningTimeoutMs = parsePositiveInteger(env[VERYFRONT_CHAT_STREAM_TOOL_TIMEOUT_ENV]);

  return {
    ...(idleTimeoutMs !== undefined ? { idleTimeoutMs } : {}),
    ...(toolRunningTimeoutMs !== undefined ? { toolRunningTimeoutMs } : {}),
  };
}

/** Derive hosted chat bootstrap watchdog options from resolved root stream watchdog options. */
export function resolveVeryfrontCloudStreamBootstrapWatchdogOptions(
  options: Pick<ChatStreamWatchdogOptions, "idleTimeoutMs" | "toolRunningTimeoutMs">,
): Pick<
  PreparedHostedChatExecutionRuntimeOptions,
  "streamBootstrapKeepaliveIntervalMs" | "streamBootstrapTimeoutMs"
> {
  const streamBootstrapKeepaliveIntervalMs = typeof options.idleTimeoutMs === "number"
    ? Math.max(1, Math.floor(options.idleTimeoutMs / 2))
    : undefined;

  return {
    ...(streamBootstrapKeepaliveIntervalMs !== undefined
      ? { streamBootstrapKeepaliveIntervalMs }
      : {}),
    ...(options.toolRunningTimeoutMs !== undefined
      ? { streamBootstrapTimeoutMs: options.toolRunningTimeoutMs }
      : {}),
  };
}

/** Input payload for create Veryfront Cloud prepared hosted chat execution runtime options. */
export type CreateVeryfrontCloudPreparedHostedChatExecutionRuntimeOptionsInput = {
  apiUrl: string | URL;
  tracer: PreparedHostedChatExecutionRuntimeOptions["tracer"];
  logger?: HostedChatExecutionRuntimeLogger;
  trace?: <TResult>(operationName: string, operation: () => Promise<TResult>) => Promise<TResult>;
  traceStream?: <TResult>(operation: () => Promise<TResult>) => Promise<TResult>;
  setActiveSpanAttributes?: (attributes: AgentTraceAttributes) => void;
  createRootStreamWatchdog?: PreparedHostedChatExecutionRuntimeOptions["createRootStreamWatchdog"];
  streamBootstrapKeepaliveIntervalMs?: PreparedHostedChatExecutionRuntimeOptions[
    "streamBootstrapKeepaliveIntervalMs"
  ];
  streamBootstrapTimeoutMs?: PreparedHostedChatExecutionRuntimeOptions[
    "streamBootstrapTimeoutMs"
  ];
};

/** Options accepted by create Veryfront Cloud prepared hosted chat execution runtime. */
export function createVeryfrontCloudPreparedHostedChatExecutionRuntimeOptions(
  input: CreateVeryfrontCloudPreparedHostedChatExecutionRuntimeOptionsInput,
): PreparedHostedChatExecutionRuntimeOptions {
  const watchdogOptions = resolveVeryfrontCloudChatStreamWatchdogOptions();
  const streamBootstrapOptions = resolveVeryfrontCloudStreamBootstrapWatchdogOptions(
    watchdogOptions,
  );

  return {
    apiUrl: input.apiUrl,
    tracer: input.tracer,
    resolveProvider: getVeryfrontCloudProviderFromModelId,
    trace: input.trace,
    traceStream: input.traceStream,
    createRootStreamWatchdog: input.createRootStreamWatchdog ??
      (() =>
        createChatStreamWatchdog({
          ...watchdogOptions,
          // `invoke_agent` delegates to a sub-agent and can outlast the idle
          // timeout; the shared watchdog no longer defaults this product-specific
          // exemption, so pass it explicitly for hosted runs.
          longRunningToolNames: ["invoke_agent"],
          setTimeoutFn: globalThis.setTimeout,
          clearTimeoutFn: globalThis.clearTimeout,
        })),
    streamBootstrapKeepaliveIntervalMs: input.streamBootstrapKeepaliveIntervalMs ??
      streamBootstrapOptions.streamBootstrapKeepaliveIntervalMs,
    streamBootstrapTimeoutMs: input.streamBootstrapTimeoutMs ??
      streamBootstrapOptions.streamBootstrapTimeoutMs,
    logger: input.logger,
    setActiveSpanAttributes: input.setActiveSpanAttributes,
  };
}
