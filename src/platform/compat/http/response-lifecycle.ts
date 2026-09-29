/**
 * Complete request lifecycle work when a response has actually finished.
 * Non-streaming responses complete when their headers are ready, while SSE
 * responses complete only after their body closes, errors, or is cancelled.
 */

export function isEventStreamResponse(response: Response): boolean {
  if (!response.body) return false;

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  return contentType.split(";", 1)[0]?.trim() === "text/event-stream";
}

/**
 * Keep resource ownership until a response body closes, errors, is cancelled,
 * or its inbound request is aborted. Bodyless responses are already settled
 * and are returned unchanged so transport-specific response identity survives.
 * `strategy` controls wrapper buffering; omitted preserves the stream default.
 * Options restore deferred request context and optionally bound the cancellation wait
 * before resource release, without changing the source cancellation promise.
 */
export function completeOnResponseBodyConsumption(
  response: Response,
  onComplete: () => void,
  signal?: AbortSignal,
  strategy?: QueuingStrategy<Uint8Array>,
  options: {
    runDeferredOperation?: <T>(operation: () => Promise<T>) => Promise<T>;
    cancellationTimeoutMs?: number;
    /** Optional terminal notification. It does not change ownership of pending cancellation work. */
    onOutcome?: (outcome: "completed" | "canceled" | "error") => void;
  } = {},
): Response {
  const notifyOutcome = (outcome: "completed" | "canceled" | "error"): void => {
    try {
      if (options.onOutcome) void Promise.resolve(options.onOutcome(outcome)).catch(() => {});
    } catch { /* Observers cannot change the response outcome. */ }
  };
  if (!response.body) {
    notifyOutcome(signal?.aborted ? "canceled" : "completed");
    onComplete();
    return response;
  }

  const runDeferredOperation = options.runDeferredOperation ?? ((operation) => operation());
  let cancellationTimer: ReturnType<typeof setTimeout> | undefined;
  let completed = false;
  let abortBody = (): void => {};
  let cancellationPending = false;
  let cancellationPromise: Promise<void> | undefined;
  const complete = (outcome: "completed" | "canceled" | "error"): void => {
    if (completed) return;
    completed = true;
    clearTimeout(cancellationTimer);
    signal?.removeEventListener("abort", abortBody);
    notifyOutcome(outcome);
    onComplete();
  };

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = response.body.getReader();
  } catch (error) {
    complete("error");
    throw error;
  }

  const cancelBody = (reason: unknown): Promise<void> => {
    if (cancellationPromise) return cancellationPromise;
    cancellationPending = true;
    if (options.cancellationTimeoutMs !== undefined) {
      cancellationTimer = setTimeout(() => complete("canceled"), options.cancellationTimeoutMs);
    }
    cancellationPromise = runDeferredOperation(() => reader.cancel(reason)).then(
      () => complete("canceled"),
      (error) => {
        complete("canceled");
        throw error;
      },
    );
    return cancellationPromise;
  };
  abortBody = (): void => {
    void cancelBody(signal?.reason).catch(() => undefined);
  };

  // This catches source-side close/error even when a transport drops the
  // response without explicitly consuming or cancelling the wrapper.
  void reader.closed.then(
    () => {
      if (!cancellationPending) complete("completed");
    },
    () => {
      if (!cancellationPending) complete("error");
    },
  );

  if (signal?.aborted) {
    abortBody();
  } else {
    signal?.addEventListener("abort", abortBody, { once: true });
  }

  let body: ReadableStream<Uint8Array>;
  try {
    body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const result = await runDeferredOperation(() => reader.read());
          if (result.done) {
            if (!cancellationPending) complete("completed");
            controller.close();
            return;
          }
          controller.enqueue(result.value);
        } catch (error) {
          if (!cancellationPending) complete("error");
          controller.error(error);
        }
      },
      async cancel(reason) {
        await cancelBody(reason);
      },
    }, strategy);

    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    void cancelBody(error).catch(() => undefined);
    complete("error");
    throw error;
  }
}

export function completeOnResponseBodySettlement(
  response: Response,
  onComplete: () => void,
): Response {
  if (!isEventStreamResponse(response)) {
    onComplete();
    return response;
  }

  return completeOnResponseBodyConsumption(response, onComplete);
}
