import {
  createWebSocketUpgradeResponse,
  type ServerAdapter,
  type WebSocketUpgrade,
} from "../../base.ts";
import type { WSMessageData, WSWebSocket } from "./types.ts";
import { createError, toError } from "#veryfront/errors";
import { serverLogger } from "#veryfront/utils";
import { NODE_WEBSOCKET_UPGRADE_ID_HEADER, registerWebSocketUpgrade } from "./http-server.ts";
import * as crypto from "node:crypto";
import { Buffer } from "node:buffer";

/**
 * Build a structurally-compatible `CloseEvent` without relying on the
 * `CloseEvent` constructor, which is not exposed as a global in Node.js
 * before 23.0.0 (the framework supports Node 18+). Uses a plain `Event`
 * decorated with the standard `code`/`reason`/`wasClean` fields.
 *
 * `wasClean` follows the `ws` library convention: any code other than
 * `1006` (abnormal closure — no close frame received) is considered
 * clean, because a received close frame implies the closing handshake
 * completed. Code `1006` is what `ws` substitutes when the peer
 * disappears without sending a close frame.
 */
function createCloseEvent(
  code?: number,
  reason?: Buffer | string,
): CloseEvent {
  const resolvedCode = typeof code === "number" ? code : 1006;
  const resolvedReason = typeof reason === "string" ? reason : reason?.toString() ?? "";
  return Object.assign(new Event("close"), {
    code: resolvedCode,
    reason: resolvedReason,
    wasClean: resolvedCode !== 1006,
  }) as CloseEvent;
}

function createErrorEvent(error: Error): ErrorEvent {
  return Object.assign(new Event("error"), {
    error,
    message: error.message,
    filename: "",
    lineno: 0,
    colno: 0,
  }) as ErrorEvent;
}

export class NodeServerAdapter implements ServerAdapter {
  upgradeWebSocket(request: Request): WebSocketUpgrade {
    const key = request.headers.get("sec-websocket-key");
    if (!key) {
      throw toError(
        createError({
          type: "network",
          message: "Missing Sec-WebSocket-Key header",
        }),
      );
    }

    const requestId = request.headers.get(NODE_WEBSOCKET_UPGRADE_ID_HEADER) ?? key;
    const protocol = request.headers.get("sec-websocket-protocol");
    const socket = new NodeWebSocket();

    void (async () => {
      try {
        const ws = await registerWebSocketUpgrade(requestId);
        socket._attachRealSocket(ws);
      } catch (error) {
        serverLogger.error("WebSocket upgrade failed:", error);
        socket._emitError(error instanceof Error ? error : new Error(String(error)));
      }
    })();

    const headers: Record<string, string> = {
      Upgrade: "websocket",
      Connection: "Upgrade",
      "Sec-WebSocket-Accept": this.generateAcceptKey(key),
      ...(protocol ? { "Sec-WebSocket-Protocol": protocol } : {}),
    };

    const response = createWebSocketUpgradeResponse({ headers });

    return { socket, response };
  }

  private generateAcceptKey(key: string): string {
    const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    return crypto.createHash("sha1").update(key + GUID).digest("base64");
  }
}

export class NodeWebSocket {
  private ws: WSWebSocket | null = null;
  readyState = 0; // CONNECTING

  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  private pendingMessages: Array<string | ArrayBuffer> = [];
  private pendingClose: { code?: number; reason?: string } | null = null;
  private openDispatched = false;
  private closeDispatched = false;
  private listeners = new Map<
    string,
    Map<EventListener, {
      once: boolean;
      signal?: AbortSignal;
      abortListener?: () => void;
    }>
  >();

  _attachRealSocket(ws: WSWebSocket): void {
    if (this.readyState === NodeWebSocket.CLOSED) {
      if (ws.terminate) ws.terminate();
      else ws.close();
      return;
    }

    this.ws = ws;

    ws.on("open", () => {
      this.dispatchOpen();
    });

    ws.on("message", (data: WSMessageData) => {
      if (this.readyState !== NodeWebSocket.OPEN) return;
      this.dispatch("message", new MessageEvent("message", { data: data.toString() }));
    });

    ws.on("close", (code?: number, reason?: Buffer | string) => {
      this.finishClose(createCloseEvent(code, reason));
    });

    ws.on("error", (error: Error) => {
      this.dispatch("error", createErrorEvent(error));
    });

    if (this.pendingClose) {
      const pendingClose = this.pendingClose;
      this.pendingClose = null;
      this.pendingMessages = [];
      this.readyState = NodeWebSocket.CLOSING;
      ws.close(pendingClose.code, pendingClose.reason);
      return;
    }

    this.readyState = NodeWebSocket.OPEN;

    const pendingMessages = this.pendingMessages;
    this.pendingMessages = [];
    try {
      for (const msg of pendingMessages) ws.send(msg);
    } catch (error) {
      this.dispatch(
        "error",
        createErrorEvent(error instanceof Error ? error : new Error(String(error))),
      );
      this.close();
      return;
    }

    this.dispatchOpen();
  }

  _emitError(error: Error): void {
    if (this.readyState === NodeWebSocket.CLOSED) return;
    this.pendingMessages = [];
    this.pendingClose = null;
    this.dispatch("error", createErrorEvent(error));
    this.finishClose(createCloseEvent(1006, ""));
  }

  send(data: string | ArrayBuffer): void {
    if (this.ws && this.readyState === 1) {
      this.ws.send(data);
      return;
    }

    if (this.readyState === 0) {
      this.pendingMessages.push(data);
      return;
    }

    throw toError(
      createError({
        type: "network",
        message: "WebSocket is not open",
      }),
    );
  }

  close(code?: number, reason?: string): void {
    if (
      this.readyState === NodeWebSocket.CLOSING ||
      this.readyState === NodeWebSocket.CLOSED
    ) return;

    this.readyState = NodeWebSocket.CLOSING;
    this.pendingMessages = [];
    if (!this.ws) {
      this.pendingClose = { code, reason };
      return;
    }
    this.ws.close(code, reason);
  }

  addEventListener(
    type: string,
    listener: EventListener,
    options: AddEventListenerOptions = {},
  ): void {
    if (options.signal?.aborted) return;

    let typeListeners = this.listeners.get(type);
    if (!typeListeners) {
      typeListeners = new Map();
      this.listeners.set(type, typeListeners);
    }
    // EventTarget ignores duplicate registrations with the same type and
    // callback. This also prevents duplicate abort listeners.
    if (typeListeners.has(listener)) return;

    const registration: {
      once: boolean;
      signal?: AbortSignal;
      abortListener?: () => void;
    } = {
      once: options.once === true,
      signal: options.signal,
    };
    if (options.signal) {
      registration.abortListener = () => this.removeEventListener(type, listener);
      options.signal.addEventListener("abort", registration.abortListener, { once: true });
    }
    typeListeners.set(listener, registration);
  }

  removeEventListener(type: string, listener: EventListener): void {
    const typeListeners = this.listeners.get(type);
    const registration = typeListeners?.get(listener);
    if (!typeListeners || !registration) return;
    typeListeners.delete(listener);
    if (typeListeners.size === 0) this.listeners.delete(type);
    if (registration.signal && registration.abortListener) {
      registration.signal.removeEventListener("abort", registration.abortListener);
    }
  }

  private dispatchOpen(): void {
    if (this.openDispatched || this.readyState !== NodeWebSocket.OPEN) return;
    this.openDispatched = true;
    this.dispatch("open", new Event("open"));
  }

  private finishClose(event: CloseEvent): void {
    if (this.closeDispatched) return;
    this.closeDispatched = true;
    this.readyState = NodeWebSocket.CLOSED;
    this.pendingMessages = [];
    this.pendingClose = null;
    this.dispatch("close", event);
  }

  private dispatch(type: string, event: Event): void {
    try {
      switch (type) {
        case "open":
          this.onopen?.(event);
          break;
        case "close":
          this.onclose?.(event as CloseEvent);
          break;
        case "error":
          this.onerror?.(event);
          break;
        case "message":
          this.onmessage?.(event as MessageEvent);
          break;
      }
    } catch (error) {
      serverLogger.error("Node WebSocket event handler failed", { type, error });
    }

    const typeListeners = this.listeners.get(type);
    if (!typeListeners) return;
    for (const [listener, registration] of [...typeListeners]) {
      if (registration.once) this.removeEventListener(type, listener);
      try {
        listener(event);
      } catch (error) {
        serverLogger.error("Node WebSocket event listener failed", { type, error });
      }
    }
  }
}
