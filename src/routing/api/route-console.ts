/**
 * Route console capture.
 *
 * Project logs are structured log lines that carry the request's
 * `project_id`. A route handler's own `console.*` output used to reach only the
 * process stdout as plain text, so it never showed up in project logs. While a
 * host-realm route handler runs, its `console.log/info/warn/error/debug` calls
 * are written through the request's logger instead, tagged as route console
 * output.
 *
 * Capture is scoped with AsyncLocalStorage, so concurrent requests from
 * different projects keep their own logger, and work the handler schedules
 * (timers, promise callbacks, stream starts) stays attributed to its request.
 * Calls outside a route scope, and the framework logger's own console writes,
 * pass through to the original console unchanged.
 *
 * @module routing/api/route-console
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { Logger } from "#veryfront/utils/logger/logger.ts";
import { isFrameworkConsoleWrite } from "#veryfront/utils/logger/logger.ts";
import { getRequestLogger } from "#veryfront/utils/logger/request-context.ts";
import { sanitizeStructuredTelemetryData } from "#veryfront/observability/telemetry-error.ts";
import { redactedErrorMessage } from "./module-loader/path-redaction.ts";

/** Longest console message forwarded to project logs, in characters. */
export const ROUTE_CONSOLE_MESSAGE_LIMIT = 8192;

const CAPTURED_METHODS = ["log", "info", "warn", "error", "debug"] as const;
type CapturedMethod = typeof CAPTURED_METHODS[number];
type ConsoleFunction = (...args: unknown[]) => void;

const LOGGER_LEVEL: Readonly<Record<CapturedMethod, "debug" | "info" | "warn" | "error">> = {
  log: "info",
  info: "info",
  warn: "warn",
  error: "error",
  debug: "debug",
};

interface RouteConsoleScope {
  readonly logger: Logger;
}

const routeConsoleScope = new AsyncLocalStorage<RouteConsoleScope>();
const apply = Reflect.apply;

let installed: Record<CapturedMethod, ConsoleFunction> | null = null;
let originals: Record<CapturedMethod, ConsoleFunction> | null = null;

function formatArg(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) {
    return `${value.name}: ${redactedErrorMessage(value)}`;
  }
  try {
    const serialized = JSON.stringify(sanitizeStructuredTelemetryData(value));
    if (serialized !== undefined) return serialized;
  } catch (_) {
    /* expected: circular references or non-serializable values */
  }
  try {
    return String(value);
  } catch (_) {
    return "[Unserializable]";
  }
}

/** Format console arguments into one capped message line. */
export function formatRouteConsoleMessage(args: readonly unknown[]): string {
  const message = args.map(formatArg).join(" ");
  if (message.length <= ROUTE_CONSOLE_MESSAGE_LIMIT) return message;
  return `${message.slice(0, ROUTE_CONSOLE_MESSAGE_LIMIT)}… [truncated]`;
}

function captureWrapper(method: CapturedMethod, original: ConsoleFunction): ConsoleFunction {
  return function routeConsoleCapture(this: unknown, ...args: unknown[]): void {
    const scope = routeConsoleScope.getStore();
    if (scope && !isFrameworkConsoleWrite()) {
      try {
        scope.logger[LOGGER_LEVEL[method]](formatRouteConsoleMessage(args));
        return;
      } catch (_) {
        /* fall back to the original console so the output is never lost */
      }
    }
    apply(original, this ?? console, args);
  };
}

/**
 * Wrap the console once per process. An interceptor installed later wraps
 * ours and still reaches it, so the chain never grows per request.
 */
function installRouteConsoleCapture(): void {
  if (installed) return;
  const previous = {} as Record<CapturedMethod, ConsoleFunction>;
  const wrappers = {} as Record<CapturedMethod, ConsoleFunction>;
  for (const method of CAPTURED_METHODS) {
    previous[method] = console[method] as ConsoleFunction;
    wrappers[method] = captureWrapper(method, previous[method]);
    console[method] = wrappers[method];
  }
  originals = previous;
  installed = wrappers;
}

/**
 * Run a route handler with its console output written to the request's
 * project logs. Without a request logger (no project request context), the
 * handler runs unchanged.
 */
export function runWithRouteConsoleCapture<T>(fn: () => T): T {
  const requestLogger = getRequestLogger();
  if (!requestLogger) return fn();
  installRouteConsoleCapture();
  const logger = requestLogger.child({
    event_kind: "route_console",
    user_visible: "true",
  });
  return routeConsoleScope.run({ logger }, fn);
}

/** Restore the console methods replaced by route console capture. Testing only. */
export function __uninstallRouteConsoleCaptureForTests(): void {
  if (!installed || !originals) return;
  for (const method of CAPTURED_METHODS) {
    if (console[method] === installed[method]) console[method] = originals[method];
  }
  installed = null;
  originals = null;
}
