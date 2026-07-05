import { isDeno } from "../runtime.ts";
import type { WebSocketUpgradeOptions, WebSocketUpgradeResult } from "./types.ts";
import { getNativeDeno } from "./native-response.ts";
import { NOT_SUPPORTED } from "#veryfront/errors";

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
    resolveDenoUpgradeWebSocketOptions(options),
  );
  return { socket, response };
}

export function resolveDenoUpgradeWebSocketOptions(
  options?: WebSocketUpgradeOptions,
): Deno.UpgradeWebSocketOptions | undefined {
  if (!options?.protocol && options?.idleTimeout === undefined) return undefined;

  return {
    ...(options.protocol ? { protocol: options.protocol } : {}),
    ...(options.idleTimeout !== undefined ? { idleTimeout: options.idleTimeout } : {}),
  };
}
