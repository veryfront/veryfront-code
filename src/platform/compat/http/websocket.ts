import { isDeno } from "../runtime.ts";
import type { WebSocketUpgradeOptions, WebSocketUpgradeResult } from "./types.ts";
import { getNativeDeno } from "./native-response.ts";
import { NOT_SUPPORTED } from "#veryfront/errors/error-registry/general.ts";
import { resolvePortableWebSocketUpgradeHeaders } from "./websocket-upgrade-options.ts";

const DENO_WEBSOCKET_UPGRADE_CONFIG = {
  platform: "deno",
  runtimeName: "Deno",
  supportsNonzeroIdleTimeout: true,
  supportsResponseHeaders: false,
  unsupportedResponseHeadersDetail: "Deno does not support custom WebSocket response headers",
} as const;

export function upgradeWebSocket(
  request: Request,
  options?: WebSocketUpgradeOptions,
): WebSocketUpgradeResult {
  if (!isDeno) {
    throw NOT_SUPPORTED.create({
      detail: "WebSocket upgrade on Node.js requires server-level handling. " +
        "Use a WebSocket library like 'ws' with server.on('upgrade').",
    });
  }

  return upgradeWebSocketDeno(request, options);
}

export function isWebSocketUpgrade(request: Request): boolean {
  return request.headers.get("upgrade")?.toLowerCase() === "websocket";
}

function upgradeWebSocketDeno(
  request: Request,
  options?: WebSocketUpgradeOptions,
): WebSocketUpgradeResult {
  // Access native Deno via `self` to bypass dnt shim transform.
  // dnt rewrites `globalThis.Deno` to @deno/shim-deno, which lacks upgradeWebSocket.
  const nativeDeno = getNativeDeno();
  if (typeof nativeDeno?.upgradeWebSocket !== "function") {
    throw NOT_SUPPORTED.create({
      detail: "Deno.upgradeWebSocket() is not available in this runtime.",
    });
  }

  const { socket, response } = nativeDeno.upgradeWebSocket(
    request,
    resolveDenoWebSocketUpgradeOptions(request, options),
  );
  return { socket, response };
}

/**
 * Resolve and validate Deno's native WebSocket options against the actual
 * request. Deno owns the handshake response and cannot apply custom response
 * headers.
 */
export function resolveDenoWebSocketUpgradeOptions(
  request: Request,
  options?: WebSocketUpgradeOptions,
): Deno.UpgradeWebSocketOptions | undefined {
  const headers = resolvePortableWebSocketUpgradeHeaders(
    request,
    options,
    DENO_WEBSOCKET_UPGRADE_CONFIG,
  );
  return toDenoUpgradeWebSocketOptions(
    headers.get("sec-websocket-protocol") ?? undefined,
    options?.idleTimeout,
  );
}

/**
 * Validate and translate a standalone option bag.
 *
 * @internal Prefer {@link resolveDenoWebSocketUpgradeOptions} at an upgrade
 * boundary so protocol selection is also checked against the client offer.
 */
export function resolveDenoUpgradeWebSocketOptions(
  options?: WebSocketUpgradeOptions,
): Deno.UpgradeWebSocketOptions | undefined {
  const requestHeaders = new Headers({ Upgrade: "websocket" });
  if (options?.protocol !== undefined) {
    requestHeaders.set("Sec-WebSocket-Protocol", options.protocol);
  }
  const headers = resolvePortableWebSocketUpgradeHeaders(
    new Request("http://localhost/", { headers: requestHeaders }),
    options,
    DENO_WEBSOCKET_UPGRADE_CONFIG,
  );
  return toDenoUpgradeWebSocketOptions(
    headers.get("sec-websocket-protocol") ?? undefined,
    options?.idleTimeout,
  );
}

function toDenoUpgradeWebSocketOptions(
  protocol: string | undefined,
  idleTimeout: number | undefined,
): Deno.UpgradeWebSocketOptions | undefined {
  if (!protocol && idleTimeout === undefined) return undefined;
  return {
    ...(protocol ? { protocol } : {}),
    ...(idleTimeout !== undefined ? { idleTimeout } : {}),
  };
}
