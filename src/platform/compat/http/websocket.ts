/**
 * WebSocket Upgrade Abstraction
 *
 * Provides cross-runtime WebSocket upgrade functionality.
 */

import { isDeno } from "../runtime.ts";
import type { WebSocketUpgradeOptions, WebSocketUpgradeResult } from "./types.ts";

/**
 * Upgrade an HTTP request to a WebSocket connection.
 *
 * @param request - The incoming HTTP request with upgrade headers
 * @param options - Optional WebSocket upgrade options
 * @returns The WebSocket and HTTP response to return to the client
 * @throws Error if WebSocket upgrade is not supported or the request cannot be upgraded
 */
export function upgradeWebSocket(
  request: Request,
  options?: WebSocketUpgradeOptions,
): WebSocketUpgradeResult {
  if (isDeno) {
    return upgradeWebSocketDeno(request, options);
  }

  // Node.js WebSocket upgrade requires the ws package and access to the raw socket
  // This is typically handled at the server level, not per-request
  throw new Error(
    "WebSocket upgrade on Node.js requires server-level handling. " +
      "Use a WebSocket library like 'ws' with server.on('upgrade').",
  );
}

/**
 * Check if a request is a WebSocket upgrade request
 */
export function isWebSocketUpgrade(request: Request): boolean {
  const upgrade = request.headers.get("upgrade");
  return upgrade?.toLowerCase() === "websocket";
}

/**
 * Deno-specific WebSocket upgrade
 */
function upgradeWebSocketDeno(
  request: Request,
  options?: WebSocketUpgradeOptions,
): WebSocketUpgradeResult {
  // Convert options to Deno format
  const denoOptions: Deno.UpgradeWebSocketOptions = {};

  if (options?.protocol) {
    denoOptions.protocol = options.protocol;
  }

  // Perform the upgrade
  const { socket, response } = Deno.upgradeWebSocket(request, denoOptions);

  return { socket, response };
}
