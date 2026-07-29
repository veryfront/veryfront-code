import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";
import { sanitizeTelemetryAttributes, sanitizeTelemetryText } from "./telemetry-error.ts";
import { MAX_APPLICATION_ERROR_CONTEXT_VALUE_LENGTH } from "./limits.ts";

export type ApplicationErrorContext = {
  boundary: string;
  method?: string;
  requestId?: string;
  spanId?: string;
  traceId?: string;
  attributes?: Record<string, string | number | boolean>;
};

export type ApplicationErrorReporter = {
  capture(error: unknown, context: ApplicationErrorContext): string | undefined;
  flush(timeoutMs?: number): Promise<boolean>;
};

let reporter: ApplicationErrorReporter | undefined;

export function setApplicationErrorReporter(
  nextReporter: ApplicationErrorReporter | undefined,
): void {
  reporter = nextReporter;
}

export function captureApplicationError(
  error: unknown,
  context: ApplicationErrorContext,
): string | undefined {
  if (isExpectedApplicationError(error)) return undefined;
  const currentReporter = reporter;
  if (!currentReporter) return undefined;

  try {
    const snapshot = snapshotApplicationErrorContext(context);
    return snapshot ? currentReporter.capture(error, snapshot) : undefined;
  } catch {
    // Error reporting is diagnostic and must never replace the application
    // failure or response that led to this capture attempt.
    return undefined;
  }
}

export async function flushApplicationErrors(timeoutMs = 2_000): Promise<boolean> {
  const currentReporter = reporter;
  if (!currentReporter) return true;
  if (
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 0 ||
    timeoutMs > MAX_TIMER_DELAY_MS
  ) {
    return false;
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<boolean>((resolve) => {
    timeout = setTimeout(() => resolve(false), timeoutMs);
  });
  const pending = Promise.resolve()
    .then(() => currentReporter.flush(timeoutMs))
    .then((result) => result === true, () => false);

  try {
    return await Promise.race([pending, deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export function isExpectedApplicationError(error: unknown): boolean {
  try {
    return error instanceof DOMException && error.name === "AbortError";
  } catch {
    return false;
  }
}

function snapshotApplicationErrorContext(
  context: ApplicationErrorContext,
): ApplicationErrorContext | null {
  if (context === null || typeof context !== "object") return null;
  const boundary = normalizeContextValue(context.boundary);
  if (!boundary) return null;

  const snapshot: ApplicationErrorContext = { boundary };
  for (const key of ["method", "requestId", "spanId", "traceId"] as const) {
    const value = context[key];
    if (value === undefined) continue;
    const normalized = normalizeContextValue(value);
    if (normalized) snapshot[key] = normalized;
  }
  const attributes = sanitizeTelemetryAttributes(context.attributes);
  if (attributes && Object.keys(attributes).length > 0) {
    snapshot.attributes = Object.freeze(attributes);
  }
  return Object.freeze(snapshot);
}

function normalizeContextValue(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return sanitizeTelemetryText(
    value.trim(),
    MAX_APPLICATION_ERROR_CONTEXT_VALUE_LENGTH,
  );
}
