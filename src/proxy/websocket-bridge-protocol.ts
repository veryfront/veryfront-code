import { HMR_MAX_MESSAGE_SIZE_BYTES } from "#veryfront/utils/constants/index.ts";
import { hasProjectIdentityControlCharacters } from "#veryfront/utils/project-identity.ts";
import { MAX_PROXY_TIMER_DELAY_MS } from "./timing.ts";

const DEFAULT_MAX_QUEUED_MESSAGES = 64;
const MAX_CONFIGURED_QUEUED_MESSAGES = 1_024;
export const PROXY_WEBSOCKET_CONNECTION_TIMEOUT_MS = 30_000;
const ArrayIsArray = Array.isArray;

export const PROXY_WS_CONNECTING = 0;
export const PROXY_WS_OPEN = 1;
export const PROXY_WS_CLOSING = 2;
export const PROXY_WS_CLOSED = 3;
export const PROXY_WS_CLOSE_GOING_AWAY = 1001;
export const PROXY_WS_CLOSE_UNSUPPORTED_DATA = 1003;
export const PROXY_WS_CLOSE_MESSAGE_TOO_BIG = 1009;
export const PROXY_WS_CLOSE_INTERNAL_ERROR = 1011;
export const PROXY_WS_CLOSE_TRY_AGAIN_LATER = 1013;

export type ProxyWebSocketMessage =
  | string
  | ArrayBuffer
  | ArrayBufferView
  | Blob;

export interface ProxyBridgeSocket {
  readonly bufferedAmount: number;
  readonly readyState: number;
  onclose: ((event: CloseEvent) => unknown) | null;
  onerror: ((event: Event) => unknown) | null;
  onmessage: ((event: MessageEvent<unknown>) => unknown) | null;
  onopen: ((event: Event) => unknown) | null;
  close(code?: number, reason?: string): void;
  send(data: ProxyWebSocketMessage): void;
}

export interface ProxyWebSocketBridgeLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(
    message: string,
    context?: Record<string, unknown>,
    error?: unknown,
  ): void;
}

export interface CreateProxyWebSocketBridgeOptions {
  readonly clientSocket: ProxyBridgeSocket;
  readonly connectTimeoutMs?: number;
  readonly createServerSocket: (targetUrl: string) => ProxyBridgeSocket;
  readonly logger?: ProxyWebSocketBridgeLogger;
  readonly maxBufferedBytes?: number;
  readonly maxMessageBytes?: number;
  readonly maxQueuedBytes?: number;
  readonly maxQueuedMessages?: number;
  readonly targetUrl: string;
}

export interface ResolvedProxyWebSocketBridgeOptions {
  readonly clientSocket: ProxyBridgeSocket;
  readonly connectTimeoutMs: number;
  readonly createServerSocket: (targetUrl: string) => ProxyBridgeSocket;
  readonly logger: ProxyWebSocketBridgeLogger | undefined;
  readonly maxBufferedBytes: number;
  readonly maxMessageBytes: number;
  readonly maxQueuedBytes: number;
  readonly maxQueuedMessages: number;
  readonly targetUrl: string;
}

export interface ProxyWebSocketBridge {
  readonly closed: Promise<void>;
  close(code?: number, reason?: string): void;
}

export interface PreparedProxyWebSocketMessage {
  readonly byteLength: number;
  readonly data: ProxyWebSocketMessage;
}

export type PrepareProxyWebSocketMessageResult =
  | {
    readonly ok: true;
    readonly message: PreparedProxyWebSocketMessage;
  }
  | {
    readonly ok: false;
    readonly failure: "too-large" | "unreadable" | "unsupported";
  };

export type SendProxyWebSocketMessageResult =
  | { readonly ok: true }
  | {
    readonly ok: false;
    readonly failure:
      | "backpressure"
      | "destination-not-open"
      | "invalid-buffered-amount"
      | "send-failed";
    readonly error?: unknown;
  };

const BRIDGE_OPTION_NAMES = new Set([
  "clientSocket",
  "connectTimeoutMs",
  "createServerSocket",
  "logger",
  "maxBufferedBytes",
  "maxMessageBytes",
  "maxQueuedBytes",
  "maxQueuedMessages",
  "targetUrl",
]);

function isArrayOrUninspectable(value: unknown): boolean {
  try {
    return ArrayIsArray(value);
  } catch {
    return true;
  }
}

function ownDataValue(
  descriptors: PropertyDescriptorMap,
  key: string,
): unknown {
  const descriptor = descriptors[key];
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) {
    throw new TypeError(
      `Proxy WebSocket bridge option ${key} must be a data property`,
    );
  }
  return descriptor.value;
}

function resolvePositiveInteger(
  value: unknown,
  fallback: number,
  maximum: number,
  label: string,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximum
  ) {
    throw new RangeError(
      `Proxy WebSocket ${label} must be an integer between 1 and ${maximum}`,
    );
  }
  return value;
}

function normalizeWebSocketTarget(value: unknown): string {
  if (
    typeof value !== "string" ||
    value === "" ||
    value !== value.trim() ||
    value.includes("\\") ||
    hasProjectIdentityControlCharacters(value)
  ) {
    throw new TypeError("Proxy WebSocket target URL is invalid");
  }
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    throw new TypeError("Proxy WebSocket target URL is invalid");
  }
  if (
    (target.protocol !== "ws:" && target.protocol !== "wss:") ||
    !target.hostname ||
    target.username !== "" ||
    target.password !== "" ||
    target.hash !== ""
  ) {
    throw new TypeError(
      "Proxy WebSocket target URL must be a credential-free ws:// or wss:// URL without a fragment",
    );
  }
  return target.toString();
}

function resolveProxyWebSocketBridgeLogger(
  value: unknown,
): ProxyWebSocketBridgeLogger | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || isArrayOrUninspectable(value)) {
    throw new TypeError("Proxy WebSocket bridge logger must be an object");
  }
  let info: unknown;
  let warn: unknown;
  let error: unknown;
  try {
    info = Reflect.get(value, "info");
    warn = Reflect.get(value, "warn");
    error = Reflect.get(value, "error");
  } catch (cause) {
    throw new TypeError("Proxy WebSocket bridge logger is unreadable", {
      cause,
    });
  }
  if (
    typeof info !== "function" ||
    typeof warn !== "function" ||
    typeof error !== "function"
  ) {
    throw new TypeError("Proxy WebSocket bridge logger contract is invalid");
  }
  return Object.freeze({
    info(message: string, context?: Record<string, unknown>): void {
      Reflect.apply(info, value, [message, context]);
    },
    warn(message: string, context?: Record<string, unknown>): void {
      Reflect.apply(warn, value, [message, context]);
    },
    error(
      message: string,
      context?: Record<string, unknown>,
      cause?: unknown,
    ): void {
      Reflect.apply(error, value, [message, context, cause]);
    },
  });
}

export function requireProxyBridgeSocket(
  value: unknown,
  label: string,
): ProxyBridgeSocket {
  if (!value || typeof value !== "object" || isArrayOrUninspectable(value)) {
    throw new TypeError(`Proxy WebSocket ${label} socket is invalid`);
  }
  let close: unknown;
  let send: unknown;
  try {
    close = Reflect.get(value, "close");
    send = Reflect.get(value, "send");
  } catch (error) {
    throw new TypeError(`Proxy WebSocket ${label} socket is unreadable`, {
      cause: error,
    });
  }
  if (typeof close !== "function" || typeof send !== "function") {
    throw new TypeError(
      `Proxy WebSocket ${label} socket contract is invalid`,
    );
  }
  return value as ProxyBridgeSocket;
}

export function resolveProxyWebSocketBridgeOptions(
  options: CreateProxyWebSocketBridgeOptions,
): ResolvedProxyWebSocketBridgeOptions {
  if (!options || typeof options !== "object" || isArrayOrUninspectable(options)) {
    throw new TypeError("Proxy WebSocket bridge options must be a plain object");
  }
  let prototype: object | null;
  let keys: PropertyKey[];
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(options);
    keys = Reflect.ownKeys(options);
    descriptors = Object.getOwnPropertyDescriptors(options);
  } catch (error) {
    throw new TypeError("Proxy WebSocket bridge options are unreadable", {
      cause: error,
    });
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Proxy WebSocket bridge options must be a plain object");
  }
  if (
    keys.some((key) => typeof key !== "string" || !BRIDGE_OPTION_NAMES.has(key))
  ) {
    throw new TypeError(
      "Proxy WebSocket bridge options contain an unknown option",
    );
  }

  const clientSocket = requireProxyBridgeSocket(
    ownDataValue(descriptors, "clientSocket"),
    "client",
  );
  const createServerSocket = ownDataValue(descriptors, "createServerSocket");
  if (typeof createServerSocket !== "function") {
    throw new TypeError(
      "Proxy WebSocket server socket factory must be a function",
    );
  }
  const logger = ownDataValue(descriptors, "logger");

  return Object.freeze({
    clientSocket,
    connectTimeoutMs: resolvePositiveInteger(
      ownDataValue(descriptors, "connectTimeoutMs"),
      PROXY_WEBSOCKET_CONNECTION_TIMEOUT_MS,
      MAX_PROXY_TIMER_DELAY_MS,
      "connect timeout",
    ),
    createServerSocket: createServerSocket as (
      targetUrl: string,
    ) => ProxyBridgeSocket,
    logger: resolveProxyWebSocketBridgeLogger(logger),
    maxBufferedBytes: resolvePositiveInteger(
      ownDataValue(descriptors, "maxBufferedBytes"),
      HMR_MAX_MESSAGE_SIZE_BYTES,
      HMR_MAX_MESSAGE_SIZE_BYTES,
      "buffered byte limit",
    ),
    maxMessageBytes: resolvePositiveInteger(
      ownDataValue(descriptors, "maxMessageBytes"),
      HMR_MAX_MESSAGE_SIZE_BYTES,
      HMR_MAX_MESSAGE_SIZE_BYTES,
      "message byte limit",
    ),
    maxQueuedBytes: resolvePositiveInteger(
      ownDataValue(descriptors, "maxQueuedBytes"),
      HMR_MAX_MESSAGE_SIZE_BYTES,
      HMR_MAX_MESSAGE_SIZE_BYTES,
      "queued byte limit",
    ),
    maxQueuedMessages: resolvePositiveInteger(
      ownDataValue(descriptors, "maxQueuedMessages"),
      DEFAULT_MAX_QUEUED_MESSAGES,
      MAX_CONFIGURED_QUEUED_MESSAGES,
      "queued message limit",
    ),
    targetUrl: normalizeWebSocketTarget(
      ownDataValue(descriptors, "targetUrl"),
    ),
  });
}

export function closeBridgePeer(
  peer: Pick<ProxyBridgeSocket, "close" | "readyState"> | null,
  code: number,
  reason: string,
): boolean {
  if (!peer) return false;
  try {
    if (
      peer.readyState !== PROXY_WS_OPEN &&
      peer.readyState !== PROXY_WS_CONNECTING
    ) {
      return false;
    }
    try {
      peer.close(code, reason);
    } catch {
      peer.close();
    }
    return true;
  } catch {
    return false;
  }
}

export function prepareProxyWebSocketMessage(
  value: unknown,
  maximumBytes: number,
): PrepareProxyWebSocketMessageResult {
  try {
    if (typeof value === "string") {
      if (value.length > maximumBytes) {
        return { ok: false, failure: "too-large" };
      }
      const byteLength = new TextEncoder().encode(value).byteLength;
      return byteLength <= maximumBytes
        ? {
          ok: true,
          message: Object.freeze({ byteLength, data: value }),
        }
        : { ok: false, failure: "too-large" };
    }

    if (value instanceof ArrayBuffer) {
      if (value.byteLength > maximumBytes) {
        return { ok: false, failure: "too-large" };
      }
      const copy = value.slice(0);
      return {
        ok: true,
        message: Object.freeze({
          byteLength: copy.byteLength,
          data: copy,
        }),
      };
    }

    if (
      typeof SharedArrayBuffer !== "undefined" &&
      value instanceof SharedArrayBuffer
    ) {
      if (value.byteLength > maximumBytes) {
        return { ok: false, failure: "too-large" };
      }
      const copy = new Uint8Array(value.byteLength);
      copy.set(new Uint8Array(value));
      return {
        ok: true,
        message: Object.freeze({
          byteLength: copy.byteLength,
          data: copy.buffer,
        }),
      };
    }

    if (ArrayBuffer.isView(value)) {
      if (value.byteLength > maximumBytes) {
        return { ok: false, failure: "too-large" };
      }
      const copy = new Uint8Array(value.byteLength);
      copy.set(
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      );
      return {
        ok: true,
        message: Object.freeze({
          byteLength: copy.byteLength,
          data: copy.buffer,
        }),
      };
    }

    if (typeof Blob !== "undefined" && value instanceof Blob) {
      return value.size <= maximumBytes
        ? {
          ok: true,
          message: Object.freeze({ byteLength: value.size, data: value }),
        }
        : { ok: false, failure: "too-large" };
    }
  } catch {
    return { ok: false, failure: "unreadable" };
  }
  return { ok: false, failure: "unsupported" };
}

export function sendPreparedProxyWebSocketMessage(
  destination: ProxyBridgeSocket,
  message: PreparedProxyWebSocketMessage,
  maximumBufferedBytes: number,
): SendProxyWebSocketMessageResult {
  let readyState: number;
  let bufferedAmount: number;
  try {
    readyState = destination.readyState;
    bufferedAmount = destination.bufferedAmount;
  } catch (error) {
    return {
      ok: false,
      failure: "invalid-buffered-amount",
      error,
    };
  }
  if (readyState !== PROXY_WS_OPEN) {
    return { ok: false, failure: "destination-not-open" };
  }
  if (
    !Number.isSafeInteger(bufferedAmount) ||
    bufferedAmount < 0
  ) {
    return { ok: false, failure: "invalid-buffered-amount" };
  }
  if (bufferedAmount > maximumBufferedBytes - message.byteLength) {
    return { ok: false, failure: "backpressure" };
  }
  try {
    destination.send(message.data);
    return { ok: true };
  } catch (error) {
    return { ok: false, failure: "send-failed", error };
  }
}

export function proxyWebSocketEventErrorMessage(event: Event): string {
  try {
    if (typeof ErrorEvent !== "undefined" && event instanceof ErrorEvent) {
      return typeof event.message === "string" && event.message !== ""
        ? event.message
        : "Unknown WebSocket error";
    }
    const descriptor = Object.getOwnPropertyDescriptor(event, "message");
    if (
      descriptor &&
      "value" in descriptor &&
      typeof descriptor.value === "string"
    ) {
      return descriptor.value;
    }
  } catch {
    // The generic diagnostic below remains safe.
  }
  return "Unknown WebSocket error";
}

export function proxyWebSocketCloseEventDetails(event: CloseEvent): {
  code: number;
  reason: string;
  wasClean: boolean;
} {
  try {
    return {
      code: Number.isSafeInteger(event.code) ? event.code : PROXY_WS_CLOSE_GOING_AWAY,
      reason: typeof event.reason === "string" ? event.reason : "",
      wasClean: event.wasClean === true,
    };
  } catch {
    return {
      code: PROXY_WS_CLOSE_GOING_AWAY,
      reason: "",
      wasClean: false,
    };
  }
}

export function detachProxyWebSocketHandlers(
  socket: ProxyBridgeSocket | null,
): void {
  if (!socket) return;
  try {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
  } catch {
    // Closing both peers remains the authoritative cleanup.
  }
}
