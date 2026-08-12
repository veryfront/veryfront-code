import type { ServeOptions, Server, WebSocketUpgradeResponse } from "../../base.ts";
import type { BunNamespace, BunServer as NativeBunServer } from "./types.ts";
import { getBunRuntime } from "./types.ts";
import {
  type BunWebSocketData,
  bunWebSocketHandler,
  dispatchBunRequest,
} from "./websocket-adapter.ts";
import { DEFAULT_PORT } from "../../../compat/constants.ts";
import { isErrorAcrossRealms } from "../../../compat/error-introspection.ts";
import { INITIALIZATION_ERROR, NOT_SUPPORTED } from "#veryfront/errors/error-registry/general.ts";
import { serverLogger } from "#veryfront/utils";
import { recordRequestPeerFromTransport } from "../shared/request-peer.ts";

type BunRequestHandler = (
  request: Request,
) =>
  | Promise<Response | WebSocketUpgradeResponse>
  | Response
  | WebSocketUpgradeResponse;

type BoundNativeBunServer = NativeBunServer<BunWebSocketData> & {
  readonly hostname: string;
  readonly port: number;
};

function abortError(signal: AbortSignal): Error {
  return isErrorAcrossRealms(signal.reason)
    ? signal.reason
    : new DOMException("Bun server startup was aborted", "AbortError");
}

async function rejectAbortedStartup(server: Server, signal: AbortSignal): Promise<never> {
  const error = abortError(signal);
  try {
    await server.stop();
  } catch (cleanupError) {
    throw new AggregateError(
      [error, cleanupError],
      "Bun server startup was aborted and cleanup failed",
    );
  }
  throw error;
}

export class BunServer implements Server {
  private stopped = false;
  private stopPromise: Promise<void> | null = null;
  private abortListener: (() => void) | null = null;

  constructor(
    private readonly server: BoundNativeBunServer,
    private readonly signal?: AbortSignal,
  ) {
    if (signal) {
      this.abortListener = () => {
        void this.stop().catch((error) => {
          serverLogger.error("Bun server abort cleanup failed", { error });
        });
      };
      signal.addEventListener("abort", this.abortListener, { once: true });
      if (signal.aborted) this.abortListener();
    }
  }

  stop(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.stopPromise) return this.stopPromise;
    this.removeAbortListener();

    const attempt = Promise.resolve()
      .then(() => this.server.stop(true))
      .then(() => {
        this.stopped = true;
      })
      .finally(() => {
        if (this.stopPromise === attempt) this.stopPromise = null;
      });
    this.stopPromise = attempt;
    return attempt;
  }

  get addr(): { hostname: string; port: number } {
    return { hostname: this.server.hostname, port: this.server.port };
  }

  private removeAbortListener(): void {
    if (!this.signal || !this.abortListener) return;
    this.signal.removeEventListener("abort", this.abortListener);
    this.abortListener = null;
  }
}

export async function createBunServerWithRuntime(
  runtime: BunNamespace,
  handler: BunRequestHandler,
  options: ServeOptions = {},
): Promise<Server> {
  const { port = DEFAULT_PORT, hostname = "localhost", onListen, signal } = options;
  if (signal?.aborted) throw abortError(signal);
  if (typeof runtime.serve !== "function") {
    throw NOT_SUPPORTED.create({
      detail: "The detected Bun runtime does not expose Bun.serve()",
      context: { platform: "bun", operation: "serve" },
    });
  }

  const nativeServer = runtime.serve<BunWebSocketData>({
    port,
    hostname,
    websocket: bunWebSocketHandler,
    fetch: async (request, server) => {
      try {
        let address: string | undefined;
        try {
          address = server.requestIP?.(request)?.address;
        } catch (error) {
          serverLogger.warn(
            "Bun request peer lookup failed; local-control routes will reject the request",
            { error },
          );
        }
        if (typeof address === "string") {
          recordRequestPeerFromTransport(request, {
            runtime: "bun",
            transport: "tcp",
            hostname: address,
          });
        }
        const result = await dispatchBunRequest(request, server, handler);
        if (result.upgradeError) {
          serverLogger.error("Bun WebSocket request failed after upgrade", {
            error: result.upgradeError,
          });
        }
        return result.response;
      } catch (error) {
        serverLogger.error("Bun request handler failed", { error });
        return new Response("Internal Server Error", { status: 500 });
      }
    },
  });
  if (
    typeof nativeServer.hostname !== "string" ||
    nativeServer.hostname.length === 0 ||
    !Number.isSafeInteger(nativeServer.port) ||
    (nativeServer.port ?? 0) <= 0 ||
    (nativeServer.port ?? 0) > 65_535
  ) {
    const error = INITIALIZATION_ERROR.create({
      detail: "Bun.serve() did not return a valid bound TCP address",
      context: {
        platform: "bun",
        operation: "serve",
        hostname: nativeServer.hostname,
        port: nativeServer.port,
      },
    });
    try {
      await nativeServer.stop(true);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Bun server returned an invalid address and cleanup failed",
      );
    }
    throw error;
  }

  const server = new BunServer(nativeServer as BoundNativeBunServer, signal);
  if (signal?.aborted) {
    return await rejectAbortedStartup(server, signal);
  }

  try {
    onListen?.(server.addr);
  } catch (error) {
    try {
      await server.stop();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Bun onListen callback and server cleanup both failed",
      );
    }
    throw error;
  }
  if (signal?.aborted) {
    return await rejectAbortedStartup(server, signal);
  }

  return server;
}

export async function createBunServer(
  handler: BunRequestHandler,
  options: ServeOptions = {},
): Promise<Server> {
  const runtime = getBunRuntime();
  if (!runtime) {
    throw NOT_SUPPORTED.create({
      detail: "createBunServer() can only be used in the Bun runtime",
      context: { platform: "bun", operation: "serve" },
    });
  }
  return await createBunServerWithRuntime(runtime, handler, options);
}
