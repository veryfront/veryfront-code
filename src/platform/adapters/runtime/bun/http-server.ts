import {
  isWebSocketUpgradeResponse,
  type RuntimeRequestHandler,
  type ServeOptions,
  type Server,
} from "../../base.ts";
import type { BunServer as BunServerType, BunServerWebSocket } from "./types.ts";
import { DEFAULT_PORT } from "../../../compat/constants.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { SERVER_START_ERROR } from "#veryfront/errors/error-registry/server.ts";
import { BunWebSocket, runWithBunServerRequest } from "./websocket-adapter.ts";

const logger = serverLogger.component("bun");

export class BunServer implements Server {
  private stopPromise: Promise<void> | null = null;
  private removeAbortListener: () => void = () => {};

  constructor(
    private readonly server: BunServerType,
    private readonly hostname: string,
    private readonly port: number,
    signal?: AbortSignal,
  ) {
    if (signal) {
      const onAbort = (): void => {
        void this.stop().catch(() => logger.error("Failed to stop an aborted server"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.removeAbortListener = () => signal.removeEventListener("abort", onAbort);
    }
  }

  stop(): Promise<void> {
    if (!this.stopPromise) {
      this.removeAbortListener();
      const pending = Promise.resolve().then(() => this.server.stop(true));
      const retryable = pending.catch((error) => {
        if (this.stopPromise === retryable) this.stopPromise = null;
        throw error;
      });
      this.stopPromise = retryable;
    }
    return this.stopPromise;
  }

  get addr(): { hostname: string; port: number } {
    return { hostname: this.hostname, port: this.port };
  }
}

function getWebSocket(socket: BunServerWebSocket): BunWebSocket | null {
  if (socket.data instanceof BunWebSocket) return socket.data;
  socket.close(1011, "Invalid WebSocket state");
  return null;
}

function resolveAddress(
  server: BunServerType,
): { hostname: string; port: number } {
  if (
    typeof server.hostname !== "string" || server.hostname.length === 0 ||
    typeof server.port !== "number" || !Number.isInteger(server.port) || server.port <= 0 ||
    server.port > 65_535
  ) {
    throw SERVER_START_ERROR.create({
      message: "Bun did not report a valid server address",
    });
  }
  return { hostname: server.hostname, port: server.port };
}

export async function createBunServer(
  handler: RuntimeRequestHandler,
  options: ServeOptions = {},
): Promise<Server> {
  const { port = DEFAULT_PORT, hostname = "localhost", onListen, signal } = options;
  signal?.throwIfAborted();

  let nativeServer: BunServerType;
  try {
    nativeServer = Bun.serve({
      port,
      hostname,
      fetch: async (request, server) => {
        try {
          const response = await runWithBunServerRequest(
            request,
            server,
            () => handler(request),
          );
          return isWebSocketUpgradeResponse(response) ? undefined : response;
        } catch {
          logger.error("Request handler failed");
          return new Response("Internal Server Error", { status: 500 });
        }
      },
      websocket: {
        idleTimeout: 0,
        open(socket) {
          getWebSocket(socket)?._attachRealSocket(socket);
        },
        message(socket, message) {
          getWebSocket(socket)?._handleMessage(message);
        },
        close(socket, code, reason) {
          getWebSocket(socket)?._handleClose(code, reason);
        },
        error(socket, error) {
          getWebSocket(socket)?._handleError(
            error instanceof Error ? error : new Error("WebSocket transport failed"),
          );
        },
      },
    });
  } catch (error) {
    throw SERVER_START_ERROR.create({
      message: "Unable to start the Bun server",
      cause: error,
    });
  }

  let address: { hostname: string; port: number };
  try {
    address = resolveAddress(nativeServer);
  } catch (error) {
    try {
      await nativeServer.stop(true);
    } catch {
      logger.error("Failed to stop a partially started server");
    }
    throw error;
  }

  const server = new BunServer(
    nativeServer,
    address.hostname,
    address.port,
    signal,
  );

  try {
    onListen?.(address);
  } catch (error) {
    try {
      await server.stop();
    } catch {
      logger.error("Failed to stop the server after onListen failed");
    }
    throw error;
  }

  return server;
}
