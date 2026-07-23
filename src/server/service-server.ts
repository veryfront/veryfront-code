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
  addr: {
    port: number;
  };
  finished: PromiseLike<void>;
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
  port: number;
  url?: URL;
  stop: () => void | Promise<void>;
};

type BunServeRuntime = {
  serve: (options: BunServeOptions) => unknown;
};

type SignalHandler = () => void;

type SignalRuntime = {
  add: (signal: NodeJS.Signals, handler: SignalHandler) => void;
  remove: (signal: NodeJS.Signals, handler: SignalHandler) => void;
  exit?: (code: number) => never | void;
};

const MAX_PORT = 65_535;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const DEFAULT_HARD_SHUTDOWN_TIMEOUT_MS = 20_000;

function writeLog(
  logger: VeryfrontServiceServerLogger,
  level: keyof VeryfrontServiceServerLogger,
  message: string,
  metadata?: Record<string, unknown>,
): void {
  try {
    logger[level]?.(message, metadata);
  } catch {
    // Logging must not change request or lifecycle behavior.
  }
}

function defaultNotFound(): Response {
  return new Response("Not Found", { status: 404 });
}

function defaultErrorResponse(
  error: unknown,
  request: Request,
  logger: VeryfrontServiceServerLogger,
): Response {
  writeLog(logger, "error", "Veryfront service request failed", {
    method: request.method,
    errorType: error instanceof Error ? error.name : typeof error,
  });
  return new Response("Internal Server Error", { status: 500 });
}

function requireResponse(value: unknown, source: string): Response {
  if (!(value instanceof Response)) {
    throw new TypeError(`Veryfront service ${source} must return a Response`);
  }
  return value;
}

/** Create veryfront server. */
export function createVeryfrontServer(
  options: CreateVeryfrontServerOptions,
): VeryfrontServiceServerRuntime {
  const logger = options.logger ?? serverLogger.component("service-server");
  const modules = [...options.modules];
  const notFound = options.notFound ?? defaultNotFound;
  const onError = options.onError ??
    ((error, request) => defaultErrorResponse(error, request, logger));
  let shutdownAttempted = false;
  let shutdownFailure: AggregateError | undefined;
  let stopPromise: Promise<void> | undefined;

  return {
    fetch: async (request) => {
      try {
        for (const module of modules) {
          const response = await module.handle(request);
          if (response !== null && response !== undefined) {
            return requireResponse(response, "module handler");
          }
        }

        return requireResponse(await notFound(request), "not-found handler");
      } catch (error) {
        return requireResponse(await onError(error, request), "error handler");
      }
    },
    setShuttingDown: () => {
      if (shutdownAttempted) {
        if (shutdownFailure) throw shutdownFailure;
        return;
      }
      shutdownAttempted = true;
      const failures: unknown[] = [];
      for (const module of modules) {
        try {
          module.setShuttingDown?.();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) {
        shutdownFailure = new AggregateError(
          failures,
          "Veryfront service shutdown signaling failed",
        );
        throw shutdownFailure;
      }
    },
    stop: () => {
      if (stopPromise) return stopPromise;
      stopPromise = (async () => {
        const failures: unknown[] = [];
        for (const module of modules) {
          try {
            await module.stop?.();
          } catch (error) {
            failures.push(error);
          }
        }
        if (failures.length > 0) {
          throw new AggregateError(failures, "Veryfront service module cleanup failed");
        }
      })();
      return stopPromise;
    },
  };
}

function closeNodeServer(server: import("node:http").Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        if (
          isObject(error) && Reflect.get(error, "code") === "ERR_SERVER_NOT_RUNNING"
        ) {
          resolve();
          return;
        }
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

function isPromiseLike(value: unknown): value is PromiseLike<void> {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") {
    return false;
  }
  try {
    return typeof Reflect.get(value, "then") === "function";
  } catch {
    return false;
  }
}

function isPort(value: unknown, allowZero: boolean): value is number {
  return typeof value === "number" && Number.isInteger(value) &&
    (allowZero ? value >= 0 : value > 0) && value <= MAX_PORT;
}

function isDenoHttpServer(value: unknown): value is DenoHttpServer {
  if (!isObject(value)) {
    return false;
  }
  try {
    const finished = value.finished;
    const shutdown = value.shutdown;
    const addr = value.addr;
    return isObject(addr) && isPort(addr.port, false) && isPromiseLike(finished) &&
      (shutdown === undefined || typeof shutdown === "function");
  } catch {
    return false;
  }
}

function isBunHttpServer(value: unknown): value is BunHttpServer {
  if (!isObject(value)) {
    return false;
  }
  try {
    const port = value.port;
    const url = value.url;
    const stop = value.stop;
    return isPort(port, false) && (url === undefined || url instanceof URL) &&
      typeof stop === "function";
  } catch {
    return false;
  }
}

function normalizeSignals(signals?: readonly NodeJS.Signals[]): NodeJS.Signals[] {
  const configured: unknown = signals ?? ["SIGTERM"];
  if (!Array.isArray(configured)) {
    throw new TypeError("signals must be an array");
  }

  const normalized: NodeJS.Signals[] = [];
  const seen = new Set<string>();
  for (const signal of configured) {
    if (
      typeof signal !== "string" || signal.length > 32 ||
      !/^SIG[A-Z0-9]+$/.test(signal)
    ) {
      throw new TypeError("signals must contain valid signal names");
    }
    if (seen.has(signal)) continue;
    seen.add(signal);
    normalized.push(signal as NodeJS.Signals);
  }
  return normalized;
}

function resolveHardShutdownTimeout(timeout: number | undefined): number {
  const resolved = timeout ?? DEFAULT_HARD_SHUTDOWN_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(resolved) || resolved <= 0 ||
    resolved > MAX_TIMER_DELAY_MS
  ) {
    throw new TypeError(
      `hardShutdownTimeoutMs must be an integer between 1 and ${MAX_TIMER_DELAY_MS}`,
    );
  }
  return resolved;
}

function hasHostnameWhitespaceOrControl(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 32 || code === 127) return true;
  }
  return false;
}

function validateStartOptions(
  options: Pick<
    StartVeryfrontServerOptions,
    "runtime" | "port" | "bindAddress" | "signals" | "hardShutdownTimeoutMs"
  >,
): void {
  if (
    !isObject(options.runtime) || typeof options.runtime.fetch !== "function" ||
    typeof options.runtime.setShuttingDown !== "function" ||
    typeof options.runtime.stop !== "function"
  ) {
    throw new TypeError("runtime must implement fetch, setShuttingDown, and stop");
  }
  if (!isPort(options.port, true)) {
    throw new TypeError(`port must be an integer between 0 and ${MAX_PORT}`);
  }
  if (
    options.bindAddress !== undefined &&
    (typeof options.bindAddress !== "string" || options.bindAddress.length === 0 ||
      options.bindAddress.length > 255 || hasHostnameWhitespaceOrControl(options.bindAddress))
  ) {
    throw new TypeError("bindAddress must be a valid hostname or IP address");
  }
  normalizeSignals(options.signals);
  resolveHardShutdownTimeout(options.hardShutdownTimeoutMs);
}

function validatedRuntimeFetch(
  runtime: VeryfrontServiceServerRuntime,
): VeryfrontServiceServerFetch {
  return async (request) => requireResponse(await runtime.fetch(request), "runtime fetch handler");
}

function formatServerUrl(bindAddress: string, port: number): string {
  const hostname = bindAddress.includes(":") && !bindAddress.startsWith("[")
    ? `[${bindAddress}]`
    : bindAddress;
  return `http://${hostname}:${port}`;
}

function getMethod(
  value: unknown,
  name: string,
): ((...args: unknown[]) => unknown) | undefined {
  if (!isObject(value)) return undefined;
  try {
    const method = Reflect.get(value, name);
    if (typeof method !== "function") return undefined;
    return (...args) => Reflect.apply(method, value, args);
  } catch {
    return undefined;
  }
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
  const remove = typeof off === "function" ? off : removeListener;
  if (typeof on !== "function" || typeof remove !== "function") {
    return null;
  }
  const runtime: SignalRuntime = {
    add: (signal, handler) => {
      Reflect.apply(on, processGlobal, [signal, handler]);
    },
    remove: (signal, handler) => {
      Reflect.apply(remove, processGlobal, [signal, handler]);
    },
  };
  if (typeof exit === "function") {
    runtime.exit = (code) => Reflect.apply(exit, processGlobal, [code]);
  }
  return runtime;
}

function createDenoSignalRuntime(deno: DenoServeRuntime): SignalRuntime | null {
  if (!deno.addSignalListener || !deno.removeSignalListener) {
    return null;
  }
  return {
    add: deno.addSignalListener,
    remove: deno.removeSignalListener,
    exit: deno.exit,
  };
}

async function stopRuntime(
  runtime: VeryfrontServiceServerRuntime,
  stopServer: () => void | Promise<void>,
): Promise<void> {
  const failures: unknown[] = [];
  for (
    const action of [
      () => runtime.setShuttingDown(),
      stopServer,
      () => runtime.stop(),
    ]
  ) {
    try {
      await action();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "Veryfront service server cleanup failed");
  }
}

async function failStartup(
  startupError: unknown,
  runtime: VeryfrontServiceServerRuntime,
  stopServer: () => void | Promise<void>,
): Promise<never> {
  try {
    await stopRuntime(runtime, stopServer);
  } catch (cleanupError) {
    throw new AggregateError(
      [startupError, cleanupError],
      "Veryfront service server startup and cleanup failed",
    );
  }
  throw startupError;
}

async function callHandleMethod(
  handle: unknown,
  methodName: string,
): Promise<void> {
  const method = getMethod(handle, methodName);
  if (method) await method();
}

type SignalSubscription = {
  hardShutdownTimeoutMs: number;
  logger: VeryfrontServiceServerLogger;
  runtime: VeryfrontServiceServerRuntimeKind;
  stop: () => Promise<void>;
};

type SignalCoordinator = {
  handler: SignalHandler;
  signal: NodeJS.Signals;
  signalRuntime: SignalRuntime;
  shuttingDown: boolean;
  subscriptions: Set<SignalSubscription>;
};

const signalCoordinators = new Map<NodeJS.Signals, SignalCoordinator>();

function exitSignalRuntime(
  coordinator: SignalCoordinator,
  subscriptions: readonly SignalSubscription[],
  code: number,
): void {
  try {
    coordinator.signalRuntime.exit?.(code);
  } catch (error) {
    for (const subscription of subscriptions) {
      writeLog(
        subscription.logger,
        "error",
        "Veryfront service server could not exit after shutdown",
        {
          signal: coordinator.signal,
          runtime: subscription.runtime,
          errorType: error instanceof Error ? error.name : typeof error,
        },
      );
    }
  }
}

function startSignalShutdown(coordinator: SignalCoordinator): void {
  if (coordinator.shuttingDown) return;
  coordinator.shuttingDown = true;
  const subscriptions = [...coordinator.subscriptions];
  if (subscriptions.length === 0) return;

  for (const subscription of subscriptions) {
    writeLog(
      subscription.logger,
      "info",
      "Veryfront service server received shutdown signal",
      { signal: coordinator.signal, runtime: subscription.runtime },
    );
  }

  let hardTimeoutReached = false;
  const hardShutdownTimeoutMs = Math.min(
    ...subscriptions.map((subscription) => subscription.hardShutdownTimeoutMs),
  );
  const hardTimeout = setTimeout(() => {
    hardTimeoutReached = true;
    for (const subscription of subscriptions) {
      writeLog(
        subscription.logger,
        "error",
        "Veryfront service server graceful shutdown timed out",
        { signal: coordinator.signal, runtime: subscription.runtime },
      );
    }
    exitSignalRuntime(coordinator, subscriptions, 1);
  }, hardShutdownTimeoutMs);

  void Promise.allSettled(
    subscriptions.map((subscription) => Promise.resolve().then(subscription.stop)),
  ).then((results) => {
    let failed = false;
    for (let index = 0; index < results.length; index++) {
      const result = results[index];
      if (result?.status !== "rejected") continue;
      failed = true;
      const subscription = subscriptions[index];
      if (!subscription) continue;
      writeLog(
        subscription.logger,
        "error",
        "Veryfront service server shutdown failed",
        {
          signal: coordinator.signal,
          runtime: subscription.runtime,
          errorType: result.reason instanceof Error ? result.reason.name : typeof result.reason,
        },
      );
    }
    if (!hardTimeoutReached) {
      exitSignalRuntime(coordinator, subscriptions, failed ? 1 : 0);
    }
  }).finally(() => clearTimeout(hardTimeout));
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

  const hardShutdownTimeoutMs = resolveHardShutdownTimeout(options.hardShutdownTimeoutMs);
  const installedSubscriptions: Array<{
    coordinator: SignalCoordinator;
    subscription: SignalSubscription;
  }> = [];
  let handlersRemoved = false;

  const removeInstalledSubscriptions = (): void => {
    if (handlersRemoved) return;
    handlersRemoved = true;
    for (const { coordinator, subscription } of installedSubscriptions) {
      coordinator.subscriptions.delete(subscription);
      if (coordinator.subscriptions.size > 0) continue;
      if (signalCoordinators.get(coordinator.signal) !== coordinator) continue;
      signalCoordinators.delete(coordinator.signal);
      try {
        coordinator.signalRuntime.remove(coordinator.signal, coordinator.handler);
      } catch (error) {
        writeLog(
          subscription.logger,
          "warn",
          "Veryfront service server could not remove shutdown signal handler",
          {
            signal: coordinator.signal,
            runtime: subscription.runtime,
            errorType: error instanceof Error ? error.name : typeof error,
          },
        );
      }
    }
  };

  for (const signal of normalizeSignals(options.signals)) {
    const subscription: SignalSubscription = {
      hardShutdownTimeoutMs,
      logger: options.logger,
      runtime: options.runtime,
      stop: options.stop,
    };
    let coordinator = signalCoordinators.get(signal);
    if (!coordinator) {
      const created: SignalCoordinator = {
        handler: () => startSignalShutdown(created),
        signal,
        signalRuntime: options.signalRuntime,
        shuttingDown: false,
        subscriptions: new Set(),
      };
      try {
        options.signalRuntime.add(signal, created.handler);
      } catch (error) {
        writeLog(
          options.logger,
          "warn",
          "Veryfront service server could not install shutdown signal handler",
          {
            signal,
            runtime: options.runtime,
            errorType: error instanceof Error ? error.name : typeof error,
          },
        );
        removeInstalledSubscriptions();
        throw new TypeError(
          "Veryfront service server could not install shutdown signal handler",
        );
      }
      signalCoordinators.set(signal, created);
      coordinator = created;
    } else if (coordinator.shuttingDown) {
      removeInstalledSubscriptions();
      throw new Error("Veryfront service server shutdown is already in progress");
    } else if (!coordinator.signalRuntime.exit && options.signalRuntime.exit) {
      coordinator.signalRuntime.exit = options.signalRuntime.exit;
    }
    coordinator.subscriptions.add(subscription);
    installedSubscriptions.push({ coordinator, subscription });
  }

  return removeInstalledSubscriptions;
}

async function startDenoVeryfrontServer(
  options: StartVeryfrontServerOptions,
  deno: DenoServeRuntime,
): Promise<VeryfrontServiceServer> {
  const logger = options.logger ?? serverLogger.component("service-server");
  const bindAddress = options.bindAddress ?? "0.0.0.0";
  const abortController = new AbortController();
  const fetch = validatedRuntimeFetch(options.runtime);
  let serverValue: unknown;
  try {
    serverValue = deno.serve({
      port: options.port,
      hostname: bindAddress,
      signal: abortController.signal,
      onListen: () => undefined,
    }, fetch);
  } catch (error) {
    return await failStartup(error, options.runtime, () => abortController.abort());
  }

  const stopNativeServer = async (): Promise<void> => {
    const shutdown = getMethod(serverValue, "shutdown");
    if (shutdown) {
      await shutdown();
      return;
    }
    abortController.abort();
    if (isObject(serverValue)) {
      const finished = serverValue.finished;
      if (isPromiseLike(finished)) await finished;
    }
  };

  if (!isDenoHttpServer(serverValue)) {
    return await failStartup(
      new TypeError("Deno.serve returned an invalid server handle"),
      options.runtime,
      stopNativeServer,
    );
  }
  const server = serverValue;
  let stopPromise: Promise<void> | undefined;
  let removeSignalHandlers: () => void = () => undefined;

  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      try {
        await stopRuntime(options.runtime, stopNativeServer);
      } finally {
        removeSignalHandlers();
      }
    })();
    return stopPromise;
  };

  try {
    removeSignalHandlers = installSignalHandlers({
      signalRuntime: createDenoSignalRuntime(deno),
      signals: options.signals,
      logger,
      stop,
      hardShutdownTimeoutMs: options.hardShutdownTimeoutMs,
      runtime: "deno",
    });
  } catch (error) {
    return await failStartup(error, options.runtime, stopNativeServer);
  }

  writeLog(logger, "info", "Veryfront service server listening", {
    port: server.addr.port,
    runtime: "deno",
  });

  return {
    ready: Promise.resolve(),
    stop,
    port: server.addr.port,
    url: formatServerUrl(bindAddress, server.addr.port),
    runtime: "deno",
  };
}

async function startBunVeryfrontServer(
  options: StartVeryfrontServerOptions,
  bun: BunServeRuntime,
): Promise<VeryfrontServiceServer> {
  const logger = options.logger ?? serverLogger.component("service-server");
  const bindAddress = options.bindAddress ?? "0.0.0.0";
  const fetch = validatedRuntimeFetch(options.runtime);
  let serverValue: unknown;
  try {
    serverValue = bun.serve({
      port: options.port,
      hostname: bindAddress,
      fetch,
    });
  } catch (error) {
    return await failStartup(error, options.runtime, () => undefined);
  }
  const stopNativeServer = () => callHandleMethod(serverValue, "stop");
  if (!isBunHttpServer(serverValue)) {
    return await failStartup(
      new TypeError("Bun.serve returned an invalid server handle"),
      options.runtime,
      stopNativeServer,
    );
  }
  const server = serverValue;
  let stopPromise: Promise<void> | undefined;
  let removeSignalHandlers: () => void = () => undefined;

  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      try {
        await stopRuntime(options.runtime, stopNativeServer);
      } finally {
        removeSignalHandlers();
      }
    })();
    return stopPromise;
  };

  try {
    removeSignalHandlers = installSignalHandlers({
      signalRuntime: getProcessSignalRuntime(),
      signals: options.signals,
      logger,
      stop,
      hardShutdownTimeoutMs: options.hardShutdownTimeoutMs,
      runtime: "bun",
    });
  } catch (error) {
    return await failStartup(error, options.runtime, stopNativeServer);
  }

  writeLog(logger, "info", "Veryfront service server listening", {
    port: server.port,
    runtime: "bun",
  });

  return {
    ready: Promise.resolve(),
    stop,
    port: server.port,
    url: formatServerUrl(bindAddress, server.port),
    runtime: "bun",
  };
}

/** Starts veryfront server. */
export async function startVeryfrontServer(
  options: StartVeryfrontServerOptions,
): Promise<VeryfrontServiceServer | NodeVeryfrontServiceServer> {
  validateStartOptions(options);
  const bun = getBunServeRuntime();
  if (bun) {
    return await startBunVeryfrontServer(options, bun);
  }
  const deno = getDenoServeRuntime();
  if (deno) {
    return await startDenoVeryfrontServer(options, deno);
  }
  return await startNodeVeryfrontServer(options);
}

/** Starts node veryfront server. */
export async function startNodeVeryfrontServer(
  options: StartNodeVeryfrontServerOptions,
): Promise<NodeVeryfrontServiceServer> {
  validateStartOptions(options);
  const { createServer } = await import("node:http");
  const logger = options.logger ?? serverLogger.component("service-server");
  const bindAddress = options.bindAddress ?? "0.0.0.0";
  const server = createServer(toNodeHandler(validatedRuntimeFetch(options.runtime)));
  let actualPort = options.port;
  let stopPromise: Promise<void> | undefined;
  let removeSignalHandlers: () => void = () => undefined;
  let readySettled = false;
  let startupFailed = false;
  let startupFailure: unknown;
  let resolveReady: () => void = () => undefined;
  let rejectReady: (reason: unknown) => void = () => undefined;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // Callers can await `ready`, but startup can fail before they attach a handler.
  // Keep the rejection observed without changing the promise returned to callers.
  void ready.catch(() => undefined);

  const onRuntimeError = (error: unknown): void => {
    writeLog(logger, "error", "Veryfront service server runtime error", {
      runtime: "node",
      errorType: error instanceof Error ? error.name : typeof error,
    });
  };

  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      let cleanupFailure: unknown;
      try {
        await stopRuntime(options.runtime, () => closeNodeServer(server));
      } catch (error) {
        cleanupFailure = error;
        throw error;
      } finally {
        removeSignalHandlers();
        server.off("error", onStartupError);
        server.off("error", onRuntimeError);
        if (!readySettled) {
          readySettled = true;
          if (startupFailed && cleanupFailure !== undefined) {
            rejectReady(
              new AggregateError(
                [startupFailure, cleanupFailure],
                "Veryfront service server startup and cleanup failed",
              ),
            );
          } else if (startupFailed) {
            rejectReady(startupFailure);
          } else if (cleanupFailure !== undefined) {
            rejectReady(cleanupFailure);
          } else {
            rejectReady(new Error("Veryfront service server stopped before it became ready"));
          }
        }
      }
    })();
    return stopPromise;
  };

  const onStartupError = (error: unknown): void => {
    if (readySettled) {
      onRuntimeError(error);
      return;
    }
    startupFailed = true;
    startupFailure = error;
    void stop().catch(() => undefined);
  };

  server.once("error", onStartupError);
  try {
    server.listen(options.port, bindAddress, () => {
      if (stopPromise || readySettled) return;
      const address = server.address();
      const port = isObject(address) && isPort(address.port, false) ? address.port : null;
      if (port === null) {
        onStartupError(new TypeError("Node server returned an invalid listening address"));
        return;
      }
      actualPort = port;
      readySettled = true;
      server.off("error", onStartupError);
      server.on("error", onRuntimeError);
      writeLog(logger, "info", "Veryfront service server listening", {
        port,
        runtime: "node",
      });
      resolveReady();
    });
  } catch (error) {
    startupFailed = true;
    startupFailure = error;
    try {
      await stop();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Veryfront service server startup and cleanup failed",
      );
    }
    throw error;
  }

  try {
    removeSignalHandlers = installSignalHandlers({
      signalRuntime: getProcessSignalRuntime(),
      signals: options.signals,
      logger,
      stop,
      hardShutdownTimeoutMs: options.hardShutdownTimeoutMs,
      runtime: "node",
    });
  } catch (error) {
    startupFailed = true;
    startupFailure = error;
    try {
      await stop();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Veryfront service server startup and cleanup failed",
      );
    }
    throw error;
  }

  return {
    server,
    ready,
    stop,
    get port() {
      return actualPort;
    },
    get url() {
      return formatServerUrl(bindAddress, actualPort);
    },
    runtime: "node",
  };
}
