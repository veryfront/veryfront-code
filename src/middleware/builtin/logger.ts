import type { Middleware } from "./types.ts";
import { getRequest } from "./types.ts";
import {
  HTTP_SERVER_ERROR,
  HTTP_STATUS_CLIENT_ERROR_MIN,
  HTTP_STATUS_REDIRECT_MIN,
  HTTP_STATUS_SERVER_ERROR_MIN,
  HTTP_STATUS_SUCCESS_MIN,
  MS_PER_SECOND,
  serverLogger,
} from "#veryfront/utils";

export type LogFormat = "combined" | "common" | "dev" | "short" | "tiny" | "json";

export interface LoggerOptions {
  format?: LogFormat;
  skip?: (req: Request) => boolean;
  log?: (message: string) => void;
}

interface RequestLogDetails {
  method: string;
  pathname: string;
  remoteAddr: string;
  referer?: string;
  requestId?: string;
  traceId?: string;
  projectSlug?: string;
  userAgent?: string;
}

const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function getStatusColor(status: number): string {
  if (status >= HTTP_STATUS_SERVER_ERROR_MIN) return colors.red;
  if (status >= HTTP_STATUS_CLIENT_ERROR_MIN) return colors.yellow;
  if (status >= HTTP_STATUS_REDIRECT_MIN) return colors.cyan;
  if (status >= HTTP_STATUS_SUCCESS_MIN) return colors.green;
  return colors.reset;
}

const methodColors: Record<string, string> = {
  GET: colors.green,
  POST: colors.cyan,
  PUT: colors.yellow,
  DELETE: colors.red,
};

function getMethodColor(method: string): string {
  return methodColors[method.toUpperCase()] ?? colors.reset;
}

function formatDuration(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < MS_PER_SECOND) return `${Math.round(ms)}ms`;
  return `${(ms / MS_PER_SECOND).toFixed(2)}s`;
}

function getTimestamp(): string {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

// deno-lint-ignore no-control-regex -- intentionally matching control chars to strip them
const HEADER_LOG_CONTROL_CHARS = /[\r\n\t\x00-\x1f\x7f]/g;
const HEADER_LOG_MAX_LENGTH = 256;

/**
 * Strip CR/LF/tab/other control characters and cap length before a user-controlled
 * header value is written to a log entry. Prevents log injection (CWE-117).
 *
 * Exported for direct unit testing — Deno's `Request` constructor rejects CR/LF
 * in header values, so the helper must be tested without going through `Request`.
 */
export function sanitizeHeaderForLog(value: string): string {
  return value.replace(HEADER_LOG_CONTROL_CHARS, "").slice(0, HEADER_LOG_MAX_LENGTH);
}

function readHeaderForLog(req: Request, name: string): string | null {
  const value = req.headers.get(name);
  return value === null ? null : sanitizeHeaderForLog(value);
}

function getRemoteAddr(req: Request): string {
  return readHeaderForLog(req, "x-forwarded-for") ?? readHeaderForLog(req, "x-real-ip") ?? "-";
}

function getRequestLogDetails(req: Request): RequestLogDetails {
  return {
    method: req.method,
    pathname: new URL(req.url).pathname,
    remoteAddr: getRemoteAddr(req),
    referer: readHeaderForLog(req, "referer") ?? undefined,
    requestId: readHeaderForLog(req, "x-request-id") ?? undefined,
    traceId: readHeaderForLog(req, "x-trace-id") ?? readHeaderForLog(req, "traceparent") ??
      undefined,
    projectSlug: readHeaderForLog(req, "x-project-slug") ?? undefined,
    userAgent: readHeaderForLog(req, "user-agent") ?? undefined,
  };
}

interface HttpLogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  service: string;
  message: string;
  http: {
    method: string;
    path: string;
    status: number;
    durationMs: number;
    remoteAddr: string;
    userAgent?: string;
    referer?: string;
  };
  requestId?: string;
  traceId?: string;
  projectSlug?: string;
}

function getLogLevel(status: number): HttpLogEntry["level"] {
  if (status >= HTTP_STATUS_SERVER_ERROR_MIN) return "error";
  if (status >= HTTP_STATUS_CLIENT_ERROR_MIN) return "warn";
  return "info";
}

function formatJsonLog(req: Request, status: number, duration: number): string {
  const details = getRequestLogDetails(req);

  const entry: HttpLogEntry = {
    timestamp: new Date().toISOString(),
    level: getLogLevel(status),
    service: "server",
    message: `${details.method} ${details.pathname} ${status}`,
    http: {
      method: details.method,
      path: details.pathname,
      status,
      durationMs: Math.round(duration),
      remoteAddr: details.remoteAddr,
      ...(details.userAgent && details.userAgent !== "-" ? { userAgent: details.userAgent } : {}),
      ...(details.referer && details.referer !== "-" ? { referer: details.referer } : {}),
    },
    ...(details.requestId ? { requestId: details.requestId } : {}),
    ...(details.traceId ? { traceId: details.traceId } : {}),
    ...(details.projectSlug ? { projectSlug: details.projectSlug } : {}),
  };

  return JSON.stringify(entry);
}

function formatLog(format: LogFormat, req: Request, status: number, duration: number): string {
  if (format === "json") return formatJsonLog(req, status, duration);

  const { pathname } = new URL(req.url);
  const { method } = req;
  const remoteAddr = getRemoteAddr(req);
  const timestamp = getTimestamp();
  const userAgent = readHeaderForLog(req, "user-agent") ?? "-";
  const referer = readHeaderForLog(req, "referer") ?? "-";
  const durationText = formatDuration(duration);

  switch (format) {
    case "combined":
      return `${remoteAddr} - - [${timestamp}] "${method} ${pathname} HTTP/1.1" ${status} - "${referer}" "${userAgent}" ${durationText}`;
    case "common":
      return `${remoteAddr} - - [${timestamp}] "${method} ${pathname} HTTP/1.1" ${status} - ${durationText}`;
    case "dev": {
      const statusColor = getStatusColor(status);
      const methodColor = getMethodColor(method);
      return `${methodColor}${method}${colors.reset} ${pathname} ${statusColor}${status}${colors.reset} ${colors.gray}${durationText}${colors.reset}`;
    }
    case "short":
      return `${method} ${pathname} ${status} ${durationText} - ${remoteAddr}`;
    case "tiny":
      return `${method} ${pathname} ${status} ${durationText}`;
    default:
      return formatLog("dev", req, status, duration);
  }
}

export function logger(options?: LoggerOptions): Middleware {
  const format = options?.format ?? "dev";
  const skip = options?.skip;
  const isJson = format === "json";
  const logFn = options?.log;

  function logMessage(req: Request, status: number, duration: number): void {
    if (logFn) {
      logFn(formatLog(format, req, status, duration));
      return;
    }

    if (!isJson) {
      serverLogger.info(formatLog(format, req, status, duration));
      return;
    }

    const details = getRequestLogDetails(req);

    serverLogger.info(`${details.method} ${details.pathname} ${status}`, {
      requestId: details.requestId,
      traceId: details.traceId,
      project_slug: details.projectSlug,
      request_url: details.pathname,
      durationMs: Math.round(duration),
      method: details.method,
      statusCode: status,
      remoteAddr: details.remoteAddr,
      ...(details.userAgent ? { userAgent: details.userAgent } : {}),
    });
  }

  return async (ctx, next) => {
    const req = getRequest(ctx);
    if (skip?.(req)) return next();

    const start = performance.now();

    try {
      const response = await next();
      const duration = performance.now() - start;

      logMessage(req, response?.status ?? HTTP_SERVER_ERROR, duration);
      return response;
    } catch (error) {
      const duration = performance.now() - start;
      logMessage(req, HTTP_SERVER_ERROR, duration);
      throw error;
    }
  };
}

export function devLogger(): Middleware {
  return logger({ format: "dev" });
}

export function prodLogger(): Middleware {
  return logger({ format: "json" });
}
