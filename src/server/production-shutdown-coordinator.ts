export type ProductionShutdownReason = "SIGINT" | "SIGTERM" | "memory-pressure";
const MAX_FINALIZATION_PASSES = 3;

export interface ProductionShutdownCoordinatorOptions {
  shutdown: (reason: ProductionShutdownReason) => Promise<void>;
  flush: () => Promise<unknown>;
  beforeExit?: () => Promise<unknown>;
  finalizeBeforeExit?: () => Promise<unknown> | undefined;
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
  beforeExit?: () => Promise<unknown>;
  finalizeBeforeExit?: () => Promise<unknown> | undefined;
}

function ownServerStop(server: OwnedProductionServer): OwnedProductionServer {
  let stopping: Promise<void> | undefined;
  return {
    ready: server.ready,
    stop: () => {
      stopping ??= Promise.resolve().then(() => server.stop());
      return stopping;
    },
  };
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
    }

    try {
      await options.beforeExit?.();
    } catch (error) {
      notifyError(error, reason);
    }

    try {
      for (let pass = 0; pass < MAX_FINALIZATION_PASSES; pass++) {
        const finalization = options.finalizeBeforeExit?.();
        if (!finalization) break;
        await finalization;
      }
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
  let serverAtShutdownStart: OwnedProductionServer | undefined;
  let finalizedLateServer: OwnedProductionServer | undefined;
  let shutdownRequested = false;
  const coordinator = createProductionShutdownCoordinator({
    shutdown: async (reason) => {
      serverAtShutdownStart = server;
      // No admitted response can be drained without a returned server handle.
      // Abort pending startup immediately so a late listener observes shutdown.
      if (!serverAtShutdownStart) controller.abort();
      await options.shutdown(reason, serverAtShutdownStart, () => controller.abort());
      // Startup may settle while shutdown is draining. Its handle was not part
      // of the initial cleanup snapshot, so stop it before telemetry flush/exit.
      if (!serverAtShutdownStart && server) await server.stop();
    },
    flush: options.flush,
    beforeExit: async () => {
      if (server && server !== serverAtShutdownStart && shutdownRequested) await server.stop();
      await options.beforeExit?.();
    },
    finalizeBeforeExit: () => {
      const customFinalization = options.finalizeBeforeExit?.();
      if (customFinalization) return customFinalization;
      if (
        server && server !== serverAtShutdownStart && server !== finalizedLateServer &&
        shutdownRequested
      ) {
        finalizedLateServer = server;
        return server.stop();
      }
      return undefined;
    },
    exit: options.exit,
    onError: options.onError,
  });

  const requestShutdown = (reason: ProductionShutdownReason): void => {
    shutdownRequested = true;
    coordinator.request(reason);
  };
  const disposeSignals = options.registerSignals(requestShutdown);

  try {
    type StartupOutcome =
      | { status: "ready" }
      | { status: "shutdown" }
      | { status: "failed"; error: unknown };
    const startup = options.start({
      signal: controller.signal,
      onMemoryRecycle: () => requestShutdown("memory-pressure"),
    }).then(
      async (startedServer): Promise<StartupOutcome> => {
        server = ownServerStop(startedServer);
        try {
          if (shutdownRequested) await server.stop();
          await server.ready;
          if (!shutdownRequested) options.onReady?.();
          return { status: "ready" };
        } catch (error) {
          if (shutdownRequested) return { status: "shutdown" };
          try {
            await server.stop();
          } catch {
            // Preserve the readiness failure as the startup result. The stop
            // attempt still owns every resource it can release.
          }
          return { status: "failed", error };
        }
      },
      (error): StartupOutcome =>
        shutdownRequested ? { status: "shutdown" } : { status: "failed", error },
    );

    const first = await Promise.race([
      startup,
      coordinator.completed.then(() => ({ status: "shutdown" as const })),
    ]);
    if (first.status === "shutdown") {
      await coordinator.completed;
      return;
    }
    if (first.status === "failed") throw first.error;

    await coordinator.completed;
  } finally {
    disposeSignals?.();
  }
}
