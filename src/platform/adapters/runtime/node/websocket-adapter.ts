import type { ServerAdapter, WebSocketUpgrade } from "../../base.ts";
import type { WSMessageData, WSWebSocket } from "./types.ts";
import { createError, toError } from "#veryfront/errors";
import { serverLogger } from "#veryfront/utils";
import { registerWebSocketUpgrade } from "./http-server.ts";
import * as crypto from "node:crypto";

export class NodeServerAdapter implements ServerAdapter {
  upgradeWebSocket(request: Request): WebSocketUpgrade {
    const key = request.headers.get("sec-websocket-key");
    const protocol = request.headers.get("sec-websocket-protocol");

    if (!key) {
      throw toError(createError({
        type: "network",
        message: "Missing Sec-WebSocket-Key header",
      }));
    }

    // Create a proxy WebSocket that will be connected when the upgrade completes
    const socket = new NodeWebSocket();

    // Register the upgrade and connect when complete
    registerWebSocketUpgrade(key).then((ws) => {
      socket._attachRealSocket(ws);
    }).catch((error) => {
      serverLogger.error("WebSocket upgrade failed:", error);
      socket._emitError(error);
    });

    // Return 101 response - the http-server upgrade handler will complete the handshake
    const response = new Response(null, {
      status: 101,
      statusText: "Switching Protocols",
      headers: {
        "Upgrade": "websocket",
        "Connection": "Upgrade",
        "Sec-WebSocket-Accept": this.generateAcceptKey(key),
        ...(protocol ? { "Sec-WebSocket-Protocol": protocol } : {}),
      },
    });

    return { socket: socket as unknown as WebSocket, response };
  }

  private generateAcceptKey(key: string): string {
    const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    return crypto.createHash("sha1").update(key + GUID).digest("base64");
  }
}

/**
 * NodeWebSocket - A WebSocket wrapper that works with Node.js
 * Proxies to the real ws WebSocket once the upgrade completes
 */
export class NodeWebSocket {
  private ws: WSWebSocket | null = null;
  public readyState = 0; // CONNECTING

  public onopen: ((event: Event) => void) | null = null;
  public onclose: ((event: CloseEvent) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;

  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  // Queue messages sent before the socket is ready
  private pendingMessages: Array<string | ArrayBuffer> = [];

  /**
   * Attach the real WebSocket after upgrade completes
   * Called by NodeServerAdapter
   */
  _attachRealSocket(ws: WSWebSocket) {
    this.ws = ws;
    this.readyState = 1; // OPEN

    // Set up event handlers
    ws.on("open", () => {
      this.readyState = 1;
      this.onopen?.(new Event("open"));
    });

    ws.on("message", (data: WSMessageData) => {
      this.onmessage?.(new MessageEvent("message", { data: data.toString() }));
    });

    ws.on("close", () => {
      this.readyState = 3;
      this.onclose?.(new CloseEvent("close"));
    });

    ws.on("error", (error: Error) => {
      this.onerror?.(new ErrorEvent("error", { error }));
    });

    // Send any pending messages
    for (const msg of this.pendingMessages) {
      ws.send(msg);
    }
    this.pendingMessages = [];

    // The socket is already open when we get it from handleUpgrade
    this.onopen?.(new Event("open"));
  }

  /**
   * Emit an error when upgrade fails
   * Called by NodeServerAdapter
   */
  _emitError(error: Error) {
    this.readyState = 3; // CLOSED
    this.onerror?.(new ErrorEvent("error", { error }));
  }

  send(data: string | ArrayBuffer) {
    if (this.ws && this.readyState === 1) {
      this.ws.send(data);
    } else if (this.readyState === 0) {
      // Queue the message until the socket is ready
      this.pendingMessages.push(data);
    } else {
      throw toError(createError({
        type: "network",
        message: "WebSocket is not open",
      }));
    }
  }

  close(code?: number, reason?: string) {
    if (this.ws) {
      this.ws.close(code, reason);
    }
    this.readyState = 2; // CLOSING
  }

  // WebSocket standard interface
  addEventListener(type: string, listener: EventListener) {
    switch (type) {
      case "open":
        this.onopen = listener as (event: Event) => void;
        break;
      case "close":
        this.onclose = listener as (event: CloseEvent) => void;
        break;
      case "error":
        this.onerror = listener as (event: Event) => void;
        break;
      case "message":
        this.onmessage = listener as (event: MessageEvent) => void;
        break;
    }
  }

  removeEventListener(_type: string, _listener: EventListener) {
    // Simplified - just null out the handler
    switch (_type) {
      case "open":
        this.onopen = null;
        break;
      case "close":
        this.onclose = null;
        break;
      case "error":
        this.onerror = null;
        break;
      case "message":
        this.onmessage = null;
        break;
    }
  }
}
