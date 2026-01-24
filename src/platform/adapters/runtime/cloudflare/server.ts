import type { Server, ServerAdapter, WebSocketUpgrade } from "../../base.ts";
import type { CloudflareResponseInit, CloudflareWebSocket } from "./types.ts";

declare class WebSocketPair {
  0: CloudflareWebSocket;
  1: CloudflareWebSocket;
}

export class CloudflareServerAdapter implements ServerAdapter {
  upgradeWebSocket(_request: Request): WebSocketUpgrade {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.accept();

    const responseInit: CloudflareResponseInit = {
      status: 101,
      statusText: "Switching Protocols",
      webSocket: client,
    };

    return {
      socket: server as unknown as WebSocket,
      response: new Response(null, responseInit),
    };
  }
}

export class CloudflareServer implements Server {
  stop(): Promise<void> {
    return Promise.resolve();
  }

  get addr(): { hostname: string; port: number } {
    return { hostname: "worker", port: 443 };
  }
}
