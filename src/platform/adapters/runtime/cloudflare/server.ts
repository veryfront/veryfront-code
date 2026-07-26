import type { ServerAdapter, WebSocketUpgrade, WebSocketUpgradeOptions } from "../../base.ts";
import { resolvePortableWebSocketUpgradeHeaders } from "../shared/websocket-upgrade.ts";
import type { CloudflareResponseInit, WebSocketPair as CloudflareWebSocketPair } from "./types.ts";
import { NOT_SUPPORTED } from "#veryfront/errors/error-registry/general.ts";

export function resolveCloudflareWebSocketUpgradeHeaders(
  request: Request,
  options: WebSocketUpgradeOptions = {},
): Headers {
  return resolvePortableWebSocketUpgradeHeaders(request, options, {
    platform: "cloudflare",
    runtimeName: "Cloudflare",
    unsupportedIdleTimeoutDetail:
      "Cloudflare WebSocketPair does not support a transport idle timeout; use application-level heartbeats",
  });
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
