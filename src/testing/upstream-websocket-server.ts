import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import { WsNodeWebSocketServerProvider } from "../../extensions/ext-node-websocket-ws/src/index.ts";
import { assert } from "#veryfront/testing/assert.ts";

export interface UpstreamServer {
  readonly url: URL;
  readonly seenHeaders: Promise<Record<string, string | null>>;
  close(): Promise<void>;
}

/** A renderer stand-in that reports the handshake headers it received. */
export async function startUpstreamServer(
  options: { rejectWith?: number } = {},
): Promise<UpstreamServer> {
  const headers = Promise.withResolvers<Record<string, string | null>>();
  const transports = new Map<Socket, Promise<void>>();
  const websocketServer = WsNodeWebSocketServerProvider.createServer({
    noServer: true,
    handleProtocols: () => false,
  });
  const server = createServer();
  const trackTransport = (transport: Socket) => {
    if (transports.has(transport)) return;
    const closed = Promise.withResolvers<void>();
    transports.set(transport, closed.promise);
    transport.once("close", () => {
      transports.delete(transport);
      closed.resolve();
    });
  };
  server.on("connection", trackTransport);
  server.on("upgrade", (req, transport, head) => {
    trackTransport(transport as Socket);
    headers.resolve(Object.fromEntries([
      "x-token",
      "x-project-slug",
      "x-environment",
      "sec-websocket-key",
    ].map((name) => [name, req.headers[name] ?? null])) as Record<string, string | null>);
    if (options.rejectWith) {
      transport.end(
        `HTTP/1.1 ${options.rejectWith} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
      );
      return;
    }
    websocketServer.handleUpgrade(req, transport, head, (socket) => {
      socket.on("message", (data, isBinary) => {
        const bytes = Buffer.from(data as Uint8Array);
        // Echo binary frames verbatim; text keeps the existing fixture prefix.
        socket.send(isBinary ? Uint8Array.from(bytes).buffer : `echo:${bytes.toString()}`);
      });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    // Port 0 prevents collisions between parallel test modules.
    server.listen(0, "127.0.0.1", resolve);
  });
  const addr = server.address();
  assert(addr !== null && typeof addr !== "string");

  return {
    url: new URL(`ws://127.0.0.1:${addr.port}/_ws`),
    seenHeaders: headers.promise,
    async close() {
      // A WebSocket close ACK can resolve WebSocketStream.closed while its
      // close-sent receive is still pending. Own upgraded TCP transports until
      // their actual close, rather than relying on protocol close or HTTP drain.
      const closedTransports = [...transports.values()];
      const serverClosed = new Promise<void>((resolve) => server.close(() => resolve()));
      for (const transport of transports.keys()) transport.destroy();
      const websocketsClosed = new Promise<void>((resolve) =>
        websocketServer.close(() => resolve())
      );
      await Promise.all([serverClosed, websocketsClosed, ...closedTransports]);
    },
  };
}
