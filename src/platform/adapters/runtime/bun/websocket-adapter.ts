import {
  createWebSocketUpgradeResponse,
  isWebSocketUpgradeResponse,
  type ServerAdapter,
  type WebSocketUpgrade,
  type WebSocketUpgradeOptions,
  type WebSocketUpgradeResponse,
} from "../../base.ts";
import { DeferredWebSocket } from "../shared/deferred-websocket.ts";
import { resolvePortableWebSocketUpgradeHeaders } from "../../../compat/http/websocket-upgrade-options.ts";
import type {
  BunServer,
  BunServerWebSocket,
  BunWebSocketHandler,
  BunWebSocketMessage,
} from "./types.ts";
import { INVALID_ARGUMENT, NOT_SUPPORTED } from "#veryfront/errors/error-registry/general.ts";
import { NETWORK_ERROR } from "#veryfront/errors/error-registry/server.ts";

export interface BunWebSocketData {
  readonly socket: BunWebSocket;
}

type BunRequestHandler = (
  request: Request,
) =>
  | Promise<Response | WebSocketUpgradeResponse>
  | Response
  | WebSocketUpgradeResponse;

interface BunUpgradeContext {
  readonly server: BunServer<BunWebSocketData>;
  socket?: BunWebSocket;
}

export interface BunRequestDispatchResult {
  readonly response?: Response;
  readonly upgradeError?: unknown;
}

const activeBunRequests = new WeakMap<Request, BunUpgradeContext>();

export function resolveBunWebSocketUpgradeHeaders(
  request: Request,
  options: WebSocketUpgradeOptions = {},
): Headers {
  return resolvePortableWebSocketUpgradeHeaders(request, options, {
    platform: "bun",
    runtimeName: "Bun",
    unsupportedIdleTimeoutDetail:
      "Bun configures WebSocket idle timeouts per server; this adapter supports only idleTimeout: 0",
  });
}

export async function dispatchBunRequest(
  request: Request,
  server: BunServer<BunWebSocketData>,
  handler: BunRequestHandler,
): Promise<BunRequestDispatchResult> {
  if (activeBunRequests.has(request)) {
    throw INVALID_ARGUMENT.create({
      detail: "The same Bun Request cannot be dispatched concurrently",
      context: { platform: "bun", operation: "serve.fetch" },
    });
  }

  const context: BunUpgradeContext = { server };
  activeBunRequests.set(request, context);

  try {
    const response = await handler(request);
    if (!context.socket) {
      if (isWebSocketUpgradeResponse(response)) {
        throw INVALID_ARGUMENT.create({
          detail:
            "Bun request handler returned a WebSocket upgrade signal without upgrading the active Request",
          context: { platform: "bun", operation: "serve.fetch" },
        });
      }
      return { response };
    }

    if (!isWebSocketUpgradeResponse(response)) {
      const error = INVALID_ARGUMENT.create({
        detail:
          "Bun request handler must return the WebSocket upgrade response after a successful upgrade",
        context: { platform: "bun", operation: "serve.fetch" },
      });
      context.socket._failUpgrade(error);
      return { upgradeError: error };
    }

    // Bun owns and emits the 101 response. Returning undefined from fetch is
    // mandatory after server.upgrade() succeeds.
    return {};
  } catch (error) {
    if (!context.socket) throw error;
    context.socket._failUpgrade(error);
    return { upgradeError: error };
  } finally {
    activeBunRequests.delete(request);
  }
}

function getBridge(socket: BunServerWebSocket<BunWebSocketData>): BunWebSocket | null {
  const bridge = socket.data?.socket;
  if (bridge instanceof BunWebSocket) return bridge;

  socket.terminate?.();
  if (!socket.terminate) socket.close(1011, "Invalid WebSocket context");
  return null;
}

function normalizeMessageData(message: BunWebSocketMessage): string | ArrayBuffer {
  if (typeof message === "string" || message instanceof ArrayBuffer) return message;
  const copy = new Uint8Array(message.byteLength);
  copy.set(message);
  return copy.buffer;
}

export const bunWebSocketHandler: BunWebSocketHandler<BunWebSocketData> = {
  // Bun configures this per server rather than per connection. The platform's
  // long-lived HMR/proxy sockets request zero and enforce liveness with their
  // own heartbeat protocol.
  idleTimeout: 0,
  open(socket) {
    getBridge(socket)?._attachNativeSocket(socket);
  },
  message(socket, message) {
    getBridge(socket)?._emitNativeMessage(normalizeMessageData(message));
  },
  close(socket, code, reason) {
    getBridge(socket)?._emitNativeClose(code, reason);
  },
  error(socket, error) {
    getBridge(socket)?._emitNativeError(error);
  },
};

export class BunServerAdapter implements ServerAdapter {
  upgradeWebSocket(
    request: Request,
    options?: WebSocketUpgradeOptions,
  ): WebSocketUpgrade {
    const context = activeBunRequests.get(request);
    if (!context) {
      throw NOT_SUPPORTED.create({
        detail:
          "Bun WebSocket upgrades require the original Request inside a createBunServer() handler",
        context: { platform: "bun", operation: "upgradeWebSocket" },
      });
    }
    if (context.socket) {
      throw INVALID_ARGUMENT.create({
        detail: "Bun Request has already been upgraded",
        context: { platform: "bun", operation: "upgradeWebSocket" },
      });
    }

    const headers = resolveBunWebSocketUpgradeHeaders(request, options);
    const socket = new BunWebSocket();
    const selectedProtocol = headers.get("sec-websocket-protocol");
    const nativeHeaders = new Headers(headers);
    nativeHeaders.delete("sec-websocket-protocol");
    const offeredProtocols = request.headers.get("sec-websocket-protocol");

    let upgraded: boolean;
    try {
      // Bun selects the first protocol from the request itself. Supplying the
      // application selection as a response header makes Bun emit the header
      // twice and standards-compliant clients reject the handshake. Narrow
      // the native request during the synchronous upgrade instead.
      if (selectedProtocol !== null) {
        request.headers.set("sec-websocket-protocol", selectedProtocol);
      }
      upgraded = context.server.upgrade(request, {
        data: { socket },
        headers: nativeHeaders,
      });
    } catch (error) {
      throw NETWORK_ERROR.create({
        detail: "Bun failed to upgrade the WebSocket connection",
        cause: error,
        context: { platform: "bun", operation: "upgradeWebSocket" },
      });
    } finally {
      if (selectedProtocol !== null) {
        if (offeredProtocols === null) request.headers.delete("sec-websocket-protocol");
        else request.headers.set("sec-websocket-protocol", offeredProtocols);
      }
    }
    if (!upgraded) {
      throw NETWORK_ERROR.create({
        detail: "Bun rejected the WebSocket upgrade",
        context: { platform: "bun", operation: "upgradeWebSocket" },
      });
    }

    context.socket = socket;
    return {
      socket,
      response: createWebSocketUpgradeResponse({ headers }),
    };
  }
}

export class BunWebSocket extends DeferredWebSocket {
  constructor() {
    super("Bun");
  }

  _attachNativeSocket(socket: BunServerWebSocket<BunWebSocketData>): void {
    this.attachTransport({
      send(data) {
        const result = socket.send(data);
        if (result === 0) {
          throw NETWORK_ERROR.create({
            detail: "Bun dropped a WebSocket message because the connection closed",
            context: { platform: "bun", operation: "websocket.send" },
          });
        }
        return result;
      },
      close(code, reason) {
        socket.close(code, reason);
      },
      terminate() {
        if (socket.terminate) socket.terminate();
        else socket.close(1011, "WebSocket transport failed");
      },
    });
  }

  _emitNativeMessage(data: string | ArrayBuffer): void {
    this.emitMessage(data);
  }

  _emitNativeClose(code: number, reason: string): void {
    this.emitClose(code, reason);
  }

  _emitNativeError(error: Error): void {
    this.emitTransportError(error);
  }

  _failUpgrade(error: unknown): void {
    this.fail(error);
  }
}
