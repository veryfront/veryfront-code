import * as dntShim from "../../../../_dnt.shims.js";
import { isDeno } from "../runtime.js";
import type { WebSocketUpgradeOptions, WebSocketUpgradeResult } from "./types.js";

export function upgradeWebSocket(
  request: dntShim.Request,
  options?: WebSocketUpgradeOptions,
): WebSocketUpgradeResult {
  if (!isDeno) {
    throw new Error(
      "WebSocket upgrade on Node.js requires server-level handling. " +
        "Use a WebSocket library like 'ws' with server.on('upgrade').",
    );
  }

  return upgradeWebSocketDeno(request, options);
}

export function isWebSocketUpgrade(request: dntShim.Request): boolean {
  return request.headers.get("upgrade")?.toLowerCase() === "websocket";
}

function upgradeWebSocketDeno(
  request: dntShim.Request,
  options?: WebSocketUpgradeOptions,
): WebSocketUpgradeResult {
  const denoOptions: dntShim.Deno.UpgradeWebSocketOptions = options?.protocol
    ? { protocol: options.protocol }
    : {};

  const { socket, response } = dntShim.Deno.upgradeWebSocket(request, denoOptions);
  return { socket, response };
}
