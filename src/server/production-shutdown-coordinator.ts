export type ProductionShutdownReason = "SIGINT" | "SIGTERM" | "memory-pressure";
const MAX_FINALIZATION_PASSES = 3;
const DEFAULT_PROCESS_SHUTDOWN_TIMEOUT_MS = 29_000;

/** Callbacks and finalization deadline for one coordinated process shutdown. */
export interface ProductionShutdownCoordinatorOptions {
  shutdown: (reason: ProductionShutdownReason) => Promise<void>;
  flush: () => Promise<unknown>;
  beforeExit?: () => Promise<unknown>;
  finalizeBeforeExit?: () => Promise<unknown> | undefined;
  /** Shared absolute deadline for shutdown, flush, and finalization steps. */
  finalizationDeadlineMs?: () => number | undefined;
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
  /** Total drain and cleanup budget from the first shutdown request. */
  shutdownTimeoutMs?: number | (() => number);
}

/** @internal Await owned-resource cleanup without extending its absolute deadline. */
export async function awaitBeforeDeadline(
  result: Promise<unknown> | undefined,
  deadlineMs: number | undefined,
): Promise<void> {
  if (!result) return;
  if (deadlineMs === undefined) {
    await result;
    return;
  }

  const remainingMs = Math.max(0, deadlineMs - Date.now());
  if (remainingMs === 0) {
    void result.catch(() => {});
    return;
  }

  let timeoutId: number | undefined;
  try {
    await Promise.race([
      result,
      new Promise<void>((resolve) => {
        timeoutId = setTimeout(resolve, remainingMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
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
    const finalizationDeadlineMs = options.finalizationDeadlineMs?.();
    const awaitStep = (result: Promise<unknown> | undefined): Promise<void> =>
      awaitBeforeDeadline(result, finalizationDeadlineMs);
    try {
      await awaitStep(options.shutdown(reason));
    } catch (error) {
      notifyError(error, reason);
    }

    try {
      await awaitStep(options.flush());
    } catch (error) {
      notifyError(error, reason);
    }

    try {
      await awaitStep(options.beforeExit?.());
    } catch (error) {
      notifyError(error, reason);
    }

    try {
      for (let pass = 0; pass < MAX_FINALIZATION_PASSES; pass++) {
        let finalization: Promise<unknown> | undefined;
        try {
          finalization = options.finalizeBeforeExit?.();
        } catch (error) {
          notifyError(error, reason);
          continue;
        }
        if (!finalization) break;
        try {
          await awaitStep(finalization);
        } catch (error) {
          notifyError(error, reason);
        }
      }
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
  let shutdownDeadlineMs: number | undefined;
  const resolveShutdownTimeoutMs = (): number => {
    const configured = typeof options.shutdownTimeoutMs === "function"
      ? options.shutdownTimeoutMs()
      : options.shutdownTimeoutMs;
    return Number.isInteger(configured) && (configured ?? -1) >= 0
      ? configured ?? DEFAULT_PROCESS_SHUTDOWN_TIMEOUT_MS
      : DEFAULT_PROCESS_SHUTDOWN_TIMEOUT_MS;
  };
  const awaitLateCleanup = (result: Promise<unknown>): Promise<void> =>
    awaitBeforeDeadline(result, shutdownDeadlineMs);
  const claimLateServerCleanup = (): Promise<void> | undefined => {
    if (
      !server || server === serverAtShutdownStart || server === finalizedLateServer ||
      !shutdownRequested
    ) return undefined;
    finalizedLateServer = server;
    return server.stop();
  };
  const coordinator = createProductionShutdownCoordinator({
    shutdown: async (reason) => {
      serverAtShutdownStart = server;
      // The listener can already be serving while an outer startup wrapper is
      // still pending. The shutdown owner must drain before aborting it.
      try {
        await awaitBeforeDeadline(
          options.shutdown(reason, serverAtShutdownStart, () => controller.abort()),
          shutdownDeadlineMs,
        );
      } finally {
        // A consumer callback can stall or fail without aborting startup.
        // Once its drain budget ends, the owner must stop late work too.
        controller.abort();
      }
      // Startup may settle while shutdown is draining. Its handle was not part
      // of the initial cleanup snapshot, so stop it before telemetry flush/exit.
      if (!serverAtShutdownStart && server) await awaitLateCleanup(server.stop());
    },
    flush: options.flush,
    beforeExit: async () => {
      if (server && server !== serverAtShutdownStart && shutdownRequested) {
        await awaitLateCleanup(server.stop());
      }
      await options.beforeExit?.();
    },
    finalizationDeadlineMs: () => shutdownDeadlineMs,
    finalizeBeforeExit: () => {
      const finalizations: Promise<unknown>[] = [];
      try {
        const customFinalization = options.finalizeBeforeExit?.();
        if (customFinalization) finalizations.push(customFinalization);
      } catch (error) {
        finalizations.push(Promise.reject(error));
      }
      const initialLateCleanup = claimLateServerCleanup();
      if (initialLateCleanup) finalizations.push(initialLateCleanup);
      if (finalizations.length === 0) return undefined;
      return Promise.allSettled(finalizations).then(async (initialResults) => {
        const lateCleanup = claimLateServerCleanup();
        const results = lateCleanup
          ? [...initialResults, ...await Promise.allSettled([lateCleanup])]
          : initialResults;
        const failures = results.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : []
        );
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) {
          throw new AggregateError(failures, "Production shutdown finalization failed");
        }
      });
    },
    exit: options.exit,
    onError: options.onError,
  });

  const requestShutdown = (reason: ProductionShutdownReason): void => {
    shutdownDeadlineMs ??= Date.now() + resolveShutdownTimeoutMs();
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
        // Stop can block before this path reaches readiness. Observe rejection
        // immediately while retaining the original promise for normal startup
        // error propagation below.
        void startedServer.ready.catch(() => {});
        server = ownServerStop(startedServer);
        try {
          if (shutdownRequested && controller.signal.aborted) {
            await awaitLateCleanup(server.stop());
          }
          await server.ready;
          if (!shutdownRequested) options.onReady?.();
          return { status: "ready" };
        } catch (error) {
          if (shutdownRequested) return { status: "shutdown" };
          try {
            await awaitBeforeDeadline(server.stop(), Date.now() + resolveShutdownTimeoutMs());
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
