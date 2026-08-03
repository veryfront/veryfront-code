export interface EsbuildBuildContextLike<T> {
  rebuild(): Promise<T>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}

/**
 * Run one active esbuild context build with abort-driven cancellation.
 * Cleanup failures remain observable after success, but never replace the
 * build or abort error that caused cleanup.
 */
export async function rebuildContextWithSignal<T>(
  context: EsbuildBuildContextLike<T>,
  signal: AbortSignal,
): Promise<T> {
  let cancellation: Promise<void> | undefined;
  let primaryError: unknown;
  let cleanupError: unknown;
  let result: T | undefined;
  const cancel = (): void => {
    if (cancellation) return;
    cancellation = Promise.resolve().then(() => context.cancel());
    // Observe immediately; the primary flow awaits it during cleanup.
    void cancellation.catch(() => undefined);
  };

  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    signal.throwIfAborted();
    try {
      result = await context.rebuild();
      signal.throwIfAborted();
    } catch (error) {
      signal.throwIfAborted();
      throw error;
    }
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
    try {
      await cancellation;
    } catch (error) {
      cleanupError = error;
    }
    try {
      await context.dispose();
    } catch (error) {
      cleanupError ??= error;
    }
  }

  if (primaryError === undefined && cleanupError !== undefined) throw cleanupError;
  return result as T;
}
