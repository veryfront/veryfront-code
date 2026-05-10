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

export type NodeVeryfrontServiceServer = {
  server: import("node:http").Server;
  ready: Promise<void>;
  stop: () => Promise<void>;
  port: number;
  url: string;
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
  };
}
