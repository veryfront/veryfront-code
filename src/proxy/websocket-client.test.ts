import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  connectUpstreamWebSocket,
  resolveUpstreamWebSocketStreamFactory,
  UpstreamWebSocket,
  type UpstreamWebSocketStream,
} from "./websocket-client.ts";
import { buildRendererBridgeRequest } from "./websocket-bridge.ts";
import { parseProjectDomain } from "#veryfront/server/utils/domain-parser.ts";

const TEST_PORT = 45913;

interface UpstreamServer {
  readonly url: URL;
  readonly seenHeaders: Promise<Record<string, string | null>>;
  close(): Promise<void>;
}

/** A renderer stand-in that reports the handshake headers it received. */
function startUpstreamServer(options: { rejectWith?: number } = {}): UpstreamServer {
  const controller = new AbortController();
  let resolveHeaders: (value: Record<string, string | null>) => void = () => {};
  const seenHeaders = new Promise<Record<string, string | null>>((resolve) => {
    resolveHeaders = resolve;
  });
  const sockets = new Set<WebSocket>();

  const server = Deno.serve(
    { port: TEST_PORT, signal: controller.signal, onListen: () => {} },
    (req) => {
      resolveHeaders({
        "x-token": req.headers.get("x-token"),
        "x-project-slug": req.headers.get("x-project-slug"),
        "x-environment": req.headers.get("x-environment"),
        "sec-websocket-key": req.headers.get("sec-websocket-key"),
      });
      if (options.rejectWith) {
        return new Response(JSON.stringify({ error: "Missing project context" }), {
          status: options.rejectWith,
        });
      }
      const { socket, response } = Deno.upgradeWebSocket(req);
      sockets.add(socket);
      socket.onmessage = (event) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(`echo:${event.data}`);
      };
      socket.onclose = () => sockets.delete(socket);
      return response;
    },
  );

  return {
    url: new URL(`ws://127.0.0.1:${TEST_PORT}/_ws`),
    seenHeaders,
    async close() {
      for (const socket of sockets) {
        if (socket.readyState === WebSocket.OPEN) socket.close();
      }
      controller.abort();
      await server.finished;
    },
  };
}

function identityHeaders(): Headers {
  return new Headers({
    "x-token": "vf_proxy_minted_project_token",
    "x-project-slug": "support-agent-agodnc",
    "x-environment": "preview",
  });
}

describe("upstream WebSocket client", () => {
  it("presents the proxy identity headers on the handshake", async () => {
    const server = startUpstreamServer();
    try {
      const socket = connectUpstreamWebSocket(server.url, identityHeaders());
      const opened = new Promise<void>((resolve) => {
        socket.onopen = () => resolve();
      });
      await opened;

      const seen = await server.seenHeaders;
      assertEquals(seen["x-token"], "vf_proxy_minted_project_token");
      assertEquals(seen["x-project-slug"], "support-agent-agodnc");
      assertEquals(seen["x-environment"], "preview");
      assert(seen["sec-websocket-key"], "the client still performs a real handshake");

      const closed = new Promise<void>((resolve) => {
        socket.onclose = () => resolve();
      });
      socket.close(1000, "done");
      await closed;
    } finally {
      await server.close();
    }
  });

  it("carries a full browser-derived bridge header set through the handshake", async () => {
    // The forwarded set is whatever the browser sent minus hop-by-hop fields,
    // so the handshake must survive cookies, origin and friends riding along.
    const server = startUpstreamServer();
    try {
      const browserRequest = new Request(
        "https://support-agent-agodnc.preview.veryfront.com/_ws",
        {
          headers: {
            host: "support-agent-agodnc.preview.veryfront.com",
            upgrade: "websocket",
            connection: "Upgrade",
            "sec-websocket-version": "13",
            "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
            "sec-websocket-extensions": "permessage-deflate",
            origin: "https://support-agent-agodnc.preview.veryfront.com",
            cookie: "authToken=browser-session",
            "user-agent": "Mozilla/5.0",
            "accept-language": "en-GB",
          },
        },
      );
      const bridge = buildRendererBridgeRequest(
        browserRequest,
        new URL(browserRequest.url),
        {
          token: "vf_proxy_minted_project_token",
          projectSlug: "support-agent-agodnc",
          projectId: "prj_01hzzz",
          environment: "preview",
          contentSourceId: "src_01hzzz",
          host: "support-agent-agodnc.preview.veryfront.com",
          parsedDomain: parseProjectDomain("support-agent-agodnc.preview.veryfront.com"),
          isLocalProject: false,
        },
        "http://127.0.0.1:" + TEST_PORT,
      );

      const socket = connectUpstreamWebSocket(server.url, bridge.headers);
      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve();
        socket.onerror = () => reject(new Error("the bridge handshake was rejected"));
      });

      const seen = await server.seenHeaders;
      assertEquals(seen["x-token"], "vf_proxy_minted_project_token");
      assertEquals(seen["x-project-slug"], "support-agent-agodnc");

      const closed = new Promise<void>((resolve) => {
        socket.onclose = () => resolve();
      });
      socket.close(1000, "done");
      await closed;
    } finally {
      await server.close();
    }
  });

  it("bridges frames in both directions", async () => {
    const server = startUpstreamServer();
    try {
      const socket = connectUpstreamWebSocket(server.url, identityHeaders());
      const message = new Promise<string>((resolve) => {
        socket.onmessage = (event) => resolve(String(event.data));
      });
      await new Promise<void>((resolve) => {
        socket.onopen = () => resolve();
      });

      socket.send("ping");
      assertEquals(await message, "echo:ping");

      const closed = new Promise<void>((resolve) => {
        socket.onclose = () => resolve();
      });
      socket.close(1000, "done");
      await closed;
    } finally {
      await server.close();
    }
  });

  it("surfaces a rejected handshake as an error and a close", async () => {
    // Exactly what production sees today when the renderer answers 502.
    const server = startUpstreamServer({ rejectWith: 502 });
    try {
      const socket = connectUpstreamWebSocket(server.url, new Headers());
      const events: string[] = [];
      const settled = new Promise<void>((resolve) => {
        socket.onerror = () => events.push("error");
        socket.onclose = () => {
          events.push("close");
          resolve();
        };
      });
      await settled;

      assertEquals(events, ["error", "close"]);
      assertEquals(socket.readyState, WebSocket.CLOSED);
    } finally {
      await server.close();
    }
  });

  it("never falls back to a headerless socket when WebSocketStream is missing", () => {
    const scope = globalThis as { WebSocketStream?: unknown };
    const original = scope.WebSocketStream;
    delete scope.WebSocketStream;
    try {
      assertThrows(
        () => resolveUpstreamWebSocketStreamFactory(),
        TypeError,
        "WebSocketStream is unavailable",
      );
    } finally {
      if (original !== undefined) scope.WebSocketStream = original;
    }
  });

  it("tears the stream down when the close code is rejected by the client API", () => {
    const closeCalls: (undefined | { closeCode?: number; reason?: string })[] = [];
    const stream: UpstreamWebSocketStream = {
      opened: new Promise(() => {}),
      closed: new Promise(() => {}),
      close(closeInfo) {
        closeCalls.push(closeInfo);
        if (closeInfo) throw new TypeError("The close code must be 1000 or 3000-4999");
      },
    };

    const socket = new UpstreamWebSocket("ws://renderer/_ws", new Headers(), () => stream);
    socket.close(1011, "Server connection error");

    assertEquals(closeCalls.length, 2);
    assertEquals(closeCalls[0], { closeCode: 1011, reason: "Server connection error" });
    assertEquals(closeCalls[1], undefined);
    assertEquals(socket.readyState, WebSocket.CLOSING);
  });

  it("passes the headers straight through to the stream factory", () => {
    let seen: [string, string][] = [];
    const stream: UpstreamWebSocketStream = {
      opened: new Promise(() => {}),
      closed: new Promise(() => {}),
      close() {},
    };

    new UpstreamWebSocket("ws://renderer/_ws", identityHeaders(), (_url, init) => {
      seen = init.headers;
      return stream;
    });

    assert(
      seen.some(([name, value]) => name === "x-token" && value === "vf_proxy_minted_project_token"),
      `expected the upstream token header, got ${JSON.stringify(seen)}`,
    );
  });
});
