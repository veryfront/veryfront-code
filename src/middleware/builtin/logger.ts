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
  const now = new Date();
  return now.toISOString().replace("T", " ").replace("Z", "");
}

function getRemoteAddr(req: Request): string {
  return req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "-";
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

function formatJsonLog(
  req: Request,
  status: number,
  duration: number,
): string {
  const url = new URL(req.url);
  const userAgent = req.headers.get("user-agent");
  const referer = req.headers.get("referer");
  const requestId = req.headers.get("x-request-id");
  const traceId = req.headers.get("x-trace-id") ?? req.headers.get("traceparent");
  const projectSlug = req.headers.get("x-project-slug");

  const entry: HttpLogEntry = {
    timestamp: new Date().toISOString(),
    level: getLogLevel(status),
    service: "server",
    message: `${req.method} ${url.pathname} ${status}`,
    http: {
      method: req.method,
      path: url.pathname,
      status,
      durationMs: Math.round(duration),
      remoteAddr: getRemoteAddr(req),
      ...(userAgent && userAgent !== "-" && { userAgent }),
      ...(referer && referer !== "-" && { referer }),
    },
    ...(requestId && { requestId }),
    ...(traceId && { traceId }),
    ...(projectSlug && { projectSlug }),
  };

  return JSON.stringify(entry);
}

function formatLog(
  format: LogFormat,
  req: Request,
  status: number,
  duration: number,
): string {
  const { pathname } = new URL(req.url);
  const { method } = req;
  const remoteAddr = getRemoteAddr(req);
  const timestamp = getTimestamp();
  const userAgent = req.headers.get("user-agent") || "-";
  const referer = req.headers.get("referer") || "-";

  switch (format) {
    case "json":
      return formatJsonLog(req, status, duration);

    case "combined":
      return `${remoteAddr} - - [${timestamp}] "${method} ${pathname} HTTP/1.1" ${status} - "${referer}" "${userAgent}" ${
        formatDuration(duration)
      }`;

    case "common":
      return `${remoteAddr} - - [${timestamp}] "${method} ${pathname} HTTP/1.1" ${status} - ${
        formatDuration(duration)
      }`;

    case "dev": {
      const statusColor = getStatusColor(status);
      const methodColor = getMethodColor(method);
      return `${methodColor}${method}${colors.reset} ${pathname} ${statusColor}${status}${colors.reset} ${colors.gray}${
        formatDuration(duration)
      }${colors.reset}`;
    }

    case "short":
      return `${method} ${pathname} ${status} ${formatDuration(duration)} - ${remoteAddr}`;

    case "tiny":
      return `${method} ${pathname} ${status} ${formatDuration(duration)}`;

    default:
      return formatLog("dev", req, status, duration);
  }
}

export function logger(options?: LoggerOptions): Middleware {
  const format = options?.format ?? "dev";
  const skip = options?.skip;
  // For JSON format, output directly to console to preserve structure
  const isJson = format === "json";
  const log = options?.log ??
    (isJson ? (msg: string) => console.log(msg) : (msg: string) => serverLogger.info(msg));

  const logError = (message: string): void => {
    log(isJson ? message : `${message} ${colors.red}[ERROR]${colors.reset}`);
  };

  return async (ctx, next) => {
    const req = getRequest(ctx);

    if (skip?.(req)) {
      return next();
    }

    const start = performance.now();

    try {
      const response = await next();
      const duration = performance.now() - start;

      if (!response) {
        logError(formatLog(format, req, HTTP_SERVER_ERROR, duration));
        return response;
      }

      log(formatLog(format, req, response.status, duration));
      return response;
    } catch (error) {
      const duration = performance.now() - start;
      logError(formatLog(format, req, HTTP_SERVER_ERROR, duration));
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
