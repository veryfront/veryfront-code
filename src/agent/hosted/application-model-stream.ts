export interface ApplicationModelCallScope {
  signal: AbortSignal;
  dispose(): void;
}

/** Scope stream work and retain upstream cancellation until it settles. */
export function scopeApplicationModelStream(
  stream: ReadableStream<unknown>,
  control: ApplicationModelCallScope,
  assertActive: () => void,
  scoped: <T>(operation: () => T) => T,
): ReadableStream<unknown> {
  const { signal } = control;
  const reader = scoped(() => stream.getReader());
  let cancellation: Promise<void> | undefined;
  let finished = false;
  const cancel = () => cancellation ??= scoped(() => reader.cancel());
  let onAbort: (() => void) | undefined;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (onAbort) signal.removeEventListener("abort", onAbort);
    control.dispose();
    scoped(() => reader.releaseLock());
  };
  return new ReadableStream({
    start(controller) {
      // Capture the controller before registering or observing an abort.
      // Keep the outer stream readable until the original cancel settles so
      // broker cancellation still receives its pending cleanup promise.
      onAbort = () => {
        void (async () => {
          await cancel().catch(() => {});
          finish();
          controller.error(signal.reason ?? new Error("Hosted application inference cancelled"));
        })().catch(() => {});
      };
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    },
    async pull(controller) {
      try {
        assertActive();
        signal.throwIfAborted();
        const next = await scoped(() => reader.read());
        assertActive();
        signal.throwIfAborted();
        if (next.done) {
          finish();
          controller.close();
        } else controller.enqueue(next.value);
      } catch (error) {
        await cancel().catch(() => {});
        finish();
        controller.error(error);
      }
    },
    async cancel() {
      try {
        await cancel();
      } finally {
        finish();
      }
    },
  }, { highWaterMark: 0 });
}
