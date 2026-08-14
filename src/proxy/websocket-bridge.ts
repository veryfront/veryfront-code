import type { WebSocketUpgradeOptions } from "#veryfront/platform/compat/http/index.ts";
import { createProxyContextHeaders } from "./handler.ts";
import type { ProxyContext, ProxyRequestOptions } from "./handler.ts";

type BridgePeer = Pick<WebSocket, "close" | "readyState">;
type ProxyError = NonNullable<ProxyContext["error"]>;

export type WebSocketAuthorization =
  | { allowed: true; context: ProxyContext }
  | { allowed: false; error: ProxyError };

export async function authorizeWebSocketRequest(
  req: Request,
  url: URL,
  resolveContext: (req: Request, options: ProxyRequestOptions) => Promise<ProxyContext>,
): Promise<WebSocketAuthorization> {
  const context = await resolveContext(req, { url });
  return context.error ? { allowed: false, error: context.error } : { allowed: true, context };
}

/** The upstream hop the proxy opens to the renderer for a browser WebSocket. */
export interface RendererBridgeRequest {
  readonly url: URL;
  readonly headers: Headers;
}

/**
 * Identity the browser may name in the `/_ws` query string. The proxy owns both
 * values, so a client-supplied copy is always discarded rather than forwarded.
 */
const BROWSER_CONTROLLED_IDENTITY_PARAMS = ["x-project-slug", "x-environment"] as const;

/**
 * Handshake fields that belong to the browser's socket, not the upstream one.
 * The upstream client mints its own key, version and extension list.
 */
const CLIENT_HANDSHAKE_HEADERS = [
  "sec-websocket-key",
  "sec-websocket-version",
  "sec-websocket-extensions",
  "sec-websocket-accept",
] as const;

/**
 * Build the renderer hop for a browser WebSocket.
 *
 * The bridge hop carries the same proxy-resolved identity headers as every
 * other forwarded request -- including the `x-token` the proxy minted for this
 * project from its own API client credentials. That is what positively
 * identifies the proxy to the renderer's `createProxyGuard`; the guard demands
 * exactly this and nothing about a WebSocket makes it optional.
 *
 * Identity is never taken from the query string: the browser chooses the whole
 * query of `/_ws` and the bridge forwards it, so any tenant identity read from
 * there would be caller-chosen. The two params the proxy used to write are
 * deleted for the same reason.
 */
export function buildRendererBridgeRequest(
  req: Request,
  url: URL,
  context: ProxyContext,
  serverUrl: string,
): RendererBridgeRequest {
  const serverWsUrl = serverUrl.replace(/^http/, "ws");
  const safePath = url.pathname.replace(/^\/\/+/, "/");
  const target = new URL(`${serverWsUrl}${safePath}${url.search}`);
  for (const param of BROWSER_CONTROLLED_IDENTITY_PARAMS) target.searchParams.delete(param);

  const headers = createProxyContextHeaders(req.headers, context);
  for (const header of CLIENT_HANDSHAKE_HEADERS) headers.delete(header);
  headers.delete("sec-websocket-protocol");

  return { url: target, headers };
}

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

export function getServerWebSocketErrorLogLevel(message: string): ServerWebSocketErrorLogLevel {
  return TRANSIENT_SERVER_ERROR_PATTERNS.some((pattern) => pattern.test(message))
    ? "warn"
    : "error";
}

export function getClientWebSocketErrorLogLevel(message: string): ServerWebSocketErrorLogLevel {
  return TRANSIENT_CLIENT_ERROR_PATTERNS.some((pattern) => pattern.test(message))
    ? "warn"
    : "error";
}

export function closeBridgePeer(peer: BridgePeer | null, code: number, reason: string): void {
  if (!peer) return;
  if (peer.readyState !== WebSocket.OPEN && peer.readyState !== WebSocket.CONNECTING) return;
  peer.close(code, reason);
}

export function createProxyClientWebSocketUpgradeOptions(): WebSocketUpgradeOptions {
  // Proxied project sockets use app-level heartbeats; Deno's transport idle timeout
  // can close otherwise healthy bridges before the browser sends a data frame.
  return { idleTimeout: 0 };
}
