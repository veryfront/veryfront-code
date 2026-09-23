/** Keep invocation resources alive until its response finishes or is cancelled. */
export function withResponseCleanup(
  response: Response,
  cleanup: () => void,
  signal: AbortSignal,
): Response {
  if (!response.body) {
    cleanup();
    return response;
  }
  const reader = response.body.getReader();
  let finished = false;
  let cancellation: Promise<void> | undefined;
  const finish = () => {
    if (finished) return;
    finished = true;
    signal.removeEventListener("abort", abort);
    try {
      cleanup();
    } finally {
      reader.releaseLock();
    }
  };
  const cancel = (reason: unknown): Promise<void> => {
    if (finished) return cancellation ?? Promise.resolve();
    cancellation ??= Promise.resolve().then(() => reader.cancel(reason)).finally(finish);
    return cancellation;
  };
  const abort = () => {
    // Cancellation failure still retires the invocation, and must not create
    // an unhandled rejection in the request signal's event listener.
    void cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (finished) {
            if (cancellation) await cancellation;
            controller.close();
            return;
          }
          const result = await reader.read();
          if (result.done) {
            if (cancellation) await cancellation;
            finish();
            controller.close();
          } else controller.enqueue(result.value);
        } catch (error) {
          finish();
          controller.error(error);
        }
      },
      cancel,
    }, { highWaterMark: 0 }),
    { status: response.status, statusText: response.statusText, headers: response.headers },
  );
}
