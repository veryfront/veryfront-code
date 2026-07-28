import { serverLogger } from "#veryfront/utils";
import { toNodeHandler } from "./node-handler.ts";

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
  ready: Promise<void>;
  stop: () => Promise<void>;
  port: number;
  url: string;
  runtime: VeryfrontServiceServerRuntimeKind;
};

/** Public API contract for node veryfront service server. */
export type NodeVeryfrontServiceServer = {
  server: import("node:http").Server;
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
  addr?: {
    port?: number;
  };
  finished?: Promise<void>;
  shutdown?: () => void | Promise<void>;
};

type DenoServeRuntime = {
  serve: (options: DenoServeOptions, handler: DenoServeHandler) => DenoHttpServer;
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
  url?: URL;
  stop?: () => void | Promise<void>;
};

type BunServeRuntime = {
  serve: (options: BunServeOptions) => BunHttpServer;
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
    throw new AggregateError(
      failures.map(({ error }) => error),
      lifecycleFailureMessage(operation, failures),
    );
  }
}

async function runLifecyclePhases(
  phases: readonly LifecyclePhase[],
  operation: string,
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
    throw new AggregateError(
      failures.map(({ error }) => error),
      lifecycleFailureMessage(operation, failures),
    );
  }
}

function createRetryableLifecycle(
  phases: readonly LifecyclePhase[],
  operation: string,
): () => Promise<void> {
  let lifecyclePromise: Promise<void> | undefined;
  return () => {
    if (lifecyclePromise) return lifecyclePromise;

    const attempt = runLifecyclePhases(phases, operation);
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

function defaultErrorResponse(
  error: unknown,
  request: Request,
  logger: VeryfrontServiceServerLogger,
): Response {
  logger.error?.("Veryfront service request failed", {
    url: request.url,
    error: error instanceof Error ? error.message : String(error),
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
  const stop = createRetryableLifecycle(moduleStopPhases, "Veryfront service module cleanup");

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

function closeNodeServer(server: import("node:http").Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDenoHttpServer(value: unknown): value is DenoHttpServer {
  if (!isObject(value)) {
    return false;
  }
  const finished = value.finished;
  const shutdown = value.shutdown;
  const addr = value.addr;
  const port = isObject(addr) ? addr.port : undefined;
  return (addr === undefined || isObject(addr)) &&
    (port === undefined || typeof port === "number") &&
    (finished === undefined || finished instanceof Promise) &&
    (shutdown === undefined || typeof shutdown === "function");
}

function isBunHttpServer(value: unknown): value is BunHttpServer {
  if (!isObject(value)) {
    return false;
  }
  const port = value.port;
  const url = value.url;
  const stop = value.stop;
  return (port === undefined || typeof port === "number") &&
    (url === undefined || url instanceof URL) &&
    (stop === undefined || typeof stop === "function");
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
    serve: (options, handler) => {
      const server: unknown = Reflect.apply(serve, denoGlobal, [options, handler]);
      if (!isDenoHttpServer(server)) {
        return {};
      }
      return server;
    },
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
    serve: (options) => {
      const server: unknown = Reflect.apply(serve, bunGlobal, [options]);
      if (!isBunHttpServer(server)) {
        return {};
      }
      return server;
    },
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
  );
}

function installSignalHandlers(options: {
  signalRuntime: SignalRuntime | null;
  signals?: readonly NodeJS.Signals[];
  logger: VeryfrontServiceServerLogger;
  stop: () => Promise<void>;
  hardShutdownTimeoutMs?: number;
  runtime: VeryfrontServiceServerRuntimeKind;
}): () => void {
  if (!options.signalRuntime) {
    return () => undefined;
  }

  const hardShutdownTimeoutMs = options.hardShutdownTimeoutMs ?? 20_000;
  const installedHandlers: Array<{
    signal: NodeJS.Signals;
    handler: SignalHandler;
    removed: boolean;
  }> = [];
  let signalShutdownStarted = false;

  for (const signal of options.signals ?? ["SIGTERM"]) {
    const handler = () => {
      if (signalShutdownStarted) {
        return;
      }

      signalShutdownStarted = true;
      options.logger.info?.("Veryfront service server received shutdown signal", {
        signal,
        runtime: options.runtime,
      });
      const hardTimeout = setTimeout(() => {
        options.logger.error?.("Veryfront service server graceful shutdown timed out", {
          signal,
          runtime: options.runtime,
        });
        options.signalRuntime?.exit?.(1);
      }, hardShutdownTimeoutMs);

      void options.stop()
        .then(() => {
          options.signalRuntime?.exit?.(0);
        })
        .catch((error: unknown) => {
          options.logger.error?.("Veryfront service server shutdown failed", {
            signal,
            runtime: options.runtime,
            error: error instanceof Error ? error.message : String(error),
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
      options.logger.warn?.("Veryfront service server could not install shutdown signal handler", {
        signal,
        runtime: options.runtime,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return () => {
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
        try {
          options.logger.warn?.(
            "Veryfront service server could not remove shutdown signal handler",
            {
              signal,
              runtime: options.runtime,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        } catch {
          // Observability failures must not prevent the remaining signal cleanup attempts.
        }
      }
    }

    if (failures.length > 0) {
      throw new AggregateError(
        failures.map(({ error }) => error),
        lifecycleFailureMessage("Veryfront service signal cleanup", failures),
      );
    }
  };
}

async function startDenoVeryfrontServer(
  options: StartVeryfrontServerOptions,
  deno: DenoServeRuntime,
): Promise<VeryfrontServiceServer> {
  const logger = options.logger ?? serverLogger.component("service-server");
  const bindAddress = options.bindAddress ?? "0.0.0.0";
  const abortController = new AbortController();
  const server = deno.serve({
    port: options.port,
    hostname: bindAddress,
    signal: abortController.signal,
    onListen: () => undefined,
  }, options.runtime.fetch);
  let removeSignalHandlers: () => void = () => undefined;

  const stop = createServiceServerStop(
    options.runtime,
    async () => {
      if (server.shutdown) {
        await server.shutdown();
        return;
      }
      abortController.abort();
      await server.finished?.catch(() => undefined);
    },
    () => removeSignalHandlers(),
    "deno",
  );

  removeSignalHandlers = installSignalHandlers({
    signalRuntime: createDenoSignalRuntime(deno),
    signals: options.signals,
    logger,
    stop,
    hardShutdownTimeoutMs: options.hardShutdownTimeoutMs,
    runtime: "deno",
  });

  logger.info?.("Veryfront service server listening", {
    port: server.addr?.port ?? options.port,
    bindAddress,
    runtime: "deno",
  });

  return {
    ready: Promise.resolve(),
    stop,
    port: server.addr?.port ?? options.port,
    url: `http://${bindAddress}:${server.addr?.port ?? options.port}`,
    runtime: "deno",
  };
}

async function startBunVeryfrontServer(
  options: StartVeryfrontServerOptions,
  bun: BunServeRuntime,
): Promise<VeryfrontServiceServer> {
  const logger = options.logger ?? serverLogger.component("service-server");
  const bindAddress = options.bindAddress ?? "0.0.0.0";
  const server = bun.serve({
    port: options.port,
    hostname: bindAddress,
    fetch: options.runtime.fetch,
  });
  let removeSignalHandlers: () => void = () => undefined;

  const stop = createServiceServerStop(
    options.runtime,
    async () => {
      if (!server.stop) {
        throw new TypeError("Bun server does not expose a stop method");
      }
      await server.stop();
    },
    () => removeSignalHandlers(),
    "bun",
  );

  removeSignalHandlers = installSignalHandlers({
    signalRuntime: getProcessSignalRuntime(),
    signals: options.signals,
    logger,
    stop,
    hardShutdownTimeoutMs: options.hardShutdownTimeoutMs,
    runtime: "bun",
  });

  logger.info?.("Veryfront service server listening", {
    port: server.port ?? options.port,
    bindAddress,
    runtime: "bun",
  });

  return {
    ready: Promise.resolve(),
    stop,
    port: server.port ?? options.port,
    url: server.url?.toString() ?? `http://${bindAddress}:${options.port}`,
    runtime: "bun",
  };
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
  const { createServer } = await import("node:http");
  const logger = options.logger ?? serverLogger.component("service-server");
  const bindAddress = options.bindAddress ?? "0.0.0.0";
  const server = createServer(toNodeHandler(options.runtime.fetch));
  let removeSignalHandlers: () => void = () => undefined;
  let listeningPort = options.port;
  let listeningUrl = `http://${bindAddress}:${listeningPort}`;
  const stop = createServiceServerStop(
    options.runtime,
    () => closeNodeServer(server),
    () => removeSignalHandlers(),
    "node",
  );

  const ready = new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, bindAddress, () => {
      server.off("error", reject);
      const address = server.address();
      if (address && typeof address !== "string") {
        listeningPort = address.port;
        listeningUrl = `http://${bindAddress}:${listeningPort}`;
      }
      logger.info?.("Veryfront service server listening", {
        port: listeningPort,
        bindAddress,
      });
      resolve();
    });
  });

  removeSignalHandlers = installSignalHandlers({
    signalRuntime: getProcessSignalRuntime(),
    signals: options.signals,
    logger,
    stop,
    hardShutdownTimeoutMs: options.hardShutdownTimeoutMs,
    runtime: "node",
  });

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
