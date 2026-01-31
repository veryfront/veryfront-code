import type { ServerAdapter, WebSocketUpgrade } from "../../base.ts";
import { createError, toError } from "#veryfront/errors";

export class BunServerAdapter implements ServerAdapter {
  upgradeWebSocket(request: Request): WebSocketUpgrade {
    if (!Bun.upgrade(request)) {
      throw toError(
        createError({
          type: "network",
          message: "Failed to upgrade WebSocket connection",
        }),
      );
    }

    const socket = new BunWebSocket();
    const response = new Response(null, { status: 101, statusText: "Switching Protocols" });

    return { socket: socket as unknown as WebSocket, response };
  }
}

export class BunWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = BunWebSocket.OPEN;

  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  send(_data: string | ArrayBuffer): void {
    throw toError(
      createError({
        type: "network",
        message: "WebSocket send called on placeholder - use Bun.serve websocket handlers",
      }),
    );
  }

  close(_code?: number, _reason?: string): void {
    this.readyState = BunWebSocket.CLOSED;
  }
}
