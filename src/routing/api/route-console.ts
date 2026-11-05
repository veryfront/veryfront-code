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
// method project code replaced: values are only read through descriptors,
// and output is built by string concatenation, which runs no project code.
const apply = Reflect.apply;
const objectKeys = Object.keys;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const isArray = Array.isArray;
const jsonStringify = JSON.stringify;
const IntrinsicString = String;
const IntrinsicNumber = Number;
const IntrinsicSet = Set;
const IntrinsicWeakSet = WeakSet;
const setHas = Set.prototype.has;
const setAdd = Set.prototype.add;
const setDelete = Set.prototype.delete;
const weakSetHas = WeakSet.prototype.has;
const weakSetAdd = WeakSet.prototype.add;
const numberParseInt = Number.parseInt;
const numberParseFloat = Number.parseFloat;
const dateToISOString = Date.prototype.toISOString;
const stringSlice = String.prototype.slice;
const stringIndexOf = String.prototype.indexOf;

const MAX_DEPTH = 4;
const MAX_ENTRIES = 50;
const MAX_NODES = 500;
/** Extra characters kept past the budget so a path at the cut still redacts. */
const REDACTION_MARGIN = 256;
const TRUNCATED = "… [truncated]";
const FORMAT_SPECIFIERS = "sdifjoOc";

/** Output built under a fixed character budget, so a huge value is never copied whole. */
interface FormatWriter {
  out: string;
  remaining: number;
  nodes: number;
  truncated: boolean;
}

function write(writer: FormatWriter, text: string): void {
  if (writer.truncated) return;
  if (text.length > writer.remaining) {
    writer.out += apply(stringSlice, text, [0, writer.remaining]) as string;
    writer.remaining = 0;
    writer.truncated = true;
    return;
  }
  writer.out += text;
  writer.remaining -= text.length;
}

/** Project text with filesystem paths redacted, read no further than the budget allows. */
function redactedText(writer: FormatWriter, text: string): string {
  const limit = writer.remaining + REDACTION_MARGIN;
  const bounded = text.length > limit ? apply(stringSlice, text, [0, limit]) as string : text;
  return redactFreeText(bounded);
}

/** An object or array whose own properties are rendered. */
type ConsoleValueContainer = Readonly<Record<string, unknown>>;

/** A data property's value; accessors are reported, never run. */
function readOwnData(
  value: ConsoleValueContainer | Error,
  key: string,
): { value: unknown } | string {
  const descriptor = getOwnPropertyDescriptor(value, key);
  if (!descriptor) return "undefined";
  if (!("value" in descriptor)) return "[Getter]";
  return { value: descriptor.value };
}

function writeError(writer: FormatWriter, error: Error): void {
  write(writer, redactedText(writer, readNativeErrorNameWithoutHooks(error)));
  const message = readOwnData(error, "message");
  if (typeof message === "string" || typeof message.value !== "string" || !message.value) return;
  write(writer, ": ");
  write(writer, redactedText(writer, message.value));
}

/**
 * Write a value without running project code: no `toJSON`, `toString`,
 * `valueOf` or getters, and never the value's own string conversion. Strings
 * and keys have filesystem paths redacted.
 */
function writeValue(
  writer: FormatWriter,
  value: unknown,
  depth: number,
  seen: Set<object>,
): void {
  if (writer.truncated) return;
  if (--writer.nodes < 0) {
    write(writer, "…");
    return;
  }
  if (typeof value === "string") {
    const text = redactedText(writer, value);
    write(writer, depth === 0 ? text : jsonStringify(text));
    return;
  }
  if (typeof value === "bigint") {
    write(writer, `${IntrinsicString(value)}n`);
    return;
  }
  if (
    value === null || value === undefined || typeof value === "number" ||
    typeof value === "boolean" || typeof value === "symbol"
  ) {
    write(writer, IntrinsicString(value));
    return;
  }
  if (typeof value === "function") return write(writer, "[Function]");
  if (isProxyWithoutHooks(value)) return write(writer, "[Proxy]");
  if (isNativeErrorWithoutHooks(value)) return writeError(writer, value);
  try {
    return write(writer, apply(dateToISOString, value, []) as string);
  } catch (_) {
    /* expected: not a Date */
  }
  if (apply(setHas, seen, [value])) return write(writer, "[Circular]");
  const array = isArray(value);
  if (depth >= MAX_DEPTH) return write(writer, array ? "[Array]" : "[Object]");

  apply(setAdd, seen, [value]);
  try {
    const keys = objectKeys(value);
    write(writer, array ? "[" : "{");
    for (let index = 0; index < keys.length && index < MAX_ENTRIES; index++) {
      if (writer.truncated) return;
      const key = keys[index]!;
      if (index > 0) write(writer, ",");
      if (!array) {
        write(writer, jsonStringify(redactedText(writer, key)));
        write(writer, ":");
      }
      const read = isSensitiveKey(key)
        ? REDACTED
        : readOwnData(value as ConsoleValueContainer, key);
      if (typeof read === "string") write(writer, read);
      else writeValue(writer, read.value, depth + 1, seen);
    }
    if (keys.length > MAX_ENTRIES) write(writer, ",…");
    write(writer, array ? "]" : "}");
  } catch (_) {
    write(writer, "[Unserializable]");
  } finally {
    apply(setDelete, seen, [value]);
  }
}

function writeArg(writer: FormatWriter, value: unknown): void {
  writeValue(writer, value, 0, new IntrinsicSet<object>());
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
 * Returns the index of the first argument the format string did not consume.
 */
function writeFormatString(writer: FormatWriter, args: readonly unknown[]): number {
  const format = redactedText(writer, args[0] as string);
  let next = 1;
  let index = 0;
  while (index < format.length && !writer.truncated) {
    const at = apply(stringIndexOf, format, ["%", index]) as number;
    if (at === -1 || at === format.length - 1) {
      write(writer, apply(stringSlice, format, [index]) as string);
      break;
    }
    write(writer, apply(stringSlice, format, [index, at]) as string);
    const specifier = format[at + 1]!;
    if (specifier === "%") {
      write(writer, "%");
    } else if (apply(stringIndexOf, FORMAT_SPECIFIERS, [specifier]) !== -1 && next < args.length) {
      const arg = args[next++];
      if (specifier === "c") {
        /* CSS styling has no meaning in a log line */
      } else if (specifier === "d" || specifier === "i" || specifier === "f") {
        write(writer, formatNumber(arg, specifier));
      } else {
        writeArg(writer, arg);
      }
    } else {
      write(writer, "%" + specifier);
    }
    index = at + 2;
  }
  return next;
}

/** Format console arguments into one message line of at most the limit. */
export function formatRouteConsoleMessage(args: readonly unknown[]): string {
  const writer: FormatWriter = {
    out: "",
    remaining: ROUTE_CONSOLE_MESSAGE_LIMIT,
    nodes: MAX_NODES,
    truncated: false,
  };
  let next = 0;
  if (typeof args[0] === "string" && apply(stringIndexOf, args[0], ["%"]) !== -1) {
    next = writeFormatString(writer, args);
  } else if (args.length > 0) {
    writeArg(writer, args[0]);
    next = 1;
  }
  for (; next < args.length && !writer.truncated; next++) {
    write(writer, " ");
    writeArg(writer, args[next]);
  }
  return writer.truncated ? writer.out + TRUNCATED : writer.out;
}

/** Every wrapper this module created, so a later install never wraps one twice. */
const captureWrappers = new IntrinsicWeakSet<ConsoleFunction>();
const installed: Partial<Record<CapturedMethod, ConsoleFunction>> = {};
const originals: Partial<Record<CapturedMethod, ConsoleFunction>> = {};

function captureWrapper(method: CapturedMethod, original: ConsoleFunction): ConsoleFunction {
  const wrapper = function routeConsoleCapture(this: unknown, ...args: unknown[]): void {
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
  apply(weakSetAdd, captureWrappers, [wrapper]);
  return wrapper;
}

/**
 * Wrap each console method that is not already ours. Outside a route scope a
 * wrapper passes calls straight through, so wrapping early is harmless. A
 * console that cannot be written (for example a frozen one) is left as it is.
 */
function installRouteConsoleCapture(): void {
  for (const method of CAPTURED_METHODS) {
    const current = console[method] as ConsoleFunction;
    if (typeof current !== "function" || apply(weakSetHas, captureWrappers, [current])) continue;
    const wrapper = captureWrapper(method, current);
    try {
      console[method] = wrapper;
    } catch (_) {
      // expected: a frozen console stays uncaptured rather than failing the request
      continue;
    }
    installed[method] = wrapper;
    originals[method] = current;
  }
}

// Wrap the console when the framework loads this module, before any route
// module is evaluated, so a route that keeps a reference such as
// `const log = console.log` at import time still reaches capture.
installRouteConsoleCapture();

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
  for (const method of CAPTURED_METHODS) {
    const wrapper = installed[method];
    if (wrapper && console[method] === wrapper) console[method] = originals[method]!;
    delete installed[method];
    delete originals[method];
  }
}

/** Whether `fn` is a route console capture wrapper. Testing only. */
export function __isRouteConsoleCaptureWrapperForTests(fn: unknown): boolean {
  return typeof fn === "function" && apply(weakSetHas, captureWrappers, [fn]) === true;
}
