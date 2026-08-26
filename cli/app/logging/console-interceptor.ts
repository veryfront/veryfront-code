/**
 * Console Interceptor
 *
 * Intercepts console output and routes it to the TUI log display.
 * Parses request logs to extract metadata for structured display.
 */

import { getLogBuffer } from "#veryfront/observability/log-buffer.ts";
import type { LogMeta, StateUpdater } from "../state.ts";
import { addLog } from "../state.ts";
import { ANSI_REGEX } from "../../ui/ansi.ts";

/**
 * Parse HTTP request log format into structured metadata
 *
 * Format: METHOD PATH STATUS DURATIONms [PROJECT:ENV:RELEASE]
 * Example: GET /api/users 200 45ms myapp:production:v1.0.0
 */
export function parseRequestLog(msg: string): LogMeta | undefined {
  const match = msg.match(
    /^\s*(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\S+)\s+(\d{3})\s+(\d+)ms(?:\s+(\S+))?/,
  );
  if (!match) return undefined;

  const [, method, path, status, duration, context] = match;
  const meta: LogMeta = {
    method,
    path,
    status: parseInt(status!, 10),
    durationMs: parseInt(duration!, 10),
  };

  if (context) {
    const parts = context.split(":");
    if (parts[0]) meta.project = parts[0];
    if (parts[1]) meta.env = parts[1];
    if (parts[2]) meta.releaseId = parts[2];
  }

  return meta;
}

/**
 * Create a console capture function for a specific log level
 */
export function createCapture(
  level: "info" | "warn" | "error" | "debug",
  updateState: (updater: StateUpdater) => void,
  render: () => void,
): (...args: unknown[]) => void {
  const logBuffer = getLogBuffer();

  return (...args: unknown[]): void => {
    const msg = args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ")
      .replace(ANSI_REGEX, "");

    if (!msg.trim()) return;

    const meta = parseRequestLog(msg);
    updateState(addLog(level, msg, meta));
    logBuffer.append({ level, message: msg, source: "console" });
    render();
  };
}

export interface InterceptOptions {
  updateState: (updater: StateUpdater) => void;
  render: () => void;
}

/**
 * Intercept all console methods and route to TUI logs
 * Returns a cleanup function to restore original console
 */
export function interceptConsole(options: InterceptOptions): () => void {
  const { updateState, render } = options;

  const original = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
    debug: console.debug,
  };

  console.log = createCapture("info", updateState, render);
  console.error = createCapture("error", updateState, render);
  console.warn = createCapture("warn", updateState, render);
  console.info = createCapture("info", updateState, render);
  console.debug = createCapture("debug", updateState, render);

  return () => {
    Object.assign(console, original);
  };
}
