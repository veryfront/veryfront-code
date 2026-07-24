import { getEnv } from "./env.ts";
import { getTraceContext } from "./tracing.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { PROXY_RUNTIME_VERSION } from "./version.ts";
import {
  ANSI,
  colorize,
  formatContextText,
  formatTimestamp,
  isRecord,
  LEVEL_COLORS,
  LEVEL_GLYPHS,
  type LogLevelName,
  padTag,
  type SerializedError,
  serializeError,
} from "#veryfront/utils/logger/core.ts";

/**
 * Request context for proxy logging.
 * Stored in AsyncLocalStorage to propagate through the call stack.
 */
interface ProxyRequestContext {
  requestId: string;
  projectSlug?: string;
  projectId?: string;
  releaseId?: string;
  branchId?: string;
  branchName?: string;
  domain?: string;
  environment?: string;
}

const requestContextStore = new AsyncLocalStorage<ProxyRequestContext>();

/**
 * Run a function with proxy request context.
 * All logs within the function will include the request context fields.
 */
export function runWithProxyRequestContext<T>(
  context: ProxyRequestContext,
  fn: () => T,
): T {
  return requestContextStore.run(context, fn);
}

/**
 * Get the current proxy request context (if any).
 */
function getProxyRequestContext(): ProxyRequestContext | undefined {
  return requestContextStore.getStore();
}

export type LogLevel = LogLevelName;

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Log level configuration
const MIN_LOG_LEVEL: LogLevel = (() => {
  const level = getEnv("LOG_LEVEL")?.toLowerCase();
  if (level === "debug" || level === "info" || level === "warn" || level === "error") {
    return level;
  }
  return "info"; // Default: suppress debug logs
})();

function isTty(): boolean {
  try {
    if (typeof Deno !== "undefined" && typeof Deno.stdout?.isTerminal === "function") {
      return Deno.stdout.isTerminal();
    }
  } catch (_) {
    // expected: TTY detection may be unavailable
  }

  const stdout = (globalThis as { process?: { stdout?: { isTTY?: boolean } } }).process?.stdout;
  return stdout?.isTTY ?? false;
}

function shouldUseColor(): boolean {
  const env = {
    noColor: getEnv("NO_COLOR"),
    forceColor: getEnv("FORCE_COLOR"),
    logColor: getEnv("LOG_COLOR"),
    ci: getEnv("CI"),
  };

  if (env.forceColor === "0" || env.logColor === "0") return false;
  if (env.noColor !== undefined || env.ci !== undefined) return false;
  if (env.forceColor) return true;
  if (env.logColor === "1" || env.logColor === "true") return true;
  return isTty();
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  veryfrontVersion: string;
  message: string;
  traceId?: string;
  spanId?: string;
  // Request context fields (at top level for Grafana filtering)
  requestId?: string;
  projectSlug?: string;
  projectId?: string;
  releaseId?: string;
  branchId?: string;
  branchName?: string;
  domain?: string;
  environment?: string;
  context?: Record<string, unknown>;
  error?: SerializedError;
}

function formatTextLine(
  level: LogLevel,
  message: string,
  context: Record<string, unknown> | undefined,
  error: SerializedError | undefined,
): string {
  const enableColor = shouldUseColor();
  const timestamp = colorize(formatTimestamp(), ANSI.dim, enableColor);
  const tag = colorize(padTag("PROXY"), ANSI.cyan, enableColor);
  const glyph = colorize(LEVEL_GLYPHS[level], LEVEL_COLORS[level], enableColor);
  const contextText = formatContextText(context ?? {}, error, enableColor);
  return `${timestamp}  ${tag} ${glyph} ${message}${contextText}`;
}

function isProduction(): boolean {
  return getEnv("NODE_ENV") === "production";
}

function getLogFormat(): "json" | "text" {
  const format = getEnv("LOG_FORMAT");
  if (format === "json" || format === "text") return format;
  return isProduction() ? "json" : "text";
}

class ProxyLogger {
  private format = getLogFormat();

  private log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: unknown,
  ): void {
    if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[MIN_LOG_LEVEL]) return;

    if (this.format !== "json") {
      console.log(formatTextLine(level, message, context, serializeError(error)));
      return;
    }

    const traceCtx = getTraceContext();
    const reqCtx = getProxyRequestContext();

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: "proxy",
      veryfrontVersion: PROXY_RUNTIME_VERSION,
      message,
      ...(traceCtx.traceId && { traceId: traceCtx.traceId, spanId: traceCtx.spanId }),
      // Include request context fields at top level (like renderer logs)
      ...(reqCtx?.requestId && { requestId: reqCtx.requestId }),
      ...(reqCtx?.projectSlug && { projectSlug: reqCtx.projectSlug }),
      ...(reqCtx?.projectId && { projectId: reqCtx.projectId }),
      ...(reqCtx?.releaseId && { releaseId: reqCtx.releaseId }),
      ...(reqCtx?.branchId && { branchId: reqCtx.branchId }),
      ...(reqCtx?.branchName && { branchName: reqCtx.branchName }),
      ...(reqCtx?.domain && { domain: reqCtx.domain }),
      ...(reqCtx?.environment && { environment: reqCtx.environment }),
    };

    if (context && Object.keys(context).length > 0) entry.context = context;

    const serializedError = serializeError(error);
    if (serializedError) entry.error = serializedError;

    console.log(JSON.stringify(entry));
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log("debug", message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log("info", message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log("warn", message, context);
  }

  error(message: string, error?: unknown): void;
  error(message: string, context: Record<string, unknown>, error?: unknown): void;
  error(
    message: string,
    contextOrError?: Record<string, unknown> | unknown,
    error?: unknown,
  ): void {
    if (error !== undefined) {
      this.log("error", message, contextOrError as Record<string, unknown>, error);
      return;
    }

    if (contextOrError instanceof Error) {
      this.log("error", message, undefined, contextOrError);
      return;
    }

    this.log("error", message, contextOrError as Record<string, unknown>);
  }

  /**
   * Create a child logger with bound context.
   */
  child(context: Record<string, unknown>): ChildProxyLogger {
    return new ChildProxyLogger(this, context);
  }
}

class ChildProxyLogger {
  constructor(
    private parent: ProxyLogger,
    private boundContext: Record<string, unknown>,
  ) {}

  private merge(ctx?: Record<string, unknown>): Record<string, unknown> {
    return { ...this.boundContext, ...ctx };
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.parent.debug(message, this.merge(context));
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.parent.info(message, this.merge(context));
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.parent.warn(message, this.merge(context));
  }

  error(message: string, error?: unknown): void;
  error(message: string, context: Record<string, unknown>, error?: unknown): void;
  error(
    message: string,
    contextOrError?: Record<string, unknown> | unknown,
    error?: unknown,
  ): void {
    if (error !== undefined) {
      this.parent.error(message, this.merge(contextOrError as Record<string, unknown>), error);
      return;
    }

    if (contextOrError instanceof Error) {
      this.parent.error(message, this.boundContext, contextOrError);
      return;
    }

    if (isRecord(contextOrError)) {
      this.parent.error(message, this.merge(contextOrError));
      return;
    }

    this.parent.error(message, this.merge(contextOrError as Record<string, unknown>));
  }

  child(context: Record<string, unknown>): ChildProxyLogger {
    return new ChildProxyLogger(this.parent, this.merge(context));
  }
}

export const proxyLogger = new ProxyLogger();
