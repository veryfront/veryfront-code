import type { ServerAdapter, WebSocketUpgrade } from "../base.ts";
import type { WSMessageData, WSWebSocket } from "./types.ts";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";
import { serverLogger } from "@veryfront/utils";

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

    const socket = new NodeWebSocket();
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
    const crypto = require("node:crypto");
    const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    return crypto.createHash("sha1").update(key + GUID).digest("base64");
  }
}

export class NodeWebSocket {
  private ws: WSWebSocket | null = null;
  public readyState = 0;

  public onopen: ((event: Event) => void) | null = null;
  public onclose: ((event: Event) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;

  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  async _connect(url: string) {
    try {
      const { WebSocket: WS } = await import("ws");
      this.ws = new WS(url) as unknown as WSWebSocket;

      this.ws.on("open", () => {
        this.readyState = 1;
        this.onopen?.(new Event("open"));
      });

      this.ws.on("message", (data: WSMessageData) => {
        this.onmessage?.(new MessageEvent("message", { data: data.toString() }));
      });

      this.ws.on("close", () => {
        this.readyState = 3;
        this.onclose?.(new Event("close"));
      });

      this.ws.on("error", (error: Error) => {
        this.onerror?.(new ErrorEvent("error", { error }));
      });
    } catch (error) {
      this.readyState = 3;
      const wsError = error instanceof Error
        ? error
        : new Error('WebSocket not available in Node.js. Install "ws" package.');
      serverLogger.error("Failed to initialize WebSocket:", wsError);
      this.onerror?.(new ErrorEvent("error", { error: wsError }));
    }
  }

  send(data: string | ArrayBuffer) {
    if (this.readyState !== 1) {
      throw toError(createError({
        type: "network",
        message: "WebSocket is not open",
      }));
    }
    this.ws?.send(data);
  }

  close(code?: number, reason?: string) {
    this.ws?.close(code, reason);
    this.readyState = 2;
  }
}
