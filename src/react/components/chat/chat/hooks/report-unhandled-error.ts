/**
 * Surface a consumer callback failure without relabeling it as a persistence
 * failure. Browsers with `reportError` receive the original value; other
 * runtimes receive an uncaught microtask error.
 *
 * @internal
 */
export function reportUnhandledError(cause: unknown): void {
  const reportError = (globalThis as { reportError?: (error: unknown) => void }).reportError;
  if (typeof reportError === "function") {
    reportError(cause);
    return;
  }
  queueMicrotask(() => {
    throw cause instanceof Error ? cause : new Error(String(cause));
  });
}
