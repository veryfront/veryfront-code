import type { ServerAdapter, WebSocketUpgrade, WebSocketUpgradeOptions } from "../../base.ts";
import type { CloudflareResponseInit, WebSocketPair as CloudflareWebSocketPair } from "./types.ts";
import { INVALID_ARGUMENT, NOT_SUPPORTED } from "#veryfront/errors/error-registry/general.ts";

const HTTP_TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const CLOUDFLARE_MANAGED_WEBSOCKET_HEADERS = new Set([
  "connection",
  "sec-websocket-accept",
  "sec-websocket-extensions",
  "sec-websocket-protocol",
  "upgrade",
]);

export function resolveCloudflareWebSocketUpgradeHeaders(
  request: Request,
  options: WebSocketUpgradeOptions = {},
): Headers {
  if (request.headers.get("upgrade")?.trim().toLowerCase() !== "websocket") {
    throw INVALID_ARGUMENT.create({
      detail: "Cloudflare WebSocket upgrade requires an Upgrade: websocket request",
      context: { platform: "cloudflare", operation: "upgradeWebSocket" },
    });
  }

  if (
    options.idleTimeout !== undefined &&
    (!Number.isFinite(options.idleTimeout) || options.idleTimeout < 0)
  ) {
    throw INVALID_ARGUMENT.create({
      detail: "Cloudflare WebSocket idleTimeout must be a non-negative finite number",
      context: { platform: "cloudflare", operation: "upgradeWebSocket" },
    });
  }
  if (options.idleTimeout !== undefined && options.idleTimeout !== 0) {
    throw NOT_SUPPORTED.create({
      detail:
        "Cloudflare WebSocketPair does not support a transport idle timeout; use application-level heartbeats",
      context: { platform: "cloudflare", operation: "upgradeWebSocket" },
    });
  }

  const headers = new Headers(options.headers);
  for (const name of CLOUDFLARE_MANAGED_WEBSOCKET_HEADERS) {
    if (headers.has(name)) {
      throw INVALID_ARGUMENT.create({
        detail: `Cloudflare manages the ${name} WebSocket handshake header`,
        context: { platform: "cloudflare", operation: "upgradeWebSocket", header: name },
      });
    }
  }

  const protocol = options.protocol;
  if (protocol !== undefined) {
    if (!HTTP_TOKEN_PATTERN.test(protocol)) {
      throw INVALID_ARGUMENT.create({
        detail: "Cloudflare WebSocket protocol must be a valid HTTP token",
        context: { platform: "cloudflare", operation: "upgradeWebSocket" },
      });
    }

    const offeredProtocols = request.headers.get("sec-websocket-protocol")
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
    if (!offeredProtocols.includes(protocol)) {
      throw INVALID_ARGUMENT.create({
        detail: "Cloudflare WebSocket protocol was not offered by the client",
        context: { platform: "cloudflare", operation: "upgradeWebSocket" },
      });
    }
    headers.set("Sec-WebSocket-Protocol", protocol);
  }

  return headers;
}

export class CloudflareServerAdapter implements ServerAdapter {
  upgradeWebSocket(
    request: Request,
    options?: WebSocketUpgradeOptions,
  ): WebSocketUpgrade {
    const headers = resolveCloudflareWebSocketUpgradeHeaders(request, options);
    const Pair = (
      globalThis as typeof globalThis & {
        WebSocketPair?: new () => CloudflareWebSocketPair;
      }
    ).WebSocketPair;
    if (typeof Pair !== "function") {
      throw NOT_SUPPORTED.create({
        detail: "Cloudflare WebSocketPair is not available in this runtime",
        context: { platform: "cloudflare", operation: "upgradeWebSocket" },
      });
    }

    const pair = new Pair();
    const client = pair[0];
    const server = pair[1];

    server.accept();

    const responseInit: CloudflareResponseInit = {
      status: 101,
      statusText: "Switching Protocols",
      headers,
      webSocket: client,
    };

    return {
      socket: server,
      response: new Response(null, responseInit),
    };
  }
}
