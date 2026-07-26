import {
  createWebSocketUpgradeResponse,
  type ServerAdapter,
  type WebSocketUpgrade,
} from "../../base.ts";
import { DeferredWebSocket } from "../shared/deferred-websocket.ts";
import type { WSMessageData, WSWebSocket } from "./types.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors/error-registry/general.ts";
import { serverLogger } from "#veryfront/utils";
import { NODE_WEBSOCKET_UPGRADE_ID_HEADER, registerWebSocketUpgrade } from "./http-server.ts";
import * as crypto from "node:crypto";
import type { Buffer } from "node:buffer";

export class NodeServerAdapter implements ServerAdapter {
  upgradeWebSocket(request: Request): WebSocketUpgrade {
    const key = request.headers.get("sec-websocket-key");
    if (!key) {
      throw INVALID_ARGUMENT.create({
        detail: "Missing Sec-WebSocket-Key header",
        context: { platform: "node", operation: "upgradeWebSocket" },
      });
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

    return {
      socket,
      response: createWebSocketUpgradeResponse({ headers }),
    };
  }

  private generateAcceptKey(key: string): string {
    const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    return crypto.createHash("sha1").update(key + GUID).digest("base64");
  }
}

export class NodeWebSocket extends DeferredWebSocket {
  constructor() {
    super("Node");
  }

  _attachRealSocket(ws: WSWebSocket): void {
    ws.on("message", (data: WSMessageData) => {
      this.emitMessage(data.toString());
    });
    ws.on("close", (code?: number, reason?: Buffer | string) => {
      this.emitClose(
        typeof code === "number" ? code : 1006,
        typeof reason === "string" ? reason : reason?.toString() ?? "",
      );
    });
    ws.on("error", (error: Error) => {
      this.emitTransportError(error);
    });

    this.attachTransport(ws);
  }

  _emitError(error: Error): void {
    this.fail(error);
  }
}
