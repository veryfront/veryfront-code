import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { getErrorMessage } from "#veryfront/errors";
import {
  createNodeServerWithStartupOwner,
  type NodeServer,
} from "#veryfront/platform/adapters/runtime/node/http-server.ts";
import { ServerStartupCleanupError } from "./startup-cleanup-error.ts";

/** Public API contract for veryfront service server fetch. */
export type VeryfrontServiceServerFetch = (request: Request) => Response | Promise<Response>;
/** Response payload for veryfront service server module. */
export type VeryfrontServiceServerModuleResponse = Response | null | undefined;

/** Public API contract for veryfront service server module. */
export type VeryfrontServiceServerModule = {
  name: string;
  handle: (
    request: Request,
  ) => VeryfrontServiceServerModuleResponse | Promise<VeryfrontServiceServerModuleResponse>;
  setShuttingDown?: () => void;
  stop?: () => void | Promise<void>;
};

/** Public API contract for veryfront service server logger. */
export type VeryfrontServiceServerLogger = {
  debug?: (message: string, metadata?: Record<string, unknown>) => void;
  info?: (message: string, metadata?: Record<string, unknown>) => void;
  warn?: (message: string, metadata?: Record<string, unknown>) => void;
  error?: (message: string, metadata?: Record<string, unknown>) => void;
};

/** Options accepted by create veryfront server. */
export type CreateVeryfrontServerOptions = {
  modules: readonly VeryfrontServiceServerModule[];
  notFound?: (request: Request) => Response | Promise<Response>;
  onError?: (error: unknown, request: Request) => Response | Promise<Response>;
  logger?: VeryfrontServiceServerLogger;
};

/** Public API contract for veryfront service server runtime. */
export type VeryfrontServiceServerRuntime = {
  fetch: VeryfrontServiceServerFetch;
  setShuttingDown: () => void;
  stop: () => Promise<void>;
};

/** Options accepted by start node veryfront server. */
export type StartNodeVeryfrontServerOptions = {
  runtime: VeryfrontServiceServerRuntime;
  port: number;
  bindAddress?: string;
  logger?: VeryfrontServiceServerLogger;
  signals?: readonly NodeJS.Signals[];
  hardShutdownTimeoutMs?: number;
};

/** Options accepted by start veryfront server. */
export type StartVeryfrontServerOptions = {
  runtime: VeryfrontServiceServerRuntime;
  port: number;
  bindAddress?: string;
  logger?: VeryfrontServiceServerLogger;
  signals?: readonly NodeJS.Signals[];
  hardShutdownTimeoutMs?: number;
};

/** Public API contract for veryfront service server runtime kind. */
export type VeryfrontServiceServerRuntimeKind = "node" | "deno" | "bun";

/** Public API contract for veryfront service server. */
export type VeryfrontServiceServer = {
  /** Resolves after the runtime-specific listener is ready. */
  ready: Promise<void>;
  stop: () => Promise<void>;
  port: number;
  url: string;
  runtime: VeryfrontServiceServerRuntimeKind;
};

/** Public API contract for node veryfront service server. */
export type NodeVeryfrontServiceServer = {
  server: import("node:http").Server;
  /**
   * Resolves after the listener binds. A rejected bind or pre-bind stop
   * automatically releases signal handlers and stops the supplied runtime
   * before this promise rejects.
   */
  ready: Promise<void>;
  stop: () => Promise<void>;
  port: number;
  url: string;
  runtime: "node";
};

type DenoServeOptions = {
  port: number;
  hostname?: string;
  signal?: AbortSignal;
  onListen?: (address: { port: number; hostname: string }) => void;
};

type DenoServeHandler = (request: Request) => Response | Promise<Response>;

type DenoHttpServer = {
  port?: number;
  finished?: Promise<void>;
  shutdown?: () => void | Promise<void>;
};

type DenoServeRuntime = {
  serve: (options: DenoServeOptions, handler: DenoServeHandler) => unknown;
  addSignalListener?: (signal: NodeJS.Signals, handler: SignalHandler) => void;
  removeSignalListener?: (signal: NodeJS.Signals, handler: SignalHandler) => void;
  exit?: (code: number) => never | void;
};

type BunServeOptions = {
  port: number;
  hostname?: string;
  fetch: VeryfrontServiceServerFetch;
};

type BunHttpServer = {
  port?: number;
  url?: string;
  stop: () => void | Promise<void>;
};

type BunServeRuntime = {
  serve: (options: BunServeOptions) => unknown;
};

type SignalHandler = () => void;

type SignalRuntime = {
  add: (signal: NodeJS.Signals, handler: SignalHandler) => void;
  remove?: (signal: NodeJS.Signals, handler: SignalHandler) => void;
  exit?: (code: number) => never | void;
};

type LifecyclePhase = {
  readonly label: string;
  readonly run: () => void | Promise<void>;
  completed: boolean;
};

type SynchronousLifecyclePhase = {
  readonly label: string;
  readonly run: () => void;
  completed: boolean;
};

function lifecycleFailureMessage(
  operation: string,
  failures: readonly { label: string; error: unknown }[],
): string {
  const labels = failures.map(({ label }) => label).join(", ");
  return `${operation} failed in ${failures.length} phase${
    failures.length === 1 ? "" : "s"
  }: ${labels}`;
}

function runSynchronousLifecyclePhases(
  phases: readonly SynchronousLifecyclePhase[],
  operation: string,
): void {
  const failures: Array<{ label: string; error: unknown }> = [];
  for (const phase of phases) {
    if (phase.completed) continue;
    try {
      phase.run();
      phase.completed = true;
    } catch (error) {
      failures.push({ label: phase.label, error });
    }
  }

  if (failures.length > 0) {
    if (failures.length === 1) {
      throw failures[0]!.error;
    }
    throw new AggregateError(
      failures.map(({ error }) => error),
      lifecycleFailureMessage(operation, failures),
    );
  }
}

async function runLifecyclePhases(
  phases: readonly LifecyclePhase[],
  operation: string,
  preserveSingleFailure = false,
): Promise<void> {
  const failures: Array<{ label: string; error: unknown }> = [];
  for (const phase of phases) {
    if (phase.completed) continue;
    try {
      await phase.run();
      phase.completed = true;
    } catch (error) {
      failures.push({ label: phase.label, error });
    }
  }

  if (failures.length > 0) {
    if (preserveSingleFailure && failures.length === 1) {
      throw failures[0]!.error;
    }
    throw new AggregateError(
      failures.map(({ error }) => error),
      lifecycleFailureMessage(operation, failures),
    );
  }
}

function createRetryableLifecycle(
  phases: readonly LifecyclePhase[],
  operation: string,
  preserveSingleFailure = false,
): () => Promise<void> {
  let lifecyclePromise: Promise<void> | undefined;
  return () => {
    if (lifecyclePromise) return lifecyclePromise;

    // Publish the shared attempt before invoking any lifecycle callback. A
    // callback is allowed to re-enter stop(); running it synchronously here
    // would otherwise create a second cleanup generation.
    const attempt = Promise.resolve().then(() =>
      runLifecyclePhases(phases, operation, preserveSingleFailure)
    );
    lifecyclePromise = attempt;
    void attempt.then(
      () => undefined,
      () => {
        if (lifecyclePromise === attempt) lifecyclePromise = undefined;
      },
    );
    return attempt;
  };
}

function defaultNotFound(): Response {
  return new Response("Not Found", { status: 404 });
}

function safelyLog(
  logger: VeryfrontServiceServerLogger,
  level: keyof VeryfrontServiceServerLogger,
  message: string,
  metadata?: Record<string, unknown>,
): void {
  try {
    const write = logger[level];
    if (typeof write === "function") {
      Reflect.apply(write, logger, [message, metadata]);
    }
  } catch {
    // Observability is best-effort and must never own request or lifecycle flow.
  }
}

function defaultErrorResponse(
  error: unknown,
  request: Request,
  logger: VeryfrontServiceServerLogger,
): Response {
  safelyLog(logger, "error", "Veryfront service request failed", {
    url: request.url,
    error: getErrorMessage(error),
  });
  return new Response("Internal Server Error", { status: 500 });
}

/** Create veryfront server. */
export function createVeryfrontServer(
  options: CreateVeryfrontServerOptions,
): VeryfrontServiceServerRuntime {
  const logger = options.logger ?? serverLogger.component("service-server");
  const notFound = options.notFound ?? defaultNotFound;
  const onError = options.onError ??
    ((error, request) => defaultErrorResponse(error, request, logger));
  const shutdownPhases: SynchronousLifecyclePhase[] = options.modules.flatMap(
    (module, index) =>
      module.setShuttingDown
        ? [{
          label: `module ${index} (${module.name}) shutdown notification`,
          run: () => module.setShuttingDown?.(),
          completed: false,
        }]
        : [],
  );
  const moduleStopPhases: LifecyclePhase[] = options.modules.flatMap(
    (module, index) =>
      module.stop
        ? [{
          label: `module ${index} (${module.name}) cleanup`,
          run: () => module.stop?.(),
          completed: false,
        }]
        : [],
  );
  const stop = createRetryableLifecycle(
    moduleStopPhases,
    "Veryfront service module cleanup",
    true,
  );

  return {
    fetch: async (request) => {
      try {
        for (const module of options.modules) {
          const response = await module.handle(request);
          if (response) {
            return response;
          }
        }

        return await notFound(request);
      } catch (error) {
        return await onError(error, request);
      }
    },
    setShuttingDown: () => {
      runSynchronousLifecyclePhases(
        shutdownPhases,
        "Veryfront service shutdown notification",
      );
    },
    stop,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function snapshotDenoHttpServer(
  value: unknown,
  ownShutdown: (shutdown: () => void | Promise<void>) => void,
  ownAbortCompletion: (finished: Promise<void>) => void,
): DenoHttpServer {
  if (!isObject(value)) {
    throw new TypeError("Deno.serve() did not return an HTTP server object");
  }

  const shutdown = value.shutdown;
  let ownedShutdown: (() => void | Promise<void>) | undefined;
  if (typeof shutdown === "function") {
    ownedShutdown = () => Reflect.apply(shutdown, value, []);
    // Publish transport ownership before inspecting any remaining caller-
    // supplied fields, whose getters may still fail validation.
    ownShutdown(ownedShutdown);
  }

  const finished = value.finished;
  if (finished !== undefined && !(finished instanceof Promise)) {
    throw new TypeError("Deno.serve() returned an invalid finished promise");
  }
  if (ownedShutdown === undefined && finished !== undefined) {
    // The abort fallback also owns listener termination. Publish it before
    // reading address metadata so a later hostile getter cannot strand a
    // pending server after startup rollback begins.
    ownAbortCompletion(finished);
  }
  if (shutdown !== undefined && typeof shutdown !== "function") {
    throw new TypeError("Deno.serve() returned an invalid shutdown capability");
  }

  const addr = value.addr;
  const port = isObject(addr) ? addr.port : undefined;
  if (addr !== undefined && !isObject(addr)) {
    throw new TypeError("Deno.serve() returned an invalid listener address");
  }
  if (port !== undefined && typeof port !== "number") {
    throw new TypeError("Deno.serve() returned an invalid listener port");
  }
  return {
    ...(port !== undefined ? { port } : {}),
    ...(finished !== undefined ? { finished } : {}),
    ...(ownedShutdown !== undefined ? { shutdown: ownedShutdown } : {}),
  };
}

function snapshotBunHttpServer(
  value: unknown,
  ownStop: (stop: () => void | Promise<void>) => void,
): BunHttpServer {
  if (!isObject(value)) {
    throw new TypeError("Bun.serve() did not return an HTTP server object");
  }

  const stop = value.stop;
  if (typeof stop !== "function") {
    throw new TypeError("Bun.serve() returned a server without a stop capability");
  }
  const ownedStop = () => Reflect.apply(stop, value, []);
  // Publish transport ownership before inspecting any remaining caller-
  // supplied fields, whose getters may still fail validation.
  ownStop(ownedStop);

  const port = value.port;
  const url = value.url;
  if (port !== undefined && typeof port !== "number") {
    throw new TypeError("Bun.serve() returned an invalid listener port");
  }
  if (url !== undefined && !(url instanceof URL)) {
    throw new TypeError("Bun.serve() returned an invalid listener URL");
  }

  return {
    ...(port !== undefined ? { port } : {}),
    ...(url !== undefined ? { url: url.toString() } : {}),
    stop: ownedStop,
  };
}

function getDenoServeRuntime(): DenoServeRuntime | null {
  const denoGlobal: unknown = Reflect.get(globalThis, "Deno");
  if (!isObject(denoGlobal)) {
    return null;
  }
  const serve = denoGlobal.serve;
  const addSignalListener = denoGlobal.addSignalListener;
  const removeSignalListener = denoGlobal.removeSignalListener;
  const exit = denoGlobal.exit;
  if (typeof serve !== "function") {
    return null;
  }
  const runtime: DenoServeRuntime = {
    serve: (options, handler) => Reflect.apply(serve, denoGlobal, [options, handler]),
  };
  if (typeof addSignalListener === "function") {
    runtime.addSignalListener = (signal, handler) => {
      Reflect.apply(addSignalListener, denoGlobal, [signal, handler]);
    };
  }
  if (typeof removeSignalListener === "function") {
    runtime.removeSignalListener = (signal, handler) => {
      Reflect.apply(removeSignalListener, denoGlobal, [signal, handler]);
    };
  }
  if (typeof exit === "function") {
    runtime.exit = (code) => Reflect.apply(exit, denoGlobal, [code]);
  }
  return runtime;
}

function getBunServeRuntime(): BunServeRuntime | null {
  const bunGlobal: unknown = Reflect.get(globalThis, "Bun");
  if (!isObject(bunGlobal)) {
    return null;
  }
  const serve = bunGlobal.serve;
  if (typeof serve !== "function") {
    return null;
  }
  return {
    serve: (options) => Reflect.apply(serve, bunGlobal, [options]),
  };
}

function getProcessSignalRuntime(): SignalRuntime | null {
  const processGlobal: unknown = Reflect.get(globalThis, "process");
  if (!isObject(processGlobal)) {
    return null;
  }
  const on = processGlobal.on;
  const off = processGlobal.off;
  const removeListener = processGlobal.removeListener;
  const exit = processGlobal.exit;
  if (typeof on !== "function") {
    return null;
  }
  const runtime: SignalRuntime = {
    add: (signal, handler) => {
      Reflect.apply(on, processGlobal, [signal, handler]);
    },
  };
  if (typeof off === "function") {
    runtime.remove = (signal, handler) => {
      Reflect.apply(off, processGlobal, [signal, handler]);
    };
  } else if (typeof removeListener === "function") {
    runtime.remove = (signal, handler) => {
      Reflect.apply(removeListener, processGlobal, [signal, handler]);
    };
  }
  if (typeof exit === "function") {
    runtime.exit = (code) => Reflect.apply(exit, processGlobal, [code]);
  }
  return runtime;
}

function createDenoSignalRuntime(deno: DenoServeRuntime): SignalRuntime | null {
  if (!deno.addSignalListener) {
    return null;
  }
  return {
    add: deno.addSignalListener,
    remove: deno.removeSignalListener,
    exit: deno.exit,
  };
}

function resolveRuntimeKind(): VeryfrontServiceServerRuntimeKind {
  if (getBunServeRuntime()) {
    return "bun";
  }
  if (getDenoServeRuntime()) {
    return "deno";
  }
  return "node";
}

function createServiceServerStop(
  runtime: VeryfrontServiceServerRuntime,
  stopServer: () => void | Promise<void>,
  removeSignalHandlers: () => void,
  runtimeKind: VeryfrontServiceServerRuntimeKind,
): () => Promise<void> {
  return createRetryableLifecycle(
    [
      {
        label: "runtime shutdown notification",
        run: () => runtime.setShuttingDown(),
        completed: false,
      },
      {
        label: `${runtimeKind} HTTP listener`,
        run: stopServer,
        completed: false,
      },
      {
        label: "service runtime",
        run: () => runtime.stop(),
        completed: false,
      },
      {
        label: "signal handlers",
        run: removeSignalHandlers,
        completed: false,
      },
    ],
    `Veryfront ${runtimeKind} service server cleanup`,
    true,
  );
}

interface SignalHandlerLifecycle {
  install(): void;
  remove(): void;
}

function createSignalHandlerLifecycle(options: {
  signalRuntime: SignalRuntime | null;
  signals?: readonly NodeJS.Signals[];
  logger: VeryfrontServiceServerLogger;
  stop: () => Promise<void>;
  hardShutdownTimeoutMs?: number;
  runtime: VeryfrontServiceServerRuntimeKind;
}): SignalHandlerLifecycle {
  const hardShutdownTimeoutMs = options.hardShutdownTimeoutMs ?? 20_000;
  const signals = options.signals ?? ["SIGTERM"];
  const installedHandlers: Array<{
    signal: NodeJS.Signals;
    handler: SignalHandler;
    removed: boolean;
  }> = [];
  let signalShutdownStarted = false;

  const remove = (): void => {
    const failures: Array<{ label: string; error: unknown }> = [];
    for (const installed of installedHandlers) {
      if (installed.removed) continue;
      const { signal, handler } = installed;
      try {
        if (!options.signalRuntime?.remove) {
          throw new TypeError("Signal runtime does not support listener removal");
        }
        options.signalRuntime.remove(signal, handler);
        installed.removed = true;
      } catch (error) {
        failures.push({ label: signal, error });
        safelyLog(
          options.logger,
          "warn",
          "Veryfront service server could not remove shutdown signal handler",
          {
            signal,
            runtime: options.runtime,
            error: getErrorMessage(error),
          },
        );
      }
    }

    if (failures.length > 0) {
      if (failures.length === 1) {
        throw failures[0]!.error;
      }
      throw new AggregateError(
        failures.map(({ error }) => error),
        lifecycleFailureMessage("Veryfront service signal cleanup", failures),
      );
    }
  };

  const install = (): void => {
    if (!options.signalRuntime) {
      if (signals.length === 0) return;
      throw new TypeError(`Signal handling is unavailable in the ${options.runtime} runtime`);
    }
    if (signals.length > 0 && !options.signalRuntime.remove) {
      throw new TypeError(
        `Signal listener removal is unavailable in the ${options.runtime} runtime`,
      );
    }

    const failures: Array<{ label: string; error: unknown }> = [];
    for (const signal of signals) {
      const handler = () => {
        if (signalShutdownStarted) {
          return;
        }

        signalShutdownStarted = true;
        safelyLog(options.logger, "info", "Veryfront service server received shutdown signal", {
          signal,
          runtime: options.runtime,
        });
        const hardTimeout = setTimeout(() => {
          safelyLog(
            options.logger,
            "error",
            "Veryfront service server graceful shutdown timed out",
            {
              signal,
              runtime: options.runtime,
            },
          );
          options.signalRuntime?.exit?.(1);
        }, hardShutdownTimeoutMs);

        void options.stop()
          .then(() => {
            options.signalRuntime?.exit?.(0);
          })
          .catch((error: unknown) => {
            safelyLog(options.logger, "error", "Veryfront service server shutdown failed", {
              signal,
              runtime: options.runtime,
              error: getErrorMessage(error),
            });
            options.signalRuntime?.exit?.(1);
          })
          .finally(() => {
            // Always cancel the hard-shutdown timer — exit() is synchronous so this
            // only matters when signalRuntime.exit is undefined, but using finally
            // ensures the timer never leaks regardless of how the promise settles.
            clearTimeout(hardTimeout);
          });
      };

      try {
        options.signalRuntime.add(signal, handler);
        installedHandlers.push({ signal, handler, removed: false });
      } catch (error) {
        failures.push({ label: signal, error });
        safelyLog(
          options.logger,
          "warn",
          "Veryfront service server could not install shutdown signal handler",
          {
            signal,
            runtime: options.runtime,
            error: getErrorMessage(error),
          },
        );
      }
    }

    if (failures.length > 0) {
      if (failures.length === 1) {
        throw failures[0]!.error;
      }
      throw new AggregateError(
        failures.map(({ error }) => error),
        lifecycleFailureMessage("Veryfront service signal installation", failures),
      );
    }
  };

  return { install, remove };
}

async function rethrowAfterServiceStartupCleanup(
  scope: string,
  primaryError: unknown,
  retryCleanup: () => Promise<void>,
): Promise<never> {
  try {
    await retryCleanup();
  } catch (cleanupError) {
    throw new ServerStartupCleanupError(
      scope,
      primaryError,
      cleanupError,
      retryCleanup,
    );
  }
  throw primaryError;
}

async function startDenoVeryfrontServer(
  options: StartVeryfrontServerOptions,
  deno: DenoServeRuntime,
): Promise<VeryfrontServiceServer> {
  const logger = options.logger ?? serverLogger.component("service-server");
  const bindAddress = options.bindAddress ?? "0.0.0.0";
  const abortController = new AbortController();
  let stopListener = async (): Promise<void> => {
    if (!abortController.signal.aborted) abortController.abort();
  };
  let removeSignalHandlers: () => void = () => undefined;

  const stop = createServiceServerStop(
    options.runtime,
    () => stopListener(),
    () => removeSignalHandlers(),
    "deno",
  );
  const signalHandlers = createSignalHandlerLifecycle({
    signalRuntime: createDenoSignalRuntime(deno),
    signals: options.signals,
    logger,
    stop,
    hardShutdownTimeoutMs: options.hardShutdownTimeoutMs,
    runtime: "deno",
  });
  removeSignalHandlers = signalHandlers.remove;

  try {
    const candidate = deno.serve({
      port: options.port,
      hostname: bindAddress,
      signal: abortController.signal,
      onListen: () => undefined,
    }, options.runtime.fetch);
    const server = snapshotDenoHttpServer(
      candidate,
      (shutdown) => {
        stopListener = async () => await shutdown();
      },
      (finished) => {
        stopListener = async () => {
          if (!abortController.signal.aborted) abortController.abort();
          // A rejected `finished` promise still proves that the listener has
          // terminated; wait for that terminal outcome without converting a
          // prior runtime failure into permanently unretryable cleanup.
          await finished.catch(() => undefined);
        };
      },
    );
    signalHandlers.install();
    const listeningPort = server.port ?? options.port;
    safelyLog(logger, "info", "Veryfront service server listening", {
      port: listeningPort,
      bindAddress,
      runtime: "deno",
    });

    return {
      ready: Promise.resolve(),
      stop,
      port: listeningPort,
      url: `http://${bindAddress}:${listeningPort}`,
      runtime: "deno",
    };
  } catch (primaryError) {
    return await rethrowAfterServiceStartupCleanup(
      "Veryfront Deno service server startup",
      primaryError,
      stop,
    );
  }
}

async function startBunVeryfrontServer(
  options: StartVeryfrontServerOptions,
  bun: BunServeRuntime,
): Promise<VeryfrontServiceServer> {
  const logger = options.logger ?? serverLogger.component("service-server");
  const bindAddress = options.bindAddress ?? "0.0.0.0";
  let stopListener = (): void | Promise<void> => undefined;
  let removeSignalHandlers: () => void = () => undefined;

  const stop = createServiceServerStop(
    options.runtime,
    () => stopListener(),
    () => removeSignalHandlers(),
    "bun",
  );
  const signalHandlers = createSignalHandlerLifecycle({
    signalRuntime: getProcessSignalRuntime(),
    signals: options.signals,
    logger,
    stop,
    hardShutdownTimeoutMs: options.hardShutdownTimeoutMs,
    runtime: "bun",
  });
  removeSignalHandlers = signalHandlers.remove;

  try {
    const candidate = bun.serve({
      port: options.port,
      hostname: bindAddress,
      fetch: options.runtime.fetch,
    });
    const server = snapshotBunHttpServer(candidate, (ownedStop) => {
      stopListener = ownedStop;
    });
    signalHandlers.install();

    const listeningPort = server.port ?? options.port;
    safelyLog(logger, "info", "Veryfront service server listening", {
      port: listeningPort,
      bindAddress,
      runtime: "bun",
    });

    return {
      ready: Promise.resolve(),
      stop,
      port: listeningPort,
      url: server.url ?? `http://${bindAddress}:${listeningPort}`,
      runtime: "bun",
    };
  } catch (primaryError) {
    return await rethrowAfterServiceStartupCleanup(
      "Veryfront Bun service server startup",
      primaryError,
      stop,
    );
  }
}

/** Starts veryfront server. */
export async function startVeryfrontServer(
  options: StartVeryfrontServerOptions,
): Promise<VeryfrontServiceServer | NodeVeryfrontServiceServer> {
  const runtimeKind = resolveRuntimeKind();
  if (runtimeKind === "bun") {
    const bun = getBunServeRuntime();
    if (bun) {
      return await startBunVeryfrontServer(options, bun);
    }
  }
  if (runtimeKind === "deno") {
    const deno = getDenoServeRuntime();
    if (deno) {
      return await startDenoVeryfrontServer(options, deno);
    }
  }
  return await startNodeVeryfrontServer(options);
}

/** Starts node veryfront server. */
export async function startNodeVeryfrontServer(
  options: StartNodeVeryfrontServerOptions,
): Promise<NodeVeryfrontServiceServer> {
  const logger = options.logger ?? serverLogger.component("service-server");
  const bindAddress = options.bindAddress ?? "0.0.0.0";
  const startupController = new AbortController();
  let removeSignalHandlers: () => void = () => undefined;
  let listeningPort = options.port;
  let listeningUrl = `http://${bindAddress}:${listeningPort}`;
  const stoppedBeforeReadyError = new Error(
    "Veryfront Node service server stopped before readiness",
  );

  let resolveOwnedServer!: (server: NodeServer) => void;
  let rejectOwnedServer!: (error: unknown) => void;
  const ownedServerPromise = new Promise<NodeServer>((resolve, reject) => {
    resolveOwnedServer = resolve;
    rejectOwnedServer = reject;
  });
  const listenerReady = createNodeServerWithStartupOwner(
    options.runtime.fetch,
    {
      port: options.port,
      hostname: bindAddress,
      signal: startupController.signal,
      onListen: (address) => {
        listeningPort = address.port;
        listeningUrl = `http://${bindAddress}:${listeningPort}`;
        safelyLog(logger, "info", "Veryfront service server listening", {
          port: listeningPort,
          bindAddress,
        });
      },
    },
    resolveOwnedServer,
  );
  void listenerReady.catch(rejectOwnedServer);
  const ownedServer = await ownedServerPromise;
  const server = ownedServer.nativeHttpServer;
  const stop = createServiceServerStop(
    options.runtime,
    async () => {
      if (!startupController.signal.aborted) {
        startupController.abort(stoppedBeforeReadyError);
      }
      await ownedServer.stop();
    },
    () => removeSignalHandlers(),
    "node",
  );

  const signalHandlers = createSignalHandlerLifecycle({
    signalRuntime: getProcessSignalRuntime(),
    signals: options.signals,
    logger,
    stop,
    hardShutdownTimeoutMs: options.hardShutdownTimeoutMs,
    runtime: "node",
  });
  removeSignalHandlers = signalHandlers.remove;
  try {
    signalHandlers.install();
  } catch (primaryError) {
    return await rethrowAfterServiceStartupCleanup(
      "Veryfront Node service server signal installation",
      primaryError,
      stop,
    );
  }

  const ready = listenerReady.then(() => undefined).catch(async (startupError) => {
    try {
      await stop();
    } catch (cleanupError) {
      throw new ServerStartupCleanupError(
        "Veryfront Node service server readiness",
        startupError,
        cleanupError,
        stop,
      );
    }
    throw startupError;
  });
  // Startup can fail while this async factory is still publishing the handle.
  // Observe the exported readiness promise immediately so strict runtimes do
  // not treat that expected, caller-visible rejection as an unhandled one.
  void ready.catch(() => undefined);

  return {
    server,
    ready,
    stop,
    get port() {
      return listeningPort;
    },
    get url() {
      return listeningUrl;
    },
    runtime: "node",
  };
}
