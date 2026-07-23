import { INVALID_ARGUMENT, NOT_SUPPORTED } from "#veryfront/errors/error-registry/general.ts";
import { NETWORK_ERROR } from "#veryfront/errors/error-registry/server.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import type {
  Server,
  ServerAdapter,
  WebSocketUpgrade,
  WebSocketUpgradeOptions,
} from "../../base.ts";
import type {
  CloudflareResponseInit,
  CloudflareServerRuntime,
  CloudflareWebSocket,
  WebSocketPair as CloudflareWebSocketPair,
} from "./types.ts";

const RESERVED_UPGRADE_HEADERS = new Set([
  "connection",
  "sec-websocket-accept",
  "sec-websocket-protocol",
  "upgrade",
]);

function getNativeWebSocketPairConstructor(): typeof CloudflareWebSocketPair {
  let constructor: unknown;
  try {
    constructor = Reflect.get(globalThis, "WebSocketPair");
  } catch {
    // A hostile global must be treated as unavailable.
  }

  if (typeof constructor !== "function") {
    throw NOT_SUPPORTED.create({
      message: "Cloudflare WebSocketPair is unavailable in this runtime",
    });
  }
  return constructor as typeof CloudflareWebSocketPair;
}

const nativeCloudflareServerRuntime: CloudflareServerRuntime = {
  createWebSocketPair: () => {
    const Pair = getNativeWebSocketPairConstructor();
    return new Pair();
  },
  createResponse: (init) => new Response(null, init),
};

function parseRequestedProtocols(request: Request): string[] {
  return (request.headers.get("sec-websocket-protocol") ?? "")
    .split(",")
    .map((protocol) => protocol.trim())
    .filter(Boolean);
}

function resolveUpgradeHeaders(
  request: Request,
  options: WebSocketUpgradeOptions | undefined,
): Headers {
  let headers: Headers;
  try {
    headers = new Headers(options?.headers);
  } catch {
    throw INVALID_ARGUMENT.create({ message: "Invalid WebSocket upgrade headers" });
  }
  for (const name of RESERVED_UPGRADE_HEADERS) headers.delete(name);

  const protocol = options?.protocol;
  if (!protocol) return headers;
  if (!parseRequestedProtocols(request).includes(protocol)) {
    throw INVALID_ARGUMENT.create({
      message: "The selected WebSocket protocol was not requested by the client",
    });
  }
  try {
    headers.set("Sec-WebSocket-Protocol", protocol);
  } catch {
    throw INVALID_ARGUMENT.create({ message: "Invalid WebSocket upgrade headers" });
  }
  return headers;
}

function validateUpgradeRequest(request: Request): void {
  if (
    request.method !== "GET" ||
    request.headers.get("upgrade")?.trim().toLowerCase() !== "websocket"
  ) {
    throw INVALID_ARGUMENT.create({ message: "Invalid WebSocket upgrade request" });
  }
}

function validateIdleTimeout(options: WebSocketUpgradeOptions | undefined): void {
  const idleTimeout = options?.idleTimeout;
  if (idleTimeout === undefined || idleTimeout === 0) return;
  if (!Number.isFinite(idleTimeout) || idleTimeout < 0) {
    throw INVALID_ARGUMENT.create({ message: "WebSocket idle timeout must be non-negative" });
  }
  throw NOT_SUPPORTED.create({
    message: "Cloudflare Workers do not support per-connection WebSocket idle timeouts",
  });
}

function closeQuietly(socket: CloudflareWebSocket): void {
  try {
    socket.close(1011, "WebSocket upgrade failed");
  } catch {
    // Preserve the original upgrade failure.
  }
}

export class CloudflareServerAdapter implements ServerAdapter {
  constructor(
    private readonly runtime: CloudflareServerRuntime = nativeCloudflareServerRuntime,
  ) {}

  upgradeWebSocket(
    request: Request,
    options?: WebSocketUpgradeOptions,
  ): WebSocketUpgrade {
    validateUpgradeRequest(request);
    validateIdleTimeout(options);
    const headers = resolveUpgradeHeaders(request, options);

    let pair: { 0: CloudflareWebSocket; 1: CloudflareWebSocket };
    try {
      pair = this.runtime.createWebSocketPair();
    } catch (error) {
      if (error instanceof VeryfrontError) throw error;
      throw NETWORK_ERROR.create({ message: "Unable to create a Cloudflare WebSocket pair" });
    }
    const client = pair[0];
    const server = pair[1];

    const responseInit: CloudflareResponseInit = {
      status: 101,
      statusText: "Switching Protocols",
      headers,
      webSocket: client,
    };

    let response: Response;
    try {
      response = this.runtime.createResponse(responseInit);
      server.accept();
    } catch {
      closeQuietly(client);
      closeQuietly(server);
      throw NETWORK_ERROR.create({ message: "Unable to accept the Cloudflare WebSocket upgrade" });
    }

    return {
      socket: server,
      response,
    };
  }
}

/** @deprecated Cloudflare Workers do not expose a listener lifecycle. Use createWorker(). */
export class CloudflareServer implements Server {
  async stop(): Promise<void> {
    throw NOT_SUPPORTED.create({
      message: "Cloudflare Workers do not bind or stop listener servers. Use createWorker().",
    });
  }

  get addr(): never {
    throw NOT_SUPPORTED.create({
      message: "Cloudflare Workers do not bind a listener address. Use createWorker().",
    });
  }
}
