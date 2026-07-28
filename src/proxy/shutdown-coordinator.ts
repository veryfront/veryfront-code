export type ProxyShutdownRequest =
  | Readonly<{ source: "signal"; signal: "SIGINT" | "SIGTERM" }>
  | Readonly<{ source: "http-listener"; error: unknown }>;

export interface ProxyShutdownState {
  hasListenerFailure(): boolean;
}

export interface ProxyShutdownCoordinator {
  request(request: ProxyShutdownRequest): Promise<void>;
  hasListenerFailure(): boolean;
}

export interface ProxyShutdownCoordinatorOptions {
  readonly performShutdown: (
    request: ProxyShutdownRequest,
    state: ProxyShutdownState,
  ) => void | Promise<void>;
  readonly reportListenerFailure: (error: unknown) => void;
  /** Own an unexpected cleanup rejection exactly once. */
  readonly handleShutdownFailure: (error: unknown) => void | Promise<void>;
}

/**
 * Coordinate every shutdown trigger through one cleanup attempt.
 *
 * Listener failures arriving during signal shutdown mark shared state so the
 * process can choose a failed exit status, without starting another cleanup.
 */
export function createProxyShutdownCoordinator(
  options: ProxyShutdownCoordinatorOptions,
): ProxyShutdownCoordinator {
  if (
    !options ||
    typeof options !== "object" ||
    typeof options.performShutdown !== "function" ||
    typeof options.reportListenerFailure !== "function" ||
    typeof options.handleShutdownFailure !== "function"
  ) {
    throw new TypeError("Proxy shutdown coordinator options are invalid");
  }

  let shutdownPromise: Promise<void> | null = null;
  let listenerFailureSeen = false;
  const state = Object.freeze({
    hasListenerFailure: () => listenerFailureSeen,
  });

  const request = (shutdownRequest: ProxyShutdownRequest): Promise<void> => {
    if (
      !shutdownRequest ||
      typeof shutdownRequest !== "object" ||
      (shutdownRequest.source !== "signal" &&
        shutdownRequest.source !== "http-listener") ||
      (shutdownRequest.source === "signal" &&
        shutdownRequest.signal !== "SIGINT" &&
        shutdownRequest.signal !== "SIGTERM")
    ) {
      return Promise.reject(new TypeError("Proxy shutdown request is invalid"));
    }

    if (shutdownRequest.source === "http-listener" && !listenerFailureSeen) {
      listenerFailureSeen = true;
      try {
        options.reportListenerFailure(shutdownRequest.error);
      } catch {
        // Diagnostics must not prevent cleanup or create another shutdown.
      }
    }
    if (shutdownPromise) return shutdownPromise;

    let resolveShutdown!: () => void;
    let rejectShutdown!: (error: unknown) => void;
    const cleanupAttempt = new Promise<void>((resolve, reject) => {
      resolveShutdown = resolve;
      rejectShutdown = reject;
    });
    const attempt = cleanupAttempt.catch(async (error) => {
      try {
        await options.handleShutdownFailure(error);
      } catch (handlerError) {
        throw new AggregateError(
          [error, handlerError],
          "Proxy shutdown and terminal failure handling both failed",
        );
      }
    });
    // Publish the single-flight promise before invoking user cleanup so a
    // synchronous/reentrant trigger observes the same attempt.
    shutdownPromise = attempt;

    let result: void | Promise<void>;
    try {
      result = options.performShutdown(shutdownRequest, state);
    } catch (error) {
      rejectShutdown(error);
      return attempt;
    }
    try {
      Promise.resolve(result).then(resolveShutdown, rejectShutdown);
    } catch (error) {
      rejectShutdown(error);
    }
    return attempt;
  };

  return Object.freeze({
    request,
    hasListenerFailure: state.hasListenerFailure,
  });
}
