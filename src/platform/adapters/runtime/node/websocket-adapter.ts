import type { ServerAdapter, WebSocketUpgrade } from "../../base.ts";
import type { WSMessageData, WSWebSocket } from "./types.ts";
import { createError, toError } from "#veryfront/errors";
import { serverLogger } from "#veryfront/utils";
import { registerWebSocketUpgrade } from "./http-server.ts";
import * as crypto from "node:crypto";

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

    const protocol = request.headers.get("sec-websocket-protocol");
    const socket = new NodeWebSocket();

    void (async () => {
      try {
        const ws = await registerWebSocketUpgrade(key);
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

    // Node.js (undici) doesn't allow status 101 in Response constructor.
    // Create a minimal signal object — only checked for status === 101 upstream.
    const response = {
      status: 101,
      statusText: "Switching Protocols",
      headers: new Headers(headers),
      body: null,
      ok: false,
    } as unknown as Response;

    return { socket: socket as unknown as WebSocket, response };
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

  _attachRealSocket(ws: WSWebSocket): void {
    this.ws = ws;
    this.readyState = 1; // OPEN

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

    for (const msg of this.pendingMessages) ws.send(msg);
    this.pendingMessages = [];

    this.onopen?.(new Event("open"));
  }

  _emitError(error: Error): void {
    this.readyState = 3; // CLOSED
    this.onerror?.(new ErrorEvent("error", { error }));
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
    this.ws?.close(code, reason);
    this.readyState = 2; // CLOSING
  }

  addEventListener(type: string, listener: EventListener): void {
    switch (type) {
      case "open":
        this.onopen = listener as (event: Event) => void;
        return;
      case "close":
        this.onclose = listener as (event: CloseEvent) => void;
        return;
      case "error":
        this.onerror = listener as (event: Event) => void;
        return;
      case "message":
        this.onmessage = listener as (event: MessageEvent) => void;
        return;
    }
  }

  removeEventListener(type: string, _listener: EventListener): void {
    switch (type) {
      case "open":
        this.onopen = null;
        return;
      case "close":
        this.onclose = null;
        return;
      case "error":
        this.onerror = null;
        return;
      case "message":
        this.onmessage = null;
        return;
    }
  }
}
