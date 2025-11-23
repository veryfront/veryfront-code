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
} from "@veryfront/utils";

export type LogFormat = "combined" | "common" | "dev" | "short" | "tiny";

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

function getMethodColor(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return colors.green;
    case "POST":
      return colors.cyan;
    case "PUT":
      return colors.yellow;
    case "DELETE":
      return colors.red;
    default:
      return colors.reset;
  }
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

function formatLog(
  format: LogFormat,
  req: Request,
  status: number,
  duration: number,
): string {
  const url = new URL(req.url);
  const method = req.method;
  const pathname = url.pathname;
  const remoteAddr = getRemoteAddr(req);
  const timestamp = getTimestamp();
  const userAgent = req.headers.get("user-agent") || "-";
  const referer = req.headers.get("referer") || "-";

  switch (format) {
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
  const log = options?.log ?? ((msg: string) => serverLogger.info(msg));

  return async (ctx, next) => {
    const req = getRequest(ctx);

    if (skip && skip(req)) {
      return next();
    }

    const start = performance.now();

    try {
      const response = await next();

      const duration = performance.now() - start;

      if (!response) {
        const message = formatLog(format, req, HTTP_SERVER_ERROR, duration);
        log(`${message} ${colors.red}[ERROR]${colors.reset}`);
        return response;
      }

      const message = formatLog(format, req, response.status, duration);
      log(message);

      return response;
    } catch (error) {
      const duration = performance.now() - start;
      const message = formatLog(format, req, HTTP_SERVER_ERROR, duration);
      log(`${message} ${colors.red}[ERROR]${colors.reset}`);
      throw error;
    }
  };
}

export function devLogger(): Middleware {
  return logger({ format: "dev" });
}

export function prodLogger(): Middleware {
  return logger({ format: "combined" });
}
