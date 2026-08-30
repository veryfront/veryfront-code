import { isMissingFirstPartyExtensionModule } from "#veryfront/extensions/first-party-import.ts";
import {
  type ApplicationErrorContext,
  type ApplicationErrorReporter,
  captureApplicationError,
  flushApplicationErrors,
  setApplicationErrorReporter,
} from "#veryfront/observability/application-errors.ts";
import { isSentryEnabled } from "#veryfront/observability/sentry.ts";
import type { LogEntry, LogRecordEmitter } from "#veryfront/utils/logger/index.ts";
import { __subscribeLogRecordEmitter } from "#veryfront/utils/logger/logger.ts";
import { VERSION } from "#veryfront/utils/version.ts";

/** Environment used by node agent service application-error reporting. */
export type NodeAgentServiceApplicationErrorEnv = Record<string, string | undefined>;

/** Configuration used by node agent service Sentry application-error reporting. */
export type NodeAgentServiceSentryConfig = {
  dsn: string;
  environment: string;
  release?: string;
  serviceName: string;
};

/** Application-error lifecycle returned by node agent service Sentry initialization. */
export type NodeAgentServiceApplicationErrorLifecycle = {
  enabled: boolean;
  captureStartupError(error: unknown): void;
  flush(timeoutMs?: number): Promise<boolean>;
  reset(): void;
};

type SentryExtensionModule = {
  createNodeSentryApplicationErrorReporter(
    config: Required<NodeAgentServiceSentryConfig>,
  ): ApplicationErrorReporter;
};

type SentryExtensionLoader = () => Promise<SentryExtensionModule>;

const DEFAULT_SERVICE_NAME = "veryfront-agent";
const DEFAULT_ENVIRONMENT = "production";
const DEFAULT_FLUSH_TIMEOUT_MS = 2_000;
const MISSING_DSN_WARNING =
  "Sentry is enabled, but SENTRY_DSN is empty. Sentry reporting is disabled.";
const EXPECTED_ERROR_NAMES = new Set([
  "AbortError",
  // Provider 429s surface to users as RATE_LIMITED after bounded retries;
  // the serialized error carries no context statusCode, so filter by name
  // (Sentry group VERYFRONT-AGENT-G).
  "ProviderRateLimitError",
]);
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
let missingDsnWarningEmitted = false;

function readTrimmedEnv(
  env: NodeAgentServiceApplicationErrorEnv,
  key: string,
): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

/** Resolve node agent service Sentry config from environment. */
export function resolveNodeAgentServiceSentryConfig(
  env: NodeAgentServiceApplicationErrorEnv,
  defaultServiceName = DEFAULT_SERVICE_NAME,
): NodeAgentServiceSentryConfig | undefined {
  const dsn = readTrimmedEnv(env, "SENTRY_DSN");
  if (!isSentryEnabled(env.SENTRY_ENABLED)) return undefined;
  if (!dsn) return undefined;

  const serviceName = readTrimmedEnv(env, "SENTRY_SERVICE_NAME") ??
    readTrimmedEnv(env, "SENTRY_SERVICE") ??
    readTrimmedEnv(env, "OTEL_SERVICE_NAME") ??
    readTrimmedEnv(env, "npm_package_name") ??
    defaultServiceName;
  const environment = readTrimmedEnv(env, "SENTRY_ENVIRONMENT") ??
    readTrimmedEnv(env, "APP_ENVIRONMENT") ??
    readTrimmedEnv(env, "VERYFRONT_ENV") ??
    readTrimmedEnv(env, "VERYFRONT_ENVIRONMENT") ??
    readTrimmedEnv(env, "NODE_ENV") ??
    DEFAULT_ENVIRONMENT;
  const release = readTrimmedEnv(env, "SENTRY_RELEASE") ??
    readTrimmedEnv(env, "OTEL_SERVICE_VERSION") ??
    readTrimmedEnv(env, "RELEASE_VERSION") ??
    readTrimmedEnv(env, "VERYFRONT_VERSION") ??
    readTrimmedEnv(env, "npm_package_version") ??
    VERSION;

  return {
    dsn,
    environment,
    ...(release ? { release } : {}),
    serviceName,
  };
}

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
  const errorName = entry.error?.name;
  if (errorName && EXPECTED_ERROR_NAMES.has(errorName)) return true;
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
    reset: () => {},
  };
}

function deactivateCurrentLifecycle(): void {
  currentLifecycle?.reset();
  currentLifecycle = undefined;
  currentLifecycleOwner = undefined;
}

async function withWallClockTimeout(
  operation: Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation.catch(() => false),
      new Promise<boolean>((resolve) => {
        timeoutId = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

/**
 * Initialize or replace node agent service Sentry application-error reporting.
 *
 * An active lifecycle remains installed while an enabled replacement loads
 * and is only retired after the replacement reporter is ready to take over.
 */
export async function initializeNodeAgentServiceSentryApplicationErrors(options: {
  env: NodeAgentServiceApplicationErrorEnv;
  defaultServiceName?: string;
  loadExtension?: SentryExtensionLoader;
  flushTimeoutMs?: number;
}): Promise<NodeAgentServiceApplicationErrorLifecycle> {
  const initializationId = ++currentInitializationId;

  const config = resolveNodeAgentServiceSentryConfig(options.env, options.defaultServiceName);
  if (!config) {
    deactivateCurrentLifecycle();
    if (
      isSentryEnabled(options.env.SENTRY_ENABLED) &&
      !readTrimmedEnv(options.env, "SENTRY_DSN")
    ) {
      warnAboutMissingDsnOnce();
    }
    return defaultLifecycle();
  }

  const extension = await (options.loadExtension ?? loadNodeSentryExtension)();
  if (initializationId !== currentInitializationId) return defaultLifecycle();

  const reporter = extension.createNodeSentryApplicationErrorReporter({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release ?? "",
    serviceName: config.serviceName,
  });

  const previousLifecycle = currentLifecycle;
  const owner = Symbol("node-agent-service-sentry");
  const unsubscribeLogCapture = __subscribeLogRecordEmitter(
    createNodeAgentServiceLogApplicationErrorEmitter(),
  );
  let active = true;
  let logCaptureActive = true;
  const flushTimeoutMs = options.flushTimeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS;

  const lifecycle: NodeAgentServiceApplicationErrorLifecycle = {
    enabled: true,
    captureStartupError(error) {
      if (!active || currentLifecycleOwner !== owner) return;
      if (logCaptureActive) {
        logCaptureActive = false;
        unsubscribeLogCapture();
      }
      captureApplicationError(error, { boundary: "agent.process.startup" });
    },
    flush(timeoutMs = flushTimeoutMs) {
      if (!active || currentLifecycleOwner !== owner) return Promise.resolve(true);
      return withWallClockTimeout(flushApplicationErrors(timeoutMs), timeoutMs);
    },
    reset() {
      if (!active) return;
      active = false;
      if (logCaptureActive) {
        logCaptureActive = false;
        unsubscribeLogCapture();
      }
      if (currentLifecycleOwner === owner) {
        currentLifecycleOwner = undefined;
        currentLifecycle = undefined;
        setApplicationErrorReporter(undefined);
      }
    },
  };
  setApplicationErrorReporter(reporter);
  currentLifecycleOwner = owner;
  currentLifecycle = lifecycle;
  previousLifecycle?.reset();
  return lifecycle;
}

/** Reset node agent service Sentry state for tests. */
export function resetNodeAgentServiceSentryForTests(): void {
  currentInitializationId += 1;
  deactivateCurrentLifecycle();
  missingDsnWarningEmitted = false;
}

function warnAboutMissingDsnOnce(): void {
  if (missingDsnWarningEmitted) return;
  missingDsnWarningEmitted = true;
  console.warn(MISSING_DSN_WARNING);
}

async function loadNodeSentryExtension(): Promise<SentryExtensionModule> {
  let sourceError: unknown;
  for (
    const sourceSpecifier of [
      "../../../extensions/ext-observability-sentry/src/node.ts",
      "../../../extensions/ext-observability-sentry/src/node.js",
    ]
  ) {
    try {
      return await import(sourceSpecifier) as SentryExtensionModule;
    } catch (error) {
      if (
        !isMissingFirstPartyExtensionModule(error, ["extensions/ext-observability-sentry/src/node"])
      ) {
        throw error;
      }
      sourceError ??= error;
    }
  }

  try {
    return await import("@veryfront/ext-observability-sentry/node") as SentryExtensionModule;
  } catch (error) {
    if (!isMissingFirstPartyExtensionModule(error, ["@veryfront/ext-observability-sentry/node"])) {
      throw error;
    }
    if (error instanceof Error && sourceError !== undefined && error.cause === undefined) {
      error.cause = sourceError;
    }
    throw error;
  }
}
