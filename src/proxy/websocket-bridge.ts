import type { ProxyContext, ProxyContextError, ProxyRequestOptions } from "./handler.ts";

/** Minimal socket surface required for safely closing either bridge peer. */
export interface WebSocketBridgePeer {
  /** Current WebSocket ready-state value. */
  readonly readyState: number;
  /** Begin the WebSocket close handshake. */
  close(code?: number, reason?: string): void;
}

/** Transport options required for accepted proxy WebSockets. */
export interface ProxyWebSocketUpgradeOptions {
  /** Optional negotiated subprotocol. */
  protocol?: string;
  /** Optional response headers added during the upgrade. */
  headers?: Headers | Record<string, string>;
  /** Transport idle timeout in seconds, where zero disables it. */
  idleTimeout?: number;
}

/** Authorization result returned before a browser socket is upgraded. */
export type WebSocketAuthorization =
  | { allowed: true; context: ProxyContext }
  | { allowed: false; error: ProxyContextError };

/** Resolve normal proxy authorization before accepting a WebSocket upgrade. */
export async function authorizeWebSocketRequest(
  req: Request,
  url: URL,
  resolveContext: (req: Request, options: ProxyRequestOptions) => Promise<ProxyContext>,
): Promise<WebSocketAuthorization> {
  const context = await resolveContext(req, { url });
  return context.error ? { allowed: false, error: context.error } : { allowed: true, context };
}

/** Severity used for WebSocket transport errors. */
export type ServerWebSocketErrorLogLevel = "warn" | "error";

const TRANSIENT_SERVER_ERROR_PATTERNS = [
  /unexpected eof/i,
  /connection reset/i,
  /connection closed/i,
  /socket closed/i,
];

const TRANSIENT_CLIENT_ERROR_PATTERNS = [
  /unexpected eof/i,
  /no response from ping frame/i,
  /connection reset/i,
  /connection closed/i,
  /socket closed/i,
];

/** Classify an upstream WebSocket error for logging. */
export function getServerWebSocketErrorLogLevel(message: string): ServerWebSocketErrorLogLevel {
  return TRANSIENT_SERVER_ERROR_PATTERNS.some((pattern) => pattern.test(message))
    ? "warn"
    : "error";
}

/** Classify a browser-side WebSocket error for logging. */
export function getClientWebSocketErrorLogLevel(message: string): ServerWebSocketErrorLogLevel {
  return TRANSIENT_CLIENT_ERROR_PATTERNS.some((pattern) => pattern.test(message))
    ? "warn"
    : "error";
}

/** Build the trusted upstream WebSocket target from an HTTP renderer base URL. */
export function createUpstreamWebSocketUrl(
  baseUrl: string,
  requestUrl: URL,
  projectSlug: string | undefined,
  environment: "preview" | "production",
): URL {
  const safePath = requestUrl.pathname.replace(/^\/+/, "/");
  const targetUrl = new URL(safePath + requestUrl.search, baseUrl);
  if (targetUrl.protocol === "http:") targetUrl.protocol = "ws:";
  else if (targetUrl.protocol === "https:") targetUrl.protocol = "wss:";
  else throw new TypeError("WebSocket upstream base URL must use HTTP or HTTPS");
  targetUrl.searchParams.set("x-project-slug", projectSlug ?? "");
  targetUrl.searchParams.set("x-environment", environment);
  return targetUrl;
}

function sendableCloseCode(code: number): number {
  if (code >= 3_000 && code <= 4_999) return code;
  if (code >= 1_000 && code <= 1_014 && ![1_004, 1_005, 1_006].includes(code)) return code;
  return 1_011;
}

function boundedCloseReason(reason: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(reason).byteLength <= 123) return reason;

  let result = "";
  for (const character of reason) {
    if (encoder.encode(result + character).byteLength > 123) break;
    result += character;
  }
  return result;
}

/** Close a bridge peer with a protocol-safe code and bounded UTF-8 reason. */
export function closeBridgePeer(
  peer: WebSocketBridgePeer | null,
  code: number,
  reason: string,
): void {
  if (!peer) return;
  if (peer.readyState !== WebSocket.OPEN && peer.readyState !== WebSocket.CONNECTING) return;
  try {
    peer.close(sendableCloseCode(code), boundedCloseReason(reason));
  } catch {
    // The peer can transition after readyState is read. Closing is best effort.
  }
}

/** Return transport options for browser WebSockets that use app-level heartbeats. */
export function createProxyClientWebSocketUpgradeOptions(): ProxyWebSocketUpgradeOptions {
  // Proxied project sockets use app-level heartbeats; Deno's transport idle timeout
  // can close otherwise healthy bridges before the browser sends a data frame.
  return { idleTimeout: 0 };
}
