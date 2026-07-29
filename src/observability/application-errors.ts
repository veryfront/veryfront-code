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
  try {
    return reporter?.capture(error, context);
  } catch {
    return undefined;
  }
}

export function flushApplicationErrors(timeoutMs = 2_000): Promise<boolean> {
  try {
    return reporter?.flush(timeoutMs) ?? Promise.resolve(true);
  } catch {
    return Promise.resolve(false);
  }
}

export function isExpectedApplicationError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
