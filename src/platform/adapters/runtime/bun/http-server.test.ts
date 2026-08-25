import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type {
  BunFile,
  BunNamespace,
  BunServeOptions,
  BunServer as NativeBunServer,
} from "./types.ts";
import { getBunRuntime } from "./types.ts";
import { BunServer, createBunServer, createBunServerWithRuntime } from "./http-server.ts";
import { BunServerAdapter, BunWebSocket, type BunWebSocketData } from "./websocket-adapter.ts";
import { getRequestPeerProvenance, isRequestFromLoopbackPeer } from "../shared/request-peer.ts";

class FakeNativeServer implements NativeBunServer<BunWebSocketData> {
  readonly upgradeCalls: Array<{
    request: Request;
    data: BunWebSocketData;
    headers?: HeadersInit;
  }> = [];
  readonly stopCalls: Array<boolean | undefined> = [];
  stopFailures: Error[] = [];

  constructor(
    readonly hostname = "127.0.0.1",
    readonly port = 41_237,
    readonly peerAddress: string | null = "127.0.0.1",
  ) {}

  requestIP(_request: Request): { address: string; port: number; family: string } | null {
    return this.peerAddress === null
      ? null
      : { address: this.peerAddress, port: 52_000, family: "IPv4" };
  }

  stop(closeActiveConnections?: boolean): Promise<void> {
    this.stopCalls.push(closeActiveConnections);
    const error = this.stopFailures.shift();
    return error ? Promise.reject(error) : Promise.resolve();
  }

  upgrade(
    request: Request,
    options: { data: BunWebSocketData; headers?: HeadersInit },
  ): boolean {
    this.upgradeCalls.push({ request, ...options });
    return true;
  }
}

function createRuntime(nativeServer: FakeNativeServer): {
  runtime: BunNamespace;
  getOptions: () => BunServeOptions<BunWebSocketData>;
  getServeCalls: () => number;
} {
  let options: BunServeOptions<BunWebSocketData> | undefined;
  let serveCalls = 0;
  const runtime: BunNamespace = {
    env: {},
    file(_path: string): BunFile {
      throw new Error("file() is not used by HTTP server tests");
    },
    write(_path: string, _content: string): Promise<number> {
      throw new Error("write() is not used by HTTP server tests");
    },
    serve<T>(input: BunServeOptions<T>): NativeBunServer<T> {
      serveCalls++;
      options = input as unknown as BunServeOptions<BunWebSocketData>;
      return nativeServer as unknown as NativeBunServer<T>;
    },
  };

  return {
    runtime,
    getOptions: () => {
      if (!options) throw new Error("Bun.serve was not called");
      return options;
    },
    getServeCalls: () => serveCalls,
  };
}

describe("Bun HTTP server lifecycle", () => {
  it("records Bun's native request peer before dispatching the request", async () => {
    const native = new FakeNativeServer("127.0.0.1", 41_237, "203.0.113.8");
    const fake = createRuntime(native);
    let observed:
      | { provenance: ReturnType<typeof getRequestPeerProvenance>; loopback: boolean }
      | undefined;
    await createBunServerWithRuntime(fake.runtime, (request) => {
      observed = {
        provenance: getRequestPeerProvenance(request),
        loopback: isRequestFromLoopbackPeer(request),
      };
      return new Response("ok");
    });
    const request = new Request("http://localhost/_dev", {
      headers: { host: "localhost" },
    });

    await fake.getOptions().fetch(request, native);

    assertEquals(observed, {
      provenance: {
        runtime: "bun",
        transport: "tcp",
        hostname: "203.0.113.8",
      },
      loopback: false,
    });
  });

  it("continues serving ordinary requests if Bun's peer lookup fails", async () => {
    const native = new FakeNativeServer();
    native.requestIP = () => {
      throw new Error("peer lookup failed");
    };
    const fake = createRuntime(native);
    let observedPeer: ReturnType<typeof getRequestPeerProvenance>;
    await createBunServerWithRuntime(fake.runtime, (request) => {
      observedPeer = getRequestPeerProvenance(request);
      return new Response("ok");
    });

    const response = await fake.getOptions().fetch(
      new Request("http://localhost/"),
      native,
    );

    assertEquals(response?.status, 200);
    assertEquals(await response?.text(), "ok");
    assertEquals(observedPeer, undefined);
  });

  it("contains handler exceptions as a 500 instead of leaking them to Bun", async () => {
    const native = new FakeNativeServer();
    const fake = createRuntime(native);
    await createBunServerWithRuntime(fake.runtime, () => {
      throw new Error("handler exploded");
    });

    const response = await fake.getOptions().fetch(
      new Request("http://localhost/"),
      native,
    );

    assertEquals(response?.status, 500, "handler exceptions must be contained");
    assertEquals(
      await response?.text(),
      "Internal Server Error",
      "the contained response must not leak the error",
    );
  });

  it("reports the actual bound address and installs the native WebSocket handler", async () => {
    const native = new FakeNativeServer("::1", 45_678);
    const fake = createRuntime(native);
    let listened: { hostname: string; port: number } | undefined;

    const server = await createBunServerWithRuntime(
      fake.runtime,
      () => new Response("ok"),
      {
        hostname: "localhost",
        port: 0,
        onListen: (address) => {
          listened = address;
        },
      },
    );

    assertEquals(server.addr, { hostname: "::1", port: 45_678 });
    assertEquals(listened, { hostname: "::1", port: 45_678 });
    assertEquals(fake.getOptions().hostname, "localhost");
    assertEquals(fake.getOptions().port, 0);
    assertEquals(fake.getOptions().websocket?.idleTimeout, 0);

    const response = await fake.getOptions().fetch(
      new Request("http://localhost/"),
      native,
    );
    assertEquals(await response?.text(), "ok");
  });

  it("fails closed if Bun does not report a bound TCP address", async () => {
    const native = new FakeNativeServer();
    Object.defineProperty(native, "port", { value: undefined });
    const fake = createRuntime(native);

    await assertRejects(
      () => createBunServerWithRuntime(fake.runtime, () => new Response("ok")),
      Error,
      "valid bound TCP address",
    );
    assertEquals(native.stopCalls, [true]);
  });

  it("shares concurrent stop calls, force-closes active sockets, and remains idempotent", async () => {
    const native = new FakeNativeServer();
    let release!: () => void;
    const stopped = new Promise<void>((resolve) => {
      release = resolve;
    });
    native.stop = (force?: boolean) => {
      native.stopCalls.push(force);
      return stopped;
    };
    const server = new BunServer(native);

    const first = server.stop();
    const second = server.stop();
    assertStrictEquals(second, first);
    await Promise.resolve();
    assertEquals(native.stopCalls, [true]);

    release();
    await first;
    await server.stop();
    assertEquals(native.stopCalls, [true]);
  });

  it("allows a failed native stop to be retried", async () => {
    const native = new FakeNativeServer();
    native.stopFailures.push(new Error("first stop failed"));
    const server = new BunServer(native);

    await assertRejects(() => server.stop(), Error, "first stop failed");
    await server.stop();
    assertEquals(native.stopCalls, [true, true]);
  });

  it("does not open a listener when startup is already aborted", async () => {
    const native = new FakeNativeServer();
    const fake = createRuntime(native);
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));

    await assertRejects(
      () =>
        createBunServerWithRuntime(fake.runtime, () => new Response("ok"), {
          signal: controller.signal,
        }),
      DOMException,
      "cancelled",
    );
    assertEquals(fake.getServeCalls(), 0);
  });

  it("force-stops the listener when the serving signal aborts", async () => {
    const native = new FakeNativeServer();
    const fake = createRuntime(native);
    const controller = new AbortController();

    await createBunServerWithRuntime(fake.runtime, () => new Response("ok"), {
      signal: controller.signal,
    });
    controller.abort();
    await Promise.resolve();
    await Promise.resolve();
    assertEquals(native.stopCalls, [true]);
  });

  it("stops the listener if onListen throws", async () => {
    const native = new FakeNativeServer();
    const fake = createRuntime(native);

    await assertRejects(
      () =>
        createBunServerWithRuntime(fake.runtime, () => new Response("ok"), {
          onListen: () => {
            throw new Error("listen callback failed");
          },
        }),
      Error,
      "listen callback failed",
    );
    assertEquals(native.stopCalls, [true]);
  });

  it("returns undefined to Bun only after the active request is upgraded", async () => {
    const native = new FakeNativeServer();
    const fake = createRuntime(native);
    const adapter = new BunServerAdapter();
    await createBunServerWithRuntime(
      fake.runtime,
      (request) => adapter.upgradeWebSocket(request, { idleTimeout: 0 }).response,
    );
    const request = new Request("http://localhost/_ws", {
      headers: { connection: "Upgrade", upgrade: "websocket" },
    });

    const response = await fake.getOptions().fetch(request, native);
    assertEquals(response, undefined);
    assertEquals(native.upgradeCalls.length, 1);
    const upgradeCall = native.upgradeCalls[0];
    if (!upgradeCall) throw new Error("Expected one native upgrade call");
    assertEquals(upgradeCall.request, request);
  });

  it("fails clearly when createBunServer is called outside Bun", async () => {
    if (getBunRuntime()) return;
    await assertRejects(
      () => createBunServer(() => new Response("ok")),
      Error,
      "only be used in the Bun runtime",
    );
  });

  it("serves HTTP and bidirectional WebSockets in the real Bun runtime", async () => {
    if (!getBunRuntime()) return;
    const adapter = new BunServerAdapter();
    let client: WebSocket | undefined;
    const server = await createBunServer((request) => {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("ok");
      }

      const upgrade = adapter.upgradeWebSocket(request, {
        protocol: "hmr",
        headers: { "X-Bun-Integration": "ok" },
        idleTimeout: 0,
      });
      const sendReady = () => upgrade.socket.send("ready");
      if (upgrade.socket.readyState === BunWebSocket.OPEN) sendReady();
      else upgrade.socket.addEventListener("open", sendReady, { once: true });
      upgrade.socket.addEventListener("message", (event) => {
        upgrade.socket.send(`echo:${String((event as MessageEvent).data)}`);
      });
      return upgrade.response;
    }, {
      hostname: "127.0.0.1",
      port: 0,
    });

    try {
      const response = await fetch(`http://127.0.0.1:${server.addr.port}/health`);
      assertEquals(response.status, 200);
      assertEquals(await response.text(), "ok");

      client = new WebSocket(
        `ws://127.0.0.1:${server.addr.port}/_ws`,
        ["chat", "hmr"],
      );
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Bun WebSocket integration timed out")),
          5_000,
        );
        client!.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("Bun WebSocket integration client failed"));
        };
        client!.onmessage = (event) => {
          if (event.data === "ready") {
            client!.send("ping");
          } else if (event.data === "echo:ping") {
            clearTimeout(timeout);
            resolve();
          }
        };
      });
      assertEquals(client.protocol, "hmr");
    } finally {
      client?.close();
      await server.stop();
    }
  });
});
