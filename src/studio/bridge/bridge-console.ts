/**
 * Bridge Console Capture & Error Handling
 *
 * Intercepts console methods and runtime errors, forwarding them to Studio.
 */

import { CONSOLE_METHODS, state } from "./bridge-state.ts";
import { postToStudio } from "./bridge-messaging.ts";
import { hideOverlay } from "./bridge-inspector.ts";
import { getStudioLocationHref } from "./bridge-location.ts";
import { sanitizeStudioSourcePath } from "./bridge-source-path.ts";
import { sanitizeErrorText } from "#veryfront/errors/sanitization.ts";

const MAX_CONSOLE_ARGUMENTS = 100;
const MAX_CONSOLE_STRING_LENGTH = 65_536;
const MAX_SOURCE_POSITION = 10_000_000;
type ConsoleFn = (...args: unknown[]) => void;
const installedConsoleWrappers = new Map<string, ConsoleFn>();
const activeConsoleWrappers = new WeakSet<ConsoleFn>();
let consoleCaptureInitialized = false;
let errorHandlingInitialized = false;
let installedErrorListener: ((event: ErrorEvent) => void) | null = null;
let installedRejectionListener: ((event: PromiseRejectionEvent) => void) | null = null;

interface RuntimeErrorEventDetails {
  message?: unknown;
  filename?: unknown;
  lineno?: unknown;
  colno?: unknown;
}

interface RuntimeErrorDetails {
  type: "error";
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

type ErrorBrandCheck = (value: unknown) => boolean;

const errorBrandCheck: ErrorBrandCheck | null = (() => {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(Error, "isError");
    return descriptor && !descriptor.get && !descriptor.set &&
        typeof descriptor.value === "function"
      ? descriptor.value as ErrorBrandCheck
      : null;
  } catch {
    return null;
  }
})();

const nativeErrorStackGetter: ((this: Error) => unknown) | null = (() => {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(new Error(), "stack");
    return typeof descriptor?.get === "function" ? descriptor.get : null;
  } catch {
    return null;
  }
})();

function sanitizeConsoleText(value: string, maxLength = MAX_CONSOLE_STRING_LENGTH): string {
  return sanitizeErrorText(value, maxLength);
}

function readEventDetail(
  event: RuntimeErrorEventDetails,
  key: keyof RuntimeErrorEventDetails,
): unknown {
  try {
    return event[key];
  } catch {
    return undefined;
  }
}

function normalizeSourcePosition(value: unknown, allowZero: boolean): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value <= MAX_SOURCE_POSITION &&
      (allowZero ? value >= 0 : value > 0)
    ? value
    : undefined;
}

/** Normalize browser error-event fields to the renderer protocol bounds. */
export function buildRuntimeErrorDetails(event: RuntimeErrorEventDetails): RuntimeErrorDetails {
  const rawMessage = readEventDetail(event, "message");
  const rawFile = readEventDetail(event, "filename");
  const line = normalizeSourcePosition(readEventDetail(event, "lineno"), false);
  const column = normalizeSourcePosition(readEventDetail(event, "colno"), true);
  const file = typeof rawFile === "string"
    ? sanitizeStudioSourcePath(rawFile, "runtime")
    : undefined;

  return {
    type: "error",
    message: typeof rawMessage === "string" ? sanitizeConsoleText(rawMessage) : "Runtime error",
    ...(file === undefined ? {} : { file }),
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
  };
}

function currentRuntimeUrl(): string {
  return getStudioLocationHref({ includeSearch: false, includeHash: false });
}

function isNativeError(value: unknown): value is Error {
  if (!errorBrandCheck) return false;
  try {
    return errorBrandCheck(value);
  } catch {
    return false;
  }
}

function readOwnErrorString(error: Error, key: "name" | "message" | "stack"): string | undefined {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    if (key === "stack" && nativeErrorStackGetter && descriptor?.get === nativeErrorStackGetter) {
      const stack = nativeErrorStackGetter.call(error);
      return typeof stack === "string" ? sanitizeConsoleText(stack) : undefined;
    }
    return descriptor && !descriptor.get && !descriptor.set && typeof descriptor.value === "string"
      ? sanitizeConsoleText(descriptor.value)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Convert a console argument without invoking accessors, proxy traps, or
 * custom coercion. JavaScript provides no side-effect-free way to distinguish
 * a Proxy from an ordinary object, so arbitrary objects are intentionally
 * represented by an explicit opaque-object protocol marker. Log primitives or
 * an explicitly serialized string when Studio must display object details.
 */
export function formatConsoleValue(arg: unknown): unknown {
  if (arg === undefined) return { __isUndefined: true };
  if (arg === null) return null;
  if (typeof arg === "string") return sanitizeConsoleText(arg);
  if (typeof arg === "function") return { __isFunction: true };
  if (typeof arg === "symbol") return { __isSymbol: true };
  if (typeof arg === "bigint") {
    return { __isBigInt: true, value: sanitizeConsoleText(arg.toString()) };
  }
  if (typeof arg === "number" && !Number.isFinite(arg)) return sanitizeConsoleText(String(arg));
  if (typeof arg !== "object") return arg;
  if (isNativeError(arg)) {
    const stack = readOwnErrorString(arg, "stack");
    return {
      __isError: true,
      message: readOwnErrorString(arg, "message") ?? "Error",
      ...(stack ? { stack } : {}),
      name: readOwnErrorString(arg, "name") ?? "Error",
    };
  }
  return { __isOpaqueObject: true };
}

/** Produce a bounded rejection message without invoking user conversion hooks. */
export function safeRejectionMessage(reason: unknown): string {
  if (isNativeError(reason)) return readOwnErrorString(reason, "message") ?? "Unhandled error";
  if (typeof reason === "string") return sanitizeConsoleText(reason);
  if (
    typeof reason === "number" || typeof reason === "boolean" || typeof reason === "bigint"
  ) return sanitizeConsoleText(String(reason));
  return "Unhandled promise rejection";
}

export function setupConsoleCapture(): void {
  if (consoleCaptureInitialized) return;
  const consoleObj: Record<string, ConsoleFn> = console as unknown as Record<string, ConsoleFn>;
  CONSOLE_METHODS.forEach((method) => {
    const original = consoleObj[method];
    if (typeof original !== "function") return;
    state.originalConsole[method] = original;
    const wrapper = function (...args: unknown[]) {
      original.apply(console, args);
      if (!activeConsoleWrappers.has(wrapper)) return;

      const logId = "vf-" + Date.now() + "-" + ++state.logCounter;

      const formattedData = args.slice(0, MAX_CONSOLE_ARGUMENTS).map(formatConsoleValue);
      if (args.length > MAX_CONSOLE_ARGUMENTS) {
        formattedData.push({ __isTruncated: true, omitted: args.length - MAX_CONSOLE_ARGUMENTS });
      }

      postToStudio({
        action: "logEvent",
        value: {
          id: logId,
          method: method,
          data: formattedData,
          timestamp: new Date().toISOString(),
        },
      });
    };
    activeConsoleWrappers.add(wrapper);
    consoleObj[method] = wrapper;
    installedConsoleWrappers.set(method, wrapper);
  });
  consoleCaptureInitialized = true;
}

/** Restore console methods still owned by this bridge instance. */
export function disposeConsoleCapture(): void {
  if (!consoleCaptureInitialized && installedConsoleWrappers.size === 0) return;
  const consoleObj = console as unknown as Record<string, ConsoleFn>;
  for (const [method, wrapper] of installedConsoleWrappers) {
    activeConsoleWrappers.delete(wrapper);
    const original = state.originalConsole[method];
    if (consoleObj[method] === wrapper && typeof original === "function") {
      consoleObj[method] = original;
    }
    delete state.originalConsole[method];
  }
  installedConsoleWrappers.clear();
  consoleCaptureInitialized = false;
}

export function setupErrorHandling(): void {
  if (errorHandlingInitialized) return;
  function hideOverlays() {
    hideOverlay(state.hoverOverlay);
    hideOverlay(state.selectionOverlay);
  }

  const errorListener = function (event: ErrorEvent) {
    if (installedErrorListener !== errorListener) return;
    hideOverlays();
    postToStudio({
      action: "runtimeError",
      url: currentRuntimeUrl(),
      errors: [buildRuntimeErrorDetails(event)],
    });
  };

  const rejectionListener = function (event: PromiseRejectionEvent) {
    if (installedRejectionListener !== rejectionListener) return;
    hideOverlays();
    const reason = event.reason;
    postToStudio({
      action: "runtimeError",
      url: currentRuntimeUrl(),
      errors: [
        {
          type: "error",
          message: safeRejectionMessage(reason),
        },
      ],
    });
  };

  installedErrorListener = errorListener;
  installedRejectionListener = rejectionListener;

  globalThis.window.addEventListener("error", installedErrorListener);
  globalThis.window.addEventListener("unhandledrejection", installedRejectionListener);
  errorHandlingInitialized = true;
}

/** Remove bridge-owned global error listeners. */
export function disposeErrorHandling(): void {
  if (installedErrorListener) {
    globalThis.window.removeEventListener("error", installedErrorListener);
  }
  if (installedRejectionListener) {
    globalThis.window.removeEventListener("unhandledrejection", installedRejectionListener);
  }
  installedErrorListener = null;
  installedRejectionListener = null;
  errorHandlingInitialized = false;
}
