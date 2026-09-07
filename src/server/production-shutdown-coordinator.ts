export type ProductionShutdownReason = "SIGINT" | "SIGTERM" | "memory-pressure";

export interface ProductionShutdownCoordinatorOptions {
  shutdown: (reason: ProductionShutdownReason) => Promise<void>;
  flush: () => Promise<unknown>;
  exit: (code: number) => void;
  onError?: (error: unknown, reason: ProductionShutdownReason) => void;
}

export interface ProductionShutdownCoordinator {
  request(reason: ProductionShutdownReason): void;
  completed: Promise<void>;
}

export interface OwnedProductionServer {
  ready: Promise<void>;
  stop: () => Promise<void>;
}

export interface ProductionProcessOwnerOptions {
  start: (options: {
    signal: AbortSignal;
    onMemoryRecycle: () => void;
  }) => Promise<OwnedProductionServer>;
  shutdown: (
    reason: ProductionShutdownReason,
    server: OwnedProductionServer | undefined,
    abort: () => void,
  ) => Promise<void>;
  flush: () => Promise<unknown>;
  exit: (code: number) => void;
  registerSignals: (
    handler: (signal: "SIGINT" | "SIGTERM") => void | Promise<void>,
  ) => void | (() => void);
  onReady?: () => void;
  onError?: (error: unknown, reason: ProductionShutdownReason) => void;
}

/** Coordinates competing process shutdown triggers through one drain and exit. */
export function createProductionShutdownCoordinator(
  options: ProductionShutdownCoordinatorOptions,
): ProductionShutdownCoordinator {
  let requested = false;
  let resolveReason: ((reason: ProductionShutdownReason) => void) | undefined;
  const reasonPromise = new Promise<ProductionShutdownReason>((resolve) => {
    resolveReason = resolve;
  });
  const notifyError = (error: unknown, reason: ProductionShutdownReason): void => {
    try {
      options.onError?.(error, reason);
    } catch {
      // Diagnostics must not interrupt the process owner's shutdown path.
    }
  };

  const completed = (async () => {
    const reason = await reasonPromise;
    try {
      await options.shutdown(reason);
    } catch (error) {
      notifyError(error, reason);
    }

    try {
      await options.flush();
    } catch (error) {
      notifyError(error, reason);
    } finally {
      options.exit(0);
    }
  })();

  return {
    request(reason) {
      if (requested) return;
      requested = true;
      resolveReason?.(reason);
    },
    completed,
  };
}

/**
 * Own a production server from startup through one process exit.
 *
 * Shutdown triggers are installed before startup so memory pressure or a signal
 * can abort a server whose readiness promise never settles.
 */
export async function runProductionProcessOwner(
  options: ProductionProcessOwnerOptions,
): Promise<void> {
  const controller = new AbortController();
  let server: OwnedProductionServer | undefined;
  let shutdownRequested = false;
  const coordinator = createProductionShutdownCoordinator({
    shutdown: async (reason) => {
      await options.shutdown(reason, server, () => controller.abort());
    },
    flush: options.flush,
    exit: options.exit,
    onError: options.onError,
  });

  const requestShutdown = (reason: ProductionShutdownReason): void => {
    shutdownRequested = true;
    coordinator.request(reason);
  };
  const disposeSignals = options.registerSignals(requestShutdown);

  try {
    type StartupOutcome = { status: "ready" } | { status: "failed"; error: unknown };
    const startup = options.start({
      signal: controller.signal,
      onMemoryRecycle: () => requestShutdown("memory-pressure"),
    }).then(async (startedServer): Promise<StartupOutcome> => {
      server = startedServer;
      try {
        await startedServer.ready;
        if (!shutdownRequested) options.onReady?.();
        return { status: "ready" };
      } catch (error) {
        return { status: "failed", error };
      }
    }, (error): StartupOutcome => ({ status: "failed", error }));

    const first = await Promise.race([
      startup,
      coordinator.completed.then(() => ({ status: "shutdown" as const })),
    ]);
    if (first.status === "shutdown") return;
    if (first.status === "failed") throw first.error;

    await coordinator.completed;
  } finally {
    disposeSignals?.();
  }
}
