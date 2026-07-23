import {
  createWebSocketUpgradeResponse,
  type ServerAdapter,
  type WebSocketUpgrade,
  type WebSocketUpgradeOptions,
} from "../../base.ts";
import type { WSMessageData, WSWebSocket } from "./types.ts";
import { INVALID_ARGUMENT, NOT_SUPPORTED } from "#veryfront/errors/error-registry/general.ts";
import { NETWORK_ERROR } from "#veryfront/errors/error-registry/server.ts";
import * as crypto from "node:crypto";
import { Buffer } from "node:buffer";

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_PENDING_MESSAGES = 100;
const RESERVED_HANDSHAKE_HEADERS = new Set([
  "connection",
  "sec-websocket-accept",
  "sec-websocket-protocol",
  "upgrade",
]);

export interface RegisteredNodeWebSocketUpgrade {
  readonly result: WebSocketUpgrade;
  readonly socket: NodeWebSocket;
  readonly protocol?: string;
  readonly headers: Headers;
}

interface NodeWebSocketRequestContext {
  upgrade?: RegisteredNodeWebSocketUpgrade;
  onUpgrade?: (upgrade: RegisteredNodeWebSocketUpgrade) => void;
}

export interface NodeWebSocketRequestExecution<T> {
  value: T;
  upgrade?: RegisteredNodeWebSocketUpgrade;
}

const contextByRequest = new WeakMap<Request, NodeWebSocketRequestContext>();

export async function runWithNodeWebSocketRequest<T>(
  request: Request,
  operation: () => Promise<T> | T,
  onUpgrade?: (upgrade: RegisteredNodeWebSocketUpgrade) => void,
): Promise<NodeWebSocketRequestExecution<T>> {
  if (contextByRequest.has(request)) {
    throw INVALID_ARGUMENT.create({
      message: "The Node WebSocket request context is already active",
    });
  }

  const context: NodeWebSocketRequestContext = { onUpgrade };
  contextByRequest.set(request, context);
  try {
    return { value: await operation(), upgrade: context.upgrade };
  } finally {
    contextByRequest.delete(request);
  }
}

function parseRequestedProtocols(request: Request): string[] {
  return (request.headers.get("sec-websocket-protocol") ?? "")
    .split(",")
    .map((protocol) => protocol.trim())
    .filter(Boolean);
}

function validateUpgradeRequest(request: Request): string {
  const connectionTokens = (request.headers.get("connection") ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase());
  const key = request.headers.get("sec-websocket-key") ?? "";
  const validKey = /^[A-Za-z0-9+/]{22}==$/.test(key) && Buffer.from(key, "base64").length === 16;

  if (
    request.method !== "GET" || request.headers.get("upgrade")?.toLowerCase() !== "websocket" ||
    !connectionTokens.includes("upgrade") ||
    request.headers.get("sec-websocket-version") !== "13" ||
    !validKey
  ) {
    throw INVALID_ARGUMENT.create({ message: "Invalid WebSocket upgrade request" });
  }
  return key;
}

function resolveProtocol(
  request: Request,
  options: WebSocketUpgradeOptions | undefined,
): string | undefined {
  const protocol = options?.protocol;
  if (!protocol) return undefined;
  if (!parseRequestedProtocols(request).includes(protocol)) {
    throw INVALID_ARGUMENT.create({
      message: "The selected WebSocket protocol was not requested by the client",
    });
  }
  return protocol;
}

function resolveCustomHeaders(options: WebSocketUpgradeOptions | undefined): Headers {
  const headers = new Headers(options?.headers);
  for (const name of RESERVED_HANDSHAKE_HEADERS) headers.delete(name);
  return headers;
}

export class NodeServerAdapter implements ServerAdapter {
  upgradeWebSocket(
    request: Request,
    options?: WebSocketUpgradeOptions,
  ): WebSocketUpgrade {
    const context = contextByRequest.get(request);
    if (!context) {
      throw NOT_SUPPORTED.create({
        message: "Node WebSocket upgrades require an active server request",
      });
    }
    if (context.upgrade) {
      throw INVALID_ARGUMENT.create({
        message: "The request already registered a WebSocket upgrade",
      });
    }
    if (options?.idleTimeout !== undefined && options.idleTimeout !== 0) {
      throw NOT_SUPPORTED.create({
        message: "Node does not support per-connection WebSocket idle timeouts",
      });
    }

    const key = validateUpgradeRequest(request);
    const protocol = resolveProtocol(request, options);
    const customHeaders = resolveCustomHeaders(options);
    const responseHeaders = new Headers(customHeaders);
    responseHeaders.set("Connection", "Upgrade");
    responseHeaders.set(
      "Sec-WebSocket-Accept",
      crypto.createHash("sha1").update(key + WEBSOCKET_GUID).digest("base64"),
    );
    if (protocol) responseHeaders.set("Sec-WebSocket-Protocol", protocol);
    responseHeaders.set("Upgrade", "websocket");

    const socket = new NodeWebSocket();
    const result: WebSocketUpgrade = {
      socket,
      response: createWebSocketUpgradeResponse({ headers: responseHeaders }),
    };
    const upgrade: RegisteredNodeWebSocketUpgrade = {
      result,
      socket,
      protocol,
      headers: customHeaders,
    };
    context.upgrade = upgrade;
    context.onUpgrade?.(upgrade);
    return result;
  }
}

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

function validateClose(code?: number, reason = ""): void {
  if (code !== undefined && code !== 1000 && (code < 3000 || code > 4999)) {
    throw INVALID_ARGUMENT.create({ message: "Invalid WebSocket close code" });
  }
  if (new TextEncoder().encode(reason).byteLength > 123) {
    throw INVALID_ARGUMENT.create({ message: "WebSocket close reason exceeds 123 bytes" });
  }
}

function concatenateBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function toBytes(data: WSMessageData): Uint8Array {
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (!(data instanceof Uint8Array)) return concatenateBytes(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function toMessageData(data: WSMessageData, isBinary: boolean): string | ArrayBuffer {
  if (!isBinary) {
    return typeof data === "string" ? data : new TextDecoder().decode(toBytes(data));
  }
  const bytes = toBytes(data);
  return bytes.slice().buffer;
}

export class NodeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  private readonly events = new EventTarget();
  private ws: WSWebSocket | null = null;
  private pendingMessages: Array<string | ArrayBuffer> = [];
  private pendingClose: { code?: number; reason?: string } | null = null;
  readyState = NodeWebSocket.CONNECTING;

  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  _attachRealSocket(ws: WSWebSocket): void {
    if (this.ws || this.readyState === NodeWebSocket.CLOSED) {
      ws.terminate();
      return;
    }

    this.ws = ws;
    ws.on("open", () => this.handleOpen());
    ws.on("message", (data, isBinary) => this.handleMessage(data, isBinary));
    ws.on("close", (code, reason) => this.handleClose(code, reason));
    ws.on("error", () => this.dispatch("error", new Event("error")));

    if (this.pendingClose) {
      this.readyState = NodeWebSocket.CLOSING;
      ws.close(this.pendingClose.code, this.pendingClose.reason);
      this.pendingMessages = [];
      return;
    }

    this.readyState = NodeWebSocket.OPEN;
    for (const message of this.pendingMessages) ws.send(message);
    this.pendingMessages = [];
    this.dispatch("open", new Event("open"));
  }

  _failUpgrade(): void {
    if (this.readyState === NodeWebSocket.CLOSED) return;
    this.readyState = NodeWebSocket.CLOSED;
    this.pendingMessages = [];
    this.dispatch("error", new Event("error"));
    this.dispatch("close", createCloseEvent());
  }

  send(data: string | ArrayBuffer): void {
    if (this.ws && this.readyState === NodeWebSocket.OPEN) {
      this.ws.send(data);
      return;
    }
    if (this.readyState === NodeWebSocket.CONNECTING) {
      if (this.pendingMessages.length >= MAX_PENDING_MESSAGES) {
        throw NETWORK_ERROR.create({ message: "WebSocket pending message limit exceeded" });
      }
      this.pendingMessages.push(data);
      return;
    }
    throw NETWORK_ERROR.create({ message: "WebSocket is not open" });
  }

  close(code?: number, reason?: string): void {
    validateClose(code, reason);
    if (this.readyState === NodeWebSocket.CLOSED || this.readyState === NodeWebSocket.CLOSING) {
      return;
    }
    if (this.ws) {
      this.ws.close(code, reason);
      this.readyState = NodeWebSocket.CLOSING;
    } else {
      this.readyState = NodeWebSocket.CLOSING;
      this.pendingClose = { code, reason };
    }
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

  private handleOpen(): void {
    if (this.readyState !== NodeWebSocket.CONNECTING) return;
    this.readyState = NodeWebSocket.OPEN;
    this.dispatch("open", new Event("open"));
  }

  private handleMessage(data: WSMessageData, isBinary: boolean): void {
    if (this.readyState !== NodeWebSocket.OPEN) return;
    this.dispatch(
      "message",
      new MessageEvent("message", { data: toMessageData(data, isBinary) }),
    );
  }

  private handleClose(code?: number, reason?: Buffer | string): void {
    if (this.readyState === NodeWebSocket.CLOSED) return;
    this.readyState = NodeWebSocket.CLOSED;
    this.ws = null;
    this.pendingMessages = [];
    this.dispatch("close", createCloseEvent(code, reason));
  }

  private dispatch(type: "open" | "close" | "error" | "message", event: Event): void {
    const propertyHandler = this[`on${type}`] as ((event: Event) => void) | null;
    propertyHandler?.(event);
    this.events.dispatchEvent(event);
  }
}
