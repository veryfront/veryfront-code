import { isErrorAcrossRealms } from "#veryfront/platform/compat/error-introspection.ts";

/**
 * Convert an arbitrary abort reason into the framework's stable Error shape.
 *
 * A cancellation reason is one of the few values that routinely crosses a realm
 * on its way here — it is minted by whoever called `abort()`, which can be a
 * worker, a host runtime, or another instance of this module graph. Testing it
 * with `instanceof` would drop those reasons on the floor and replace the real
 * cause of a cancellation with a generic message, so the brand check is used
 * instead. Reasons that are not errors at all (a string, `undefined`, a plain
 * object) still become the framework's AbortError, as before.
 */
export function createAbortError(reason?: unknown): Error {
  if (isErrorAcrossRealms(reason)) {
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
