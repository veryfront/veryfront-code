/** Exactly-once completion control for a proxied request span. */
export interface ProxyRequestLifecycle {
  /** End the request lifecycle with its authoritative HTTP outcome. */
  end(statusCode: number, error?: Error): void;
}

/** Abort signal combining caller cancellation and an upstream deadline. */
export interface LinkedRequestTimeout {
  /** Signal passed to the upstream operation. */
  readonly signal: AbortSignal;
  /** Return whether the deadline, rather than the caller, caused cancellation. */
  didTimeOut(): boolean;
  /** Release the timer and caller-signal listener. */
  cleanup(): void;
}

/** Link a caller cancellation signal with a bounded upstream timeout. */
export function createLinkedRequestTimeout(
  requestSignal: AbortSignal,
  timeoutMs: number,
): LinkedRequestTimeout {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new RangeError("timeoutMs must be an integer between 1 and 2147483647");
  }
  const controller = new AbortController();
  let timedOut = false;
  const abortFromRequest = () => controller.abort(requestSignal.reason);
  if (requestSignal.aborted) abortFromRequest();
  else requestSignal.addEventListener("abort", abortFromRequest, { once: true });
  const timeoutId = setTimeout(() => {
    if (controller.signal.aborted) return;
    timedOut = true;
    const timeoutError = new Error("Request timed out");
    timeoutError.name = "TimeoutError";
    controller.abort(timeoutError);
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    cleanup() {
      clearTimeout(timeoutId);
      requestSignal.removeEventListener("abort", abortFromRequest);
    },
  };
}

/** Wait for a retry delay, resolving false immediately when the request is cancelled. */
export function waitForAbortableDelay(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 2_147_483_647) {
    throw new RangeError("delayMs must be an integer between 0 and 2147483647");
  }
  if (signal.aborted) return Promise.resolve(false);
  if (delayMs === 0) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (completed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", onAbort);
      resolve(completed);
    };
    const onAbort = () => finish(false);
    const timeoutId = setTimeout(() => finish(true), delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Hooks required to run one request with tracing and exactly-once completion. */
export interface RunProxyRequestLifecycleOptions<TraceContext, TraceSpan> {
  /** Inbound request. */
  req: Request;
  /** Parsed inbound request URL. */
  url: URL;
  /** Extract an optional parent trace context. */
  extractContext(headers: Headers): TraceContext | undefined;
  /** Start the server span for the request. */
  startServerSpan(
    method: string,
    path: string,
    parentContext?: TraceContext,
  ): { span: TraceSpan; context: TraceContext } | null;
  /** Run request handling inside the active trace context. */
  withContext<T>(spanContext: TraceContext, fn: () => Promise<T>): Promise<T>;
  /** Finalize the server span. */
  endSpan(span: TraceSpan | undefined, statusCode: number, error?: Error): void;
  /** Execute the proxied request. */
  handle(lifecycle: ProxyRequestLifecycle): Promise<Response>;
}

/** Run a proxied HTTP request with tracing context and exactly-once span finalization. */
export async function runProxyRequestLifecycle<TraceContext, TraceSpan>(
  options: RunProxyRequestLifecycleOptions<TraceContext, TraceSpan>,
): Promise<Response> {
  const parentContext = options.extractContext(options.req.headers);
  const spanInfo = options.startServerSpan(options.req.method, options.url.pathname, parentContext);
  let ended = false;

  const lifecycle: ProxyRequestLifecycle = {
    end(statusCode, error) {
      if (ended) return;
      ended = true;
      options.endSpan(spanInfo?.span, statusCode, error);
    },
  };

  const execute = async (): Promise<Response> => {
    try {
      const response = await options.handle(lifecycle);
      lifecycle.end(response.status);
      return response;
    } catch (error) {
      const spanError = error instanceof Error ? error : new Error(String(error));
      lifecycle.end(500, spanError);
      throw error;
    }
  };

  try {
    return await (spanInfo?.context ? options.withContext(spanInfo.context, execute) : execute());
  } catch (error) {
    const spanError = error instanceof Error ? error : new Error(String(error));
    lifecycle.end(500, spanError);
    throw error;
  }
}
