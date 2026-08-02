/** Convert an arbitrary abort reason into the framework's stable Error shape. */
export function createAbortError(reason?: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }

  return new DOMException(
    typeof reason === "string" && reason.length > 0 ? reason : "The operation was aborted",
    "AbortError",
  );
}

/** Throw the normalized abort reason when a signal has already been aborted. */
export function throwIfAborted(abortSignal?: AbortSignal): void {
  if (abortSignal?.aborted) {
    throw createAbortError(abortSignal.reason);
  }
}

/**
 * Await a value while allowing cancellation to win even when the producer
 * ignores its signal.
 */
export async function awaitAbortable<T>(
  value: T | PromiseLike<T>,
  abortSignal?: AbortSignal,
): Promise<T> {
  if (!abortSignal) return await value;
  throwIfAborted(abortSignal);

  const result = await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(createAbortError(abortSignal.reason));
    abortSignal.addEventListener("abort", onAbort, { once: true });

    Promise.resolve(value).then(
      (result) => {
        abortSignal.removeEventListener("abort", onAbort);
        resolve(result);
      },
      (error: unknown) => {
        abortSignal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
  throwIfAborted(abortSignal);
  return result;
}
