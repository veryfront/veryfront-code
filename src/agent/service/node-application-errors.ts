import {
  type ApplicationErrorContext,
  type ApplicationErrorReporterInitializer,
  captureApplicationError,
  initializeApplicationErrorReporter,
} from "#veryfront/observability/application-errors.ts";
import type { LogEntry, LogRecordEmitter } from "#veryfront/utils/logger/index.ts";
import { __subscribeLogRecordEmitter } from "#veryfront/utils/logger/index.ts";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";

/** Application-error lifecycle returned by node agent service initialization. */
export type NodeAgentServiceApplicationErrorLifecycle = {
  enabled: boolean;
  captureStartupError(error: unknown): void;
  flush(timeoutMs?: number): Promise<boolean>;
  dispose(): Promise<void>;
};

const DEFAULT_SERVICE_NAME = "veryfront-agent";
const DEFAULT_FLUSH_TIMEOUT_MS = 2_000;
const EXPECTED_ERROR_CODES = new Set([
  "AUTHENTICATION_REQUIRED",
  "CONTROL_PLANE_RUN_ID_MISMATCH",
  "FORBIDDEN",
  "INVALID_ARGUMENT",
  "NOT_FOUND",
  "PROJECT_ACCESS_DENIED",
  "VALIDATION_ERROR",
]);

let currentInitializationId = 0;
let currentLifecycle: NodeAgentServiceApplicationErrorLifecycle | undefined;
let currentLifecycleOwner: symbol | undefined;

function getExpectedErrorCode(entry: LogEntry): string | undefined {
  const code = entry.context?.errorCode ?? entry.context?.error_code ?? entry.context?.code;
  return typeof code === "string" ? code : undefined;
}

function getStatusCode(entry: LogEntry): number | undefined {
  const status = entry.context?.statusCode ?? entry.context?.status_code ?? entry.context?.status;
  return typeof status === "number" && Number.isInteger(status) ? status : undefined;
}

function getProcessRole(entry: LogEntry): string | undefined {
  const role = entry.process_role ?? entry.processRole ?? entry.context?.process_role ??
    entry.context?.processRole;
  return typeof role === "string" && role.trim() ? role.trim() : undefined;
}

function isExpectedAgentErrorLog(entry: LogEntry): boolean {
  if (entry.error?.name === "AbortError") return true;
  const errorCode = getExpectedErrorCode(entry);
  if (errorCode && EXPECTED_ERROR_CODES.has(errorCode)) return true;
  const statusCode = getStatusCode(entry);
  return statusCode !== undefined && statusCode >= 400 && statusCode < 500;
}

function addPrimitiveAttribute(
  attributes: Record<string, string | number | boolean>,
  key: string,
  value: unknown,
): void {
  if (typeof value === "string" || typeof value === "boolean") {
    attributes[key] = value;
    return;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    attributes[key] = value;
  }
}

function buildLogAttributes(entry: LogEntry): Record<string, string | number | boolean> {
  const attributes: Record<string, string | number | boolean> = {};
  addPrimitiveAttribute(attributes, "log.service", entry.service);
  addPrimitiveAttribute(attributes, "log.component", entry.component);
  addPrimitiveAttribute(attributes, "request.id", entry.request_id ?? entry.requestId);
  addPrimitiveAttribute(attributes, "trace.id", entry.trace_id ?? entry.traceId);
  addPrimitiveAttribute(attributes, "span.id", entry.span_id ?? entry.spanId);
  addPrimitiveAttribute(attributes, "project.id", entry.project_id);
  addPrimitiveAttribute(attributes, "project.slug", entry.project_slug ?? entry.projectSlug);
  addPrimitiveAttribute(attributes, "release.id", entry.release_id);
  addPrimitiveAttribute(attributes, "branch.id", entry.branch_id);
  addPrimitiveAttribute(attributes, "branch.name", entry.branch_name);
  addPrimitiveAttribute(attributes, "run.execution_id", entry.run_execution_id);
  addPrimitiveAttribute(attributes, "run.id", entry.run_id);
  addPrimitiveAttribute(attributes, "agent.id", entry.agent_id);
  addPrimitiveAttribute(
    attributes,
    "conversation.id",
    entry.conversation_id ?? entry.conversationId,
  );
  addPrimitiveAttribute(attributes, "schedule.id", entry.schedule_id);
  addPrimitiveAttribute(attributes, "schedule.name", entry.schedule_name);
  addPrimitiveAttribute(attributes, "tool.name", entry.tool_name);
  addPrimitiveAttribute(attributes, "tool.call_id", entry.tool_call_id);
  addPrimitiveAttribute(attributes, "task", entry.task);
  addPrimitiveAttribute(attributes, "event.kind", entry.event_kind);
  addPrimitiveAttribute(attributes, "duration.ms", entry.duration_ms ?? entry.durationMs);
  return attributes;
}

function errorFromLogEntry(entry: LogEntry): Error {
  if (!entry.error) return new Error(entry.message);
  const error = new Error(entry.error.message);
  error.name = entry.error.name;
  error.stack = entry.error.stack;
  return error;
}

function contextFromLogEntry(entry: LogEntry): ApplicationErrorContext {
  const processRole = getProcessRole(entry);
  return {
    boundary: "agent.framework-log",
    ...(processRole ? { processRole } : {}),
    requestId: entry.request_id ?? entry.requestId,
    spanId: entry.span_id ?? entry.spanId,
    traceId: entry.trace_id ?? entry.traceId,
    attributes: buildLogAttributes(entry),
  };
}

/** Convert agent framework error logs to application errors. */
export function createNodeAgentServiceLogApplicationErrorEmitter(): LogRecordEmitter {
  return (entry) => {
    if (entry.level !== "error" || isExpectedAgentErrorLog(entry)) return;
    captureApplicationError(errorFromLogEntry(entry), contextFromLogEntry(entry));
  };
}

function defaultLifecycle(): NodeAgentServiceApplicationErrorLifecycle {
  return {
    enabled: false,
    captureStartupError: () => {},
    flush: () => Promise.resolve(true),
    dispose: () => Promise.resolve(),
  };
}

async function deactivateCurrentLifecycle(): Promise<void> {
  const lifecycle = currentLifecycle;
  const owner = currentLifecycleOwner;
  if (!lifecycle) return;
  await lifecycle.dispose();
  if (currentLifecycle === lifecycle) currentLifecycle = undefined;
  if (currentLifecycleOwner === owner) currentLifecycleOwner = undefined;
}

function resolveFlushTimeout(value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_FLUSH_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 0 ||
    timeoutMs > MAX_TIMER_DELAY_MS
  ) {
    throw new RangeError("Application-error flush timeout must be a non-negative timer delay");
  }
  return timeoutMs;
}

/** Initialize an explicitly composed node agent service application-error reporter. */
export async function initializeNodeAgentServiceApplicationErrors(options: {
  initializer?: ApplicationErrorReporterInitializer;
  defaultServiceName?: string;
  flushTimeoutMs?: number;
}): Promise<NodeAgentServiceApplicationErrorLifecycle> {
  const flushTimeoutMs = resolveFlushTimeout(options.flushTimeoutMs);
  const initializationId = ++currentInitializationId;
  await deactivateCurrentLifecycle();
  if (initializationId !== currentInitializationId) return defaultLifecycle();

  const reporterLifecycle = await initializeApplicationErrorReporter({
    initializer: options.initializer,
    serviceName: options.defaultServiceName ?? DEFAULT_SERVICE_NAME,
  });
  if (initializationId !== currentInitializationId) {
    await reporterLifecycle.dispose();
    return defaultLifecycle();
  }
  if (!reporterLifecycle.enabled) return defaultLifecycle();

  const owner = Symbol("node-agent-service-application-errors");
  let unsubscribeLogCapture: () => void;
  try {
    unsubscribeLogCapture = __subscribeLogRecordEmitter(
      createNodeAgentServiceLogApplicationErrorEmitter(),
    );
  } catch (subscriptionError) {
    try {
      await reporterLifecycle.dispose();
    } catch (disposeError) {
      throw new AggregateError(
        [subscriptionError, disposeError],
        "Application-error log subscription and reporter cleanup both failed",
      );
    }
    throw subscriptionError;
  }
  currentLifecycleOwner = owner;
  let active = true;
  let logCaptureActive = true;
  let disposal: Promise<void> | undefined;

  const lifecycle: NodeAgentServiceApplicationErrorLifecycle = Object.freeze({
    enabled: true,
    captureStartupError(error) {
      if (!active || currentLifecycleOwner !== owner) return;
      if (logCaptureActive) {
        logCaptureActive = false;
        unsubscribeLogCapture();
      }
      reporterLifecycle.capture(error, { boundary: "agent.process.startup" });
    },
    flush(timeoutMs = flushTimeoutMs) {
      if (!active || currentLifecycleOwner !== owner) return Promise.resolve(true);
      return reporterLifecycle.flush(timeoutMs);
    },
    dispose() {
      if (disposal) return disposal;
      active = false;
      if (logCaptureActive) {
        logCaptureActive = false;
        unsubscribeLogCapture();
      }
      if (currentLifecycleOwner === owner) {
        currentLifecycleOwner = undefined;
        currentLifecycle = undefined;
      }
      disposal = reporterLifecycle.dispose();
      return disposal;
    },
  });
  currentLifecycle = lifecycle;
  return lifecycle;
}
