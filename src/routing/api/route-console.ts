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
import {
  isFrameworkConsoleWrite,
  isLogLevelEnabled,
  LogLevel,
} from "#veryfront/utils/logger/logger.ts";
import { getRequestLogger } from "#veryfront/utils/logger/request-context.ts";
import { isSensitiveKey, REDACTED } from "#veryfront/utils/logger/redact.ts";
import {
  isNativeErrorWithoutHooks,
  isProxyWithoutHooks,
  readNativeErrorNameWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";
import { redactFreeText } from "./module-loader/path-redaction.ts";

/** Longest console message forwarded to project logs, in characters. */
export const ROUTE_CONSOLE_MESSAGE_LIMIT = 8192;

const CAPTURED_METHODS = ["log", "info", "warn", "error", "debug"] as const;
type CapturedMethod = typeof CAPTURED_METHODS[number];
type ConsoleFunction = (...args: unknown[]) => void;
type LoggerMethod = "debug" | "info" | "warn" | "error";

const LOGGER_METHOD: Readonly<Record<CapturedMethod, LoggerMethod>> = {
  log: "info",
  info: "info",
  warn: "warn",
  error: "error",
  debug: "debug",
};

const LOGGER_LEVEL: Readonly<Record<LoggerMethod, LogLevel>> = {
  debug: LogLevel.DEBUG,
  info: LogLevel.INFO,
  warn: LogLevel.WARN,
  error: LogLevel.ERROR,
};

interface RouteConsoleScope {
  readonly logger: Logger;
}

const routeConsoleScope = new AsyncLocalStorage<RouteConsoleScope>();

// Intrinsics captured before project code runs, so formatting never calls a
// method project code replaced.
const apply = Reflect.apply;
const objectKeys = Object.keys;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const isArray = Array.isArray;
const jsonStringify = JSON.stringify;
const IntrinsicString = String;
const IntrinsicNumber = Number;
const numberParseInt = Number.parseInt;
const numberParseFloat = Number.parseFloat;
const dateToISOString = Date.prototype.toISOString;
const stringSlice = String.prototype.slice;
const stringIndexOf = String.prototype.indexOf;

const MAX_DEPTH = 4;
const MAX_ENTRIES = 50;
const MAX_NODES = 500;

interface FormatBudget {
  nodes: number;
}

/** A data property's value; accessors are reported, never run. */
function readOwnData(value: object, key: string): { value: unknown } | string {
  const descriptor = getOwnPropertyDescriptor(value, key);
  if (!descriptor) return "undefined";
  if (!("value" in descriptor)) return "[Getter]";
  return { value: descriptor.value };
}

function formatError(error: Error): string {
  const name = redactFreeText(readNativeErrorNameWithoutHooks(error));
  const message = readOwnData(error, "message");
  const text = typeof message === "string" || typeof message.value !== "string"
    ? ""
    : redactFreeText(message.value);
  return text ? `${name}: ${text}` : name;
}

/**
 * Render a value without running project code: no `toJSON`, `toString`,
 * `valueOf` or getters, and never the value's own string conversion.
 */
function formatValue(
  value: unknown,
  depth: number,
  seen: Set<object>,
  budget: FormatBudget,
): string {
  if (--budget.nodes < 0) return "…";
  if (typeof value === "string") return depth === 0 ? value : jsonStringify(value);
  if (typeof value === "bigint") return `${IntrinsicString(value)}n`;
  if (
    value === null || value === undefined || typeof value === "number" ||
    typeof value === "boolean" || typeof value === "symbol"
  ) {
    return IntrinsicString(value);
  }
  if (typeof value === "function") return "[Function]";
  if (isProxyWithoutHooks(value)) return "[Proxy]";
  if (isNativeErrorWithoutHooks(value)) return formatError(value);
  try {
    return apply(dateToISOString, value, []) as string;
  } catch (_) {
    /* expected: not a Date */
  }
  if (seen.has(value)) return "[Circular]";
  if (depth >= MAX_DEPTH) return isArray(value) ? "[Array]" : "[Object]";

  seen.add(value);
  try {
    const keys = objectKeys(value);
    const parts: string[] = [];
    for (let index = 0; index < keys.length && index < MAX_ENTRIES; index++) {
      const key = keys[index]!;
      const read = isSensitiveKey(key) ? REDACTED : readOwnData(value, key);
      const rendered = typeof read === "string"
        ? read
        : formatValue(read.value, depth + 1, seen, budget);
      parts.push(isArray(value) ? rendered : `${jsonStringify(key)}:${rendered}`);
    }
    if (keys.length > MAX_ENTRIES) parts.push("…");
    return isArray(value) ? `[${parts.join(",")}]` : `{${parts.join(",")}}`;
  } catch (_) {
    return "[Unserializable]";
  } finally {
    seen.delete(value);
  }
}

function formatArg(value: unknown, budget: FormatBudget): string {
  return formatValue(value, 0, new Set(), budget);
}

/** `%d`, `%i` and `%f` take primitives only; an object would run `valueOf`. */
function formatNumber(value: unknown, specifier: string): string {
  if (typeof value === "bigint") return `${IntrinsicString(value)}n`;
  if (typeof value === "object" || typeof value === "function" || typeof value === "symbol") {
    return "NaN";
  }
  if (specifier === "i") return IntrinsicString(numberParseInt(IntrinsicString(value), 10));
  if (specifier === "f") return IntrinsicString(numberParseFloat(IntrinsicString(value)));
  return IntrinsicString(IntrinsicNumber(value));
}

/**
 * Apply console format specifiers (`%s %d %i %f %j %o %O %c %%`) in a leading
 * format string, as the console does, then append the remaining arguments.
 */
function formatWithSpecifiers(args: readonly unknown[], budget: FormatBudget): string[] {
  const format = args[0];
  if (typeof format !== "string" || apply(stringIndexOf, format, ["%"]) === -1) {
    return args.map((arg) => formatArg(arg, budget));
  }
  let next = 1;
  let out = "";
  let index = 0;
  while (index < format.length) {
    const at = apply(stringIndexOf, format, ["%", index]) as number;
    if (at === -1 || at === format.length - 1) {
      out += apply(stringSlice, format, [index]);
      break;
    }
    out += apply(stringSlice, format, [index, at]);
    const specifier = format[at + 1]!;
    if (specifier === "%") {
      out += "%";
    } else if ("sdifjoOc".includes(specifier) && next < args.length) {
      const arg = args[next++];
      if (specifier === "c") {
        /* CSS styling has no meaning in a log line */
      } else if (specifier === "d" || specifier === "i" || specifier === "f") {
        out += formatNumber(arg, specifier);
      } else {
        out += formatArg(arg, budget);
      }
    } else {
      out += `%${specifier}`;
    }
    index = at + 2;
  }
  return [out, ...args.slice(next).map((arg) => formatArg(arg, budget))];
}

/** Format console arguments into one capped message line. */
export function formatRouteConsoleMessage(args: readonly unknown[]): string {
  const message = formatWithSpecifiers(args, { nodes: MAX_NODES }).join(" ");
  if (message.length <= ROUTE_CONSOLE_MESSAGE_LIMIT) return message;
  return `${apply(stringSlice, message, [0, ROUTE_CONSOLE_MESSAGE_LIMIT])}… [truncated]`;
}

let installed: Record<CapturedMethod, ConsoleFunction> | null = null;
let originals: Record<CapturedMethod, ConsoleFunction> | null = null;

function captureWrapper(method: CapturedMethod, original: ConsoleFunction): ConsoleFunction {
  return function routeConsoleCapture(this: unknown, ...args: unknown[]): void {
    const scope = routeConsoleScope.getStore();
    const loggerMethod = LOGGER_METHOD[method];
    // A level the logger would drop goes to the console as before, so a
    // route's `console.debug` or `console.log` is never silently lost.
    if (scope && !isFrameworkConsoleWrite() && isLogLevelEnabled(LOGGER_LEVEL[loggerMethod])) {
      try {
        scope.logger[loggerMethod](formatRouteConsoleMessage(args));
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
