import {
  createWebSocketUpgradeResponse,
  type ServerAdapter,
  type WebSocketUpgrade,
  type WebSocketUpgradeOptions,
} from "../../base.ts";
import { DeferredWebSocket } from "../shared/deferred-websocket.ts";
import { resolvePortableWebSocketUpgradeHeaders } from "../../../compat/http/websocket-upgrade-options.ts";
import type { WSMessageData, WSWebSocket } from "./types.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors/error-registry/general.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { NODE_WEBSOCKET_UPGRADE_ID_HEADER, registerWebSocketUpgrade } from "./http-server.ts";
import * as crypto from "node:crypto";

const WEBSOCKET_KEY_PATTERN = /^[+/0-9A-Za-z]{22}==$/;

function decodeMessageBytes(data: WSMessageData): Uint8Array<ArrayBuffer> {
  const chunks = Array.isArray(data) ? data : [data];
  let byteLength = 0;
  for (const chunk of chunks) {
    byteLength += chunk.byteLength;
  }

  const bytes = new Uint8Array(new ArrayBuffer(byteLength));
  let offset = 0;
  for (const chunk of chunks) {
    const view = chunk instanceof ArrayBuffer
      ? new Uint8Array(chunk)
      : new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    bytes.set(view, offset);
    offset += view.byteLength;
  }
  return bytes;
}

function normalizeMessageData(
  data: WSMessageData,
  isBinary: boolean,
): string | ArrayBuffer {
  const bytes = decodeMessageBytes(data);
  return isBinary ? bytes.buffer : new TextDecoder().decode(bytes);
}

export function resolveNodeWebSocketUpgradeHeaders(
  request: Request,
  options: WebSocketUpgradeOptions = {},
): Headers {
  const headers = resolvePortableWebSocketUpgradeHeaders(request, options, {
    platform: "node",
    runtimeName: "Node",
    unsupportedIdleTimeoutDetail:
      "Node ws does not support a per-connection transport idle timeout; use application-level heartbeats",
  });

  const connectionTokens = request.headers.get("connection")
    ?.split(",")
    .map((value) => value.trim().toLowerCase()) ?? [];
  if (!connectionTokens.includes("upgrade")) {
    throw INVALID_ARGUMENT.create({
      detail: "Node WebSocket upgrade requires a Connection: Upgrade request",
      context: { platform: "node", operation: "upgradeWebSocket" },
    });
  }

  const key = request.headers.get("sec-websocket-key");
  if (!key || !WEBSOCKET_KEY_PATTERN.test(key)) {
    throw INVALID_ARGUMENT.create({
      detail: "Missing or invalid Sec-WebSocket-Key header",
      context: { platform: "node", operation: "upgradeWebSocket" },
    });
  }

  const version = request.headers.get("sec-websocket-version");
  if (version !== "13" && version !== "8") {
    throw INVALID_ARGUMENT.create({
      detail: "Missing or invalid Sec-WebSocket-Version header",
      context: { platform: "node", operation: "upgradeWebSocket" },
    });
  }

  headers.set("Upgrade", "websocket");
  headers.set("Connection", "Upgrade");
  headers.set(
    "Sec-WebSocket-Accept",
    crypto.createHash("sha1")
      .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
      .digest("base64"),
  );
  return headers;
}

export class NodeServerAdapter implements ServerAdapter {
  private readonly upgradedRequests = new WeakSet<Request>();

  upgradeWebSocket(
    request: Request,
    options?: WebSocketUpgradeOptions,
  ): WebSocketUpgrade {
    const headers = resolveNodeWebSocketUpgradeHeaders(request, options);
    if (this.upgradedRequests.has(request)) {
      throw INVALID_ARGUMENT.create({
        detail: "Node Request has already been upgraded",
        context: { platform: "node", operation: "upgradeWebSocket" },
      });
    }

    const key = request.headers.get("sec-websocket-key")!;
    const requestId = request.headers.get(NODE_WEBSOCKET_UPGRADE_ID_HEADER) ?? key;
    const socket = new NodeWebSocket();
    this.upgradedRequests.add(request);

    void (async () => {
      try {
        const ws = await registerWebSocketUpgrade(requestId);
        socket._attachRealSocket(ws);
      } catch (error) {
        serverLogger.error("WebSocket upgrade failed:", error);
        socket._emitError(error instanceof Error ? error : new Error(String(error)));
      }
    })();

    return {
      socket,
      response: createWebSocketUpgradeResponse({ headers }),
    };
  }
}

export class NodeWebSocket extends DeferredWebSocket {
  constructor() {
    super("Node");
  }

  _attachRealSocket(ws: WSWebSocket): void {
    ws.on("message", (data: WSMessageData, isBinary: boolean) => {
      this.emitMessage(normalizeMessageData(data, isBinary));
    });
    ws.on("close", (code?: number, reason?: ArrayBufferView | string) => {
      this.emitClose(
        typeof code === "number" ? code : 1006,
        typeof reason === "string" ? reason : reason
          ? new TextDecoder().decode(
            new Uint8Array(reason.buffer, reason.byteOffset, reason.byteLength),
          )
          : "",
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
