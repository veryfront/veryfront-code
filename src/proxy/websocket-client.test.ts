import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  connectUpstreamWebSocket,
  resolveUpstreamWebSocketStreamFactory,
  UpstreamWebSocket,
  type UpstreamWebSocketConnection,
  type UpstreamWebSocketStream,
} from "./websocket-client.ts";
import { buildRendererBridgeRequest } from "./websocket-bridge.ts";
import { parseProjectDomain } from "#veryfront/server/utils/domain-parser.ts";

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

  // Bind ephemerally (port 0) so parallel test modules never collide on a fixed
  // port, and to 127.0.0.1 to avoid IPv6 flakiness — same shape as the other
  // proxy tests (see server-resolver.test.ts, token-manager.test.ts).
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, signal: controller.signal, onListen: () => {} },
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
      socket.binaryType = "arraybuffer";
      sockets.add(socket);
      socket.onmessage = (event) => {
        if (socket.readyState !== WebSocket.OPEN) return;
        // Binary frames are echoed verbatim so the caller can check byte fidelity.
        if (typeof event.data === "string") socket.send(`echo:${event.data}`);
        else socket.send(event.data as ArrayBuffer);
      };
      socket.onclose = () => sockets.delete(socket);
      return response;
    },
  );

  const addr = server.addr as Deno.NetAddr;

  return {
    url: new URL(`ws://${addr.hostname}:${addr.port}/_ws`),
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
        `http://${server.url.host}`,
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

  it("bridges binary frames byte-for-byte without reordering later frames", async () => {
    const server = startUpstreamServer();
    try {
      const socket = connectUpstreamWebSocket(server.url, identityHeaders());
      const frames: Array<string | number[]> = [];
      let resolveFrames: () => void = () => {};
      const collected = new Promise<void>((resolve) => {
        resolveFrames = resolve;
      });
      socket.onmessage = (event) => {
        const { data } = event;
        frames.push(typeof data === "string" ? data : Array.from(data));
        if (frames.length === 3) resolveFrames();
      };
      // Bound the handshake wait too: if connection setup regresses and the
      // socket errors or closes without ever opening, an unbounded `onopen`
      // await would wedge the worker before the frame timeout below is armed.
      let openTimer: number | undefined;
      try {
        await new Promise<void>((resolve, reject) => {
          socket.onopen = () => resolve();
          socket.onerror = () => reject(new Error("the upstream handshake errored before opening"));
          socket.onclose = (event) =>
            reject(new Error(`the upstream socket closed before opening (code ${event.code})`));
          openTimer = setTimeout(
            () => reject(new Error("timed out waiting for the upstream handshake to open")),
            5_000,
          );
        });
      } finally {
        if (openTimer !== undefined) clearTimeout(openTimer);
        socket.onerror = null;
        socket.onclose = null;
      }

      const buffer = new Uint8Array([1, 2, 3, 4, 5]);
      socket.send(buffer.subarray(2));
      socket.send(new Blob([new Uint8Array([9, 8])]));
      socket.send("after-blob");
      // Bound the wait: if the bridge drops or misorders a frame, `collected`
      // never settles, and an unbounded await would wedge the test worker
      // instead of failing. The timer is always cleared so the bounded wait
      // does not itself leak an op.
      let frameTimer: number | undefined;
      try {
        await Promise.race([
          collected,
          new Promise<void>((_, reject) => {
            frameTimer = setTimeout(
              () =>
                reject(
                  new Error(
                    `timed out waiting for 3 forwarded frames; received ${frames.length}`,
                  ),
                ),
              5_000,
            );
          }),
        ]);
      } finally {
        if (frameTimer !== undefined) clearTimeout(frameTimer);
      }

      assertEquals(
        frames[0],
        [3, 4, 5],
        "a view with a non-zero byteOffset must forward only its own bytes",
      );
      assertEquals(frames[1], [9, 8], "a Blob frame must forward exactly its own bytes");
      assertEquals(
        frames[2],
        "echo:after-blob",
        "an awaited Blob conversion must not reorder later frames",
      );

      // Bound the teardown wait the same way as the waits above: a close
      // handshake that never completes would wedge the worker after the
      // assertions already passed.
      let closeTimer: number | undefined;
      try {
        const closed = new Promise<void>((resolve, reject) => {
          socket.onclose = () => resolve();
          socket.onerror = () => reject(new Error("the upstream socket errored during teardown"));
          closeTimer = setTimeout(
            () => reject(new Error("timed out waiting for the upstream socket to close")),
            5_000,
          );
        });
        socket.close(1000, "done");
        await closed;
      } finally {
        if (closeTimer !== undefined) clearTimeout(closeTimer);
      }
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

  it("cancels the in-flight upstream read when an open socket is closed", async () => {
    let admit: (connection: UpstreamWebSocketConnection) => void = () => {};
    const opened = new Promise<UpstreamWebSocketConnection>((resolve) => {
      admit = resolve;
    });
    const stream: UpstreamWebSocketStream = {
      opened,
      closed: new Promise(() => {}),
      close() {},
    };
    let cancels = 0;

    const socket = new UpstreamWebSocket("ws://renderer/_ws", new Headers(), () => stream);
    admit({
      readable: new ReadableStream<string | Uint8Array>({
        cancel() {
          cancels++;
        },
      }),
      writable: new WritableStream<string | Uint8Array>(),
    });
    await opened;
    for (let turn = 0; turn < 5; turn++) await Promise.resolve();
    assertEquals(socket.readyState, WebSocket.OPEN, "the socket must be open before closing");

    socket.close(1000, "done");
    for (let turn = 0; turn < 5; turn++) await Promise.resolve();

    assertEquals(
      cancels,
      1,
      "close() must cancel the in-flight read so no receive op outlives the socket",
    );
  });

  it("discards an upstream connection that arrives after close", async () => {
    let admit: (connection: UpstreamWebSocketConnection) => void = () => {};
    const opened = new Promise<UpstreamWebSocketConnection>((resolve) => {
      admit = resolve;
    });
    const stream: UpstreamWebSocketStream = {
      opened,
      closed: new Promise(() => {}),
      close() {},
    };
    let opens = 0;
    let cancels = 0;

    const socket = new UpstreamWebSocket("ws://renderer/_ws", new Headers(), () => stream);
    socket.onopen = () => {
      opens++;
    };
    socket.close(1000, "done");

    const writable = new WritableStream<string | Uint8Array>();
    admit({
      readable: new ReadableStream<string | Uint8Array>({
        cancel() {
          cancels++;
        },
      }),
      writable,
    });
    await opened;
    for (let turn = 0; turn < 5; turn++) await Promise.resolve();

    assertEquals(opens, 0, "a connection inherited after close must not fire onopen");
    assertEquals(
      socket.readyState,
      WebSocket.CLOSING,
      "readyState must never move backwards from CLOSING to OPEN",
    );
    assertEquals(
      cancels,
      1,
      "the inherited readable must be cancelled so the renderer connection is not leaked",
    );
    assertEquals(
      writable.locked,
      false,
      "a discarded connection must not take a writer on the inherited writable",
    );
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
