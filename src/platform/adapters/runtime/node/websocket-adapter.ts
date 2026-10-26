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
import { registerWebSocketUpgrade } from "./http-server.ts";
import {
  consumeNodeWebSocketUpgradeRequest,
  readWebSocketBufferedAmount,
  recordWebSocketUpgradeIdleTimeout,
} from "../shared/http-upgrade-provenance.ts";
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
  denoPolicy = false,
): Headers {
  const headers = resolvePortableWebSocketUpgradeHeaders(request, options, {
    platform: "node",
    runtimeName: denoPolicy ? "Deno" : "Node",
    supportsNonzeroIdleTimeout: denoPolicy,
    supportsResponseHeaders: !denoPolicy,
    unsupportedResponseHeadersDetail: "Deno does not support custom WebSocket response headers",
    unsupportedIdleTimeoutDetail:
      "The Node WebSocket provider contract does not support a per-connection transport idle timeout; use application-level heartbeats",
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
  constructor(private readonly denoPolicy = false) {}
  private readonly upgradedRequests = new WeakSet<Request>();

  upgradeWebSocket(
    request: Request,
    options?: WebSocketUpgradeOptions,
  ): WebSocketUpgrade {
    const headers = resolveNodeWebSocketUpgradeHeaders(request, options, this.denoPolicy);
    if (this.upgradedRequests.has(request)) {
      throw INVALID_ARGUMENT.create({
        detail: "Node Request has already been upgraded",
        context: { platform: "node", operation: "upgradeWebSocket" },
      });
    }

    const requestId = consumeNodeWebSocketUpgradeRequest(request);
    const idleTimeout = options?.idleTimeout ?? (this.denoPolicy ? 30 : 0);
    const socket = new NodeWebSocket(idleTimeout);
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

    const response = createWebSocketUpgradeResponse({ headers });
    recordWebSocketUpgradeIdleTimeout(response, idleTimeout);
    return { socket, response };
  }
}

export class NodeWebSocket extends DeferredWebSocket {
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private timedOut = false;
  private realSocket?: WSWebSocket;

  _getBufferedAmount(): number {
    return this.realSocket ? readWebSocketBufferedAmount(this.realSocket) : 0;
  }

  constructor(private readonly idleTimeout = 0) {
    super("Node");
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  override close(code?: number, reason?: string): void {
    this.clearIdleTimer();
    super.close(code, reason);
  }

  _attachRealSocket(ws: WSWebSocket): void {
    this.realSocket = ws;
    if (
      this.idleTimeout > 0 && (typeof ws.ping !== "function" || typeof ws.terminate !== "function")
    ) {
      ws.terminate?.();
      this.fail(
        new Error("WebSocket provider does not support idle timeout heartbeat and termination"),
      );
      return;
    }
    const resetIdleTimer = (): void => {
      this.clearIdleTimer();
      if (this.idleTimeout === 0 || this.readyState !== DeferredWebSocket.OPEN) return;
      this.idleTimer = setTimeout(() => {
        if (this.readyState !== DeferredWebSocket.OPEN) return;
        try {
          ws.ping!();
        } catch (error) {
          this.clearIdleTimer();
          this.fail(error);
          return;
        }
        this.idleTimer = setTimeout(() => {
          if (this.readyState !== DeferredWebSocket.OPEN) return;
          this.timedOut = true;
          const reason = "No response from ping frame.";
          this.readyState = DeferredWebSocket.CLOSING;
          try {
            ws.close(1001, reason);
          } catch {
            // An already-broken transport still receives the same terminal events.
          } finally {
            this.emitTransportError(new Error(reason));
            this.emitClose(1001, reason, false);
            try {
              ws.terminate!();
            } catch { /* Transport is already terminal. */ }
            this.clearIdleTimer();
          }
        }, this.idleTimeout * 500);
      }, this.idleTimeout * 500);
    };
    if (this.idleTimeout > 0) {
      // Only a provider declaring heartbeat support promises this event overload.
      const heartbeat = ws as WSWebSocket & {
        on(event: "pong", listener: () => void): WSWebSocket;
      };
      heartbeat.on("pong", resetIdleTimer);
    }
    ws.on("message", (data: WSMessageData, isBinary: boolean) => {
      resetIdleTimer();
      this.emitMessage(normalizeMessageData(data, isBinary));
    });
    ws.on("close", (code?: number, reason?: ArrayBufferView | string) => {
      this.clearIdleTimer();
      if (this.timedOut) return;
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
      this.clearIdleTimer();
      this.emitTransportError(error);
    });

    this.attachTransport(ws);
    resetIdleTimer();
  }

  _emitError(error: Error): void {
    this.clearIdleTimer();
    this.fail(error);
  }
}
