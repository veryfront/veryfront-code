import {
  createWebSocketUpgradeResponse,
  type ServerAdapter,
  type WebSocketUpgrade,
  type WebSocketUpgradeOptions,
} from "../../base.ts";
import { INVALID_ARGUMENT, NOT_SUPPORTED } from "#veryfront/errors/error-registry/general.ts";
import { NETWORK_ERROR } from "#veryfront/errors/error-registry/server.ts";
import type { BunServer, BunServerWebSocket } from "./types.ts";

const bunServerByRequest = new WeakMap<Request, BunServer>();
const MAX_PENDING_MESSAGES = 100;

export async function runWithBunServerRequest<T>(
  request: Request,
  server: BunServer,
  operation: () => Promise<T> | T,
): Promise<T> {
  bunServerByRequest.set(request, server);
  try {
    return await operation();
  } finally {
    bunServerByRequest.delete(request);
  }
}

function resolveUpgradeHeaders(
  request: Request,
  options: WebSocketUpgradeOptions | undefined,
): Headers {
  const headers = new Headers(options?.headers);
  const protocol = options?.protocol;
  if (!protocol) return headers;

  const requestedProtocols = (request.headers.get("sec-websocket-protocol") ?? "")
    .split(",")
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  if (!requestedProtocols.includes(protocol)) {
    throw INVALID_ARGUMENT.create({
      message: "The selected WebSocket protocol was not requested by the client",
    });
  }
  headers.set("Sec-WebSocket-Protocol", protocol);
  return headers;
}

export class BunServerAdapter implements ServerAdapter {
  upgradeWebSocket(
    request: Request,
    options?: WebSocketUpgradeOptions,
  ): WebSocketUpgrade {
    const server = bunServerByRequest.get(request);
    if (!server) {
      throw NOT_SUPPORTED.create({
        message: "Bun WebSocket upgrades require an active server request",
      });
    }

    if (options?.idleTimeout !== undefined && options.idleTimeout !== 0) {
      throw NOT_SUPPORTED.create({
        message: "Bun does not support per-connection WebSocket idle timeouts",
      });
    }

    const socket = new BunWebSocket();
    const headers = resolveUpgradeHeaders(request, options);
    if (!server.upgrade(request, { data: socket, headers })) {
      throw NETWORK_ERROR.create({ message: "Unable to upgrade the WebSocket connection" });
    }

    return {
      socket,
      response: createWebSocketUpgradeResponse({ headers }),
    };
  }
}

function createCloseEvent(code: number, reason: string): CloseEvent {
  return Object.assign(new Event("close"), {
    code,
    reason,
    wasClean: code !== 1006,
  }) as CloseEvent;
}

function createErrorEvent(error: Error): Event {
  return Object.assign(new Event("error"), { error });
}

export class BunWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  private readonly events = new EventTarget();
  private socket: BunServerWebSocket | null = null;
  private pendingMessages: Array<string | ArrayBuffer> = [];
  private pendingClose: { code?: number; reason?: string } | null = null;
  readyState = BunWebSocket.CONNECTING;

  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  _attachRealSocket(socket: BunServerWebSocket): void {
    if (this.socket || this.readyState === BunWebSocket.CLOSED) {
      socket.close(1008, "WebSocket is no longer available");
      return;
    }

    this.socket = socket;
    if (this.pendingClose) {
      this.readyState = BunWebSocket.CLOSING;
      socket.close(this.pendingClose.code, this.pendingClose.reason);
      this.pendingMessages = [];
      return;
    }

    this.readyState = BunWebSocket.OPEN;
    for (const message of this.pendingMessages) socket.send(message);
    this.pendingMessages = [];
    this.dispatch("open", new Event("open"));
  }

  _handleMessage(data: string | ArrayBuffer | Uint8Array): void {
    if (this.readyState !== BunWebSocket.OPEN) return;
    const eventData = data instanceof Uint8Array
      ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      : data;
    this.dispatch("message", new MessageEvent("message", { data: eventData }));
  }

  _handleClose(code = 1006, reason = ""): void {
    if (this.readyState === BunWebSocket.CLOSED) return;
    this.readyState = BunWebSocket.CLOSED;
    this.socket = null;
    this.pendingMessages = [];
    this.dispatch("close", createCloseEvent(code, reason));
  }

  _handleError(error: Error): void {
    this.dispatch("error", createErrorEvent(error));
  }

  send(data: string | ArrayBuffer): void {
    if (this.socket && this.readyState === BunWebSocket.OPEN) {
      this.socket.send(data);
      return;
    }
    if (this.readyState === BunWebSocket.CONNECTING) {
      if (this.pendingMessages.length >= MAX_PENDING_MESSAGES) {
        throw NETWORK_ERROR.create({ message: "WebSocket pending message limit exceeded" });
      }
      this.pendingMessages.push(data);
      return;
    }
    throw NETWORK_ERROR.create({ message: "WebSocket is not open" });
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === BunWebSocket.CLOSED || this.readyState === BunWebSocket.CLOSING) return;
    this.readyState = BunWebSocket.CLOSING;
    if (this.socket) this.socket.close(code, reason);
    else this.pendingClose = { code, reason };
  }

  addEventListener(
    type: string,
    listener: EventListener,
    options?: AddEventListenerOptions,
  ): void {
    this.events.addEventListener(type, listener, options);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.events.removeEventListener(type, listener);
  }

  private dispatch(type: "open" | "close" | "error" | "message", event: Event): void {
    const propertyHandler = this[`on${type}`] as ((event: Event) => void) | null;
    propertyHandler?.(event);
    this.events.dispatchEvent(event);
  }
}
