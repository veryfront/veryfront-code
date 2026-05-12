import { serverLogger } from "#veryfront/utils";
import { toNodeHandler } from "./node-handler.ts";

export type VeryfrontServiceServerFetch = (request: Request) => Response | Promise<Response>;
export type VeryfrontServiceServerModuleResponse = Response | null | undefined;

export type VeryfrontServiceServerModule = {
  name: string;
  handle: (
    request: Request,
  ) => VeryfrontServiceServerModuleResponse | Promise<VeryfrontServiceServerModuleResponse>;
  setShuttingDown?: () => void;
  stop?: () => void | Promise<void>;
};

export type VeryfrontServiceServerLogger = {
  debug?: (message: string, metadata?: Record<string, unknown>) => void;
  info?: (message: string, metadata?: Record<string, unknown>) => void;
  warn?: (message: string, metadata?: Record<string, unknown>) => void;
  error?: (message: string, metadata?: Record<string, unknown>) => void;
};

export type CreateVeryfrontServerOptions = {
  modules: readonly VeryfrontServiceServerModule[];
  notFound?: (request: Request) => Response | Promise<Response>;
  onError?: (error: unknown, request: Request) => Response | Promise<Response>;
  logger?: VeryfrontServiceServerLogger;
};

export type VeryfrontServiceServerRuntime = {
  fetch: VeryfrontServiceServerFetch;
  setShuttingDown: () => void;
  stop: () => Promise<void>;
};

export type StartNodeVeryfrontServerOptions = {
  runtime: VeryfrontServiceServerRuntime;
  port: number;
  bindAddress?: string;
  logger?: VeryfrontServiceServerLogger;
  signals?: readonly NodeJS.Signals[];
  hardShutdownTimeoutMs?: number;
};

export type StartVeryfrontServerOptions = {
  runtime: VeryfrontServiceServerRuntime;
  port: number;
  bindAddress?: string;
  logger?: VeryfrontServiceServerLogger;
  signals?: readonly NodeJS.Signals[];
  hardShutdownTimeoutMs?: number;
};

export type VeryfrontServiceServerRuntimeKind = "node" | "deno" | "bun";

export type VeryfrontServiceServer = {
  ready: Promise<void>;
  stop: () => Promise<void>;
  port: number;
  url: string;
  runtime: VeryfrontServiceServerRuntimeKind;
};

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

export function createVeryfrontServer(
  options: CreateVeryfrontServerOptions,
): VeryfrontServiceServerRuntime {
  const logger = options.logger ?? serverLogger.component("service-server");
  const notFound = options.notFound ?? defaultNotFound;
  const onError = options.onError ??
    ((error, request) => defaultErrorResponse(error, request, logger));

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
      for (const module of options.modules) {
        module.setShuttingDown?.();
      }
    },
    stop: async () => {
      for (const module of options.modules) {
        await module.stop?.();
      }
    },
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
  if (typeof serve !== "function") {
    return null;
  }
  return {
    serve: (options, handler) => {
      const server: unknown = Reflect.apply(serve, denoGlobal, [options, handler]);
      if (!isDenoHttpServer(server)) {
        return {};
      }
      return server;
    },
  };
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

function resolveRuntimeKind(): VeryfrontServiceServerRuntimeKind {
  if (getBunServeRuntime()) {
    return "bun";
  }
  if (getDenoServeRuntime()) {
    return "deno";
  }
  return "node";
}

async function stopRuntime(
  runtime: VeryfrontServiceServerRuntime,
  stopServer: () => void | Promise<void>,
): Promise<void> {
  runtime.setShuttingDown();
  await stopServer();
  await runtime.stop();
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
  let shutdownStarted = false;

  const stop = async () => {
    if (shutdownStarted) {
      return;
    }

    shutdownStarted = true;
    await stopRuntime(options.runtime, async () => {
      if (server.shutdown) {
        await server.shutdown();
        return;
      }
      abortController.abort();
      await server.finished?.catch(() => undefined);
    });
  };

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
  let shutdownStarted = false;

  const stop = async () => {
    if (shutdownStarted) {
      return;
    }

    shutdownStarted = true;
    await stopRuntime(options.runtime, async () => {
      await server.stop?.();
    });
  };

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

export async function startNodeVeryfrontServer(
  options: StartNodeVeryfrontServerOptions,
): Promise<NodeVeryfrontServiceServer> {
  const { createServer } = await import("node:http");
  const logger = options.logger ?? serverLogger.component("service-server");
  const bindAddress = options.bindAddress ?? "0.0.0.0";
  const hardShutdownTimeoutMs = options.hardShutdownTimeoutMs ?? 20_000;
  const server = createServer(toNodeHandler(options.runtime.fetch));
  let shutdownStarted = false;

  const stop = async () => {
    if (shutdownStarted) {
      return;
    }

    shutdownStarted = true;
    options.runtime.setShuttingDown();
    await closeNodeServer(server);
    await options.runtime.stop();
  };

  const ready = new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, bindAddress, () => {
      server.off("error", reject);
      logger.info?.("Veryfront service server listening", {
        port: options.port,
        bindAddress,
      });
      resolve();
    });
  });

  for (const signal of options.signals ?? ["SIGTERM"]) {
    process.on(signal, () => {
      if (shutdownStarted) {
        return;
      }

      logger.info?.("Veryfront service server received shutdown signal", { signal });
      const hardTimeout = setTimeout(() => {
        logger.error?.("Veryfront service server graceful shutdown timed out", { signal });
        process.exit(1);
      }, hardShutdownTimeoutMs);

      void stop()
        .then(() => {
          clearTimeout(hardTimeout);
          process.exit(0);
        })
        .catch((error: unknown) => {
          clearTimeout(hardTimeout);
          logger.error?.("Veryfront service server shutdown failed", {
            signal,
            error: error instanceof Error ? error.message : String(error),
          });
          process.exit(1);
        });
    });
  }

  return {
    server,
    ready,
    stop,
    port: options.port,
    url: `http://${bindAddress}:${options.port}`,
    runtime: "node",
  };
}
