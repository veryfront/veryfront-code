import { isDeno } from "../runtime.ts";
import type { WebSocketUpgradeOptions, WebSocketUpgradeResult } from "./types.ts";
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
  const deno = globalThis.Deno;
  if (typeof deno?.upgradeWebSocket !== "function") {
    throw NOT_SUPPORTED.create({
      detail: "Deno.upgradeWebSocket() is not available in this runtime.",
    });
  }

  const denoOptions: Deno.UpgradeWebSocketOptions | undefined = options?.protocol
    ? { protocol: options.protocol }
    : undefined;

  const { socket, response } = deno.upgradeWebSocket(request, denoOptions);
  return { socket, response };
}
