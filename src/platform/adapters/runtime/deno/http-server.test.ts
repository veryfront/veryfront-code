import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createDenoServer,
  createDenoServerWithRuntime,
  type DenoNativeHttpServer,
  DenoServer,
  type DenoServeRuntime,
} from "./http-server.ts";
import { getRequestPeerProvenance, isRequestFromLoopbackPeer } from "../shared/request-peer.ts";
import { isTrustedLocalControlRequest } from "#veryfront/security/http/local-control-request.ts";

class FakeNativeServer implements DenoNativeHttpServer {
  readonly shutdownCalls: number[] = [];
  readonly shutdownFailures: Error[] = [];
  readonly finished = Promise.resolve();

  constructor(
    readonly addr: unknown = {
      hostname: "127.0.0.1",
      port: 41_237,
      transport: "tcp",
    },
  ) {}

  shutdown(): Promise<void> {
    this.shutdownCalls.push(this.shutdownCalls.length + 1);
    const error = this.shutdownFailures.shift();
    return error ? Promise.reject(error) : Promise.resolve();
  }
}

type CapturedServeOptions = Parameters<DenoServeRuntime["serve"]>[0];

function createRuntime(nativeServer: FakeNativeServer): {
  runtime: DenoServeRuntime;
  getOptions: () => CapturedServeOptions;
  getServeCalls: () => number;
} {
  let options: CapturedServeOptions | undefined;
  let serveCalls = 0;
  return {
    runtime: {
      serve(input) {
        serveCalls++;
        options = input;
        return nativeServer;
      },
    },
    getOptions: () => {
      if (!options) throw new Error("Deno.serve was not called");
      return options;
    },
    getServeCalls: () => serveCalls,
  };
}

describe("Deno HTTP server lifecycle", () => {
  it("admits a real Deno loopback listener request with native peer provenance", async () => {
    const server = await createDenoServer((request) =>
      new Response(null, {
        status: isTrustedLocalControlRequest(request, { proxyTopologyTrusted: false }) ? 204 : 403,
      }), {
      hostname: "127.0.0.1",
      port: 0,
    });

    try {
      const response = await fetch(`http://127.0.0.1:${server.addr.port}/_dev`);
      assertEquals(response.status, 204);
    } finally {
      await server.stop();
    }
  });

  it("records the native TCP peer before dispatching the request", async () => {
    const native = new FakeNativeServer();
    const fake = createRuntime(native);
    let observed:
      | { provenance: ReturnType<typeof getRequestPeerProvenance>; loopback: boolean }
      | undefined;
    await createDenoServerWithRuntime(fake.runtime, (request) => {
      observed = {
        provenance: getRequestPeerProvenance(request),
        loopback: isRequestFromLoopbackPeer(request),
      };
      return new Response(null, {
        status: isTrustedLocalControlRequest(request, { proxyTopologyTrusted: false }) ? 204 : 403,
      });
    });
    const request = new Request("http://localhost/_dev", {
      headers: { host: "localhost" },
    });

    const response = await fake.getOptions().handler(request, {
      remoteAddr: {
        transport: "tcp",
        hostname: "192.168.1.25",
        port: 52_000,
      },
    });

    assertEquals(observed, {
      provenance: {
        runtime: "deno",
        transport: "tcp",
        hostname: "192.168.1.25",
      },
      loopback: false,
    });
    assertEquals(response.status, 403);

    const localRequest = new Request("http://localhost/_dev", {
      headers: { host: "localhost" },
    });
    const localResponse = await fake.getOptions().handler(localRequest, {
      remoteAddr: {
        transport: "tcp",
        hostname: "::ffff:127.0.0.1",
        port: 52_001,
      },
    });
    assertEquals(localResponse.status, 204);
  });

  it("reports the native bound address and forwards the portable handler", async () => {
    const native = new FakeNativeServer({
      hostname: "::1",
      port: 45_678,
      transport: "tcp",
    });
    const fake = createRuntime(native);
    let listened: { hostname: string; port: number } | undefined;

    const server = await createDenoServerWithRuntime(
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
    assertEquals(
      await (await fake.getOptions().handler(new Request("http://localhost/"))).text(),
      "ok",
    );
    await server.stop();
  });

  it("contains a throwing application handler in a 500 response", async () => {
    const native = new FakeNativeServer();
    const fake = createRuntime(native);
    const server = await createDenoServerWithRuntime(
      fake.runtime,
      () => {
        throw new Error("boom");
      },
      { hostname: "localhost", port: 0 },
    );

    try {
      const response = await fake.getOptions().handler(new Request("http://localhost/boom"));
      assertEquals(
        response.status,
        500,
        "a throwing handler must be contained in a 500 response",
      );
      assertEquals(
        await response.text(),
        "Internal Server Error",
        "the contained failure must not leak handler detail",
      );
    } finally {
      await server.stop();
    }
  });

  it("shares concurrent stop calls, remains idempotent, and aborts owned work", async () => {
    const native = new FakeNativeServer();
    let release!: () => void;
    const shutdown = new Promise<void>((resolve) => {
      release = resolve;
    });
    native.shutdown = () => {
      native.shutdownCalls.push(native.shutdownCalls.length + 1);
      return shutdown;
    };
    const controller = new AbortController();
    const server = new DenoServer(
      native,
      { hostname: "127.0.0.1", port: 41_237 },
      controller,
    );

    const first = server.stop();
    const second = server.stop();
    assertStrictEquals(second, first);
    assertEquals(controller.signal.aborted, true);
    await Promise.resolve();
    assertEquals(native.shutdownCalls, [1]);

    release();
    await first;
    await server.stop();
    assertEquals(native.shutdownCalls, [1]);
  });

  it("allows a failed native shutdown to be retried", async () => {
    const native = new FakeNativeServer();
    native.shutdownFailures.push(new Error("first shutdown failed"));
    const server = new DenoServer(
      native,
      { hostname: "127.0.0.1", port: 41_237 },
      new AbortController(),
    );

    await assertRejects(() => server.stop(), Error, "first shutdown failed");
    await server.stop();
    assertEquals(native.shutdownCalls, [1, 2]);
  });

  it("does not call Deno.serve when startup is already aborted", async () => {
    const native = new FakeNativeServer();
    const fake = createRuntime(native);
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));

    await assertRejects(
      () =>
        createDenoServerWithRuntime(fake.runtime, () => new Response("ok"), {
          signal: controller.signal,
        }),
      DOMException,
      "cancelled",
    );
    assertEquals(fake.getServeCalls(), 0);
  });

  it("stops the listener when onListen throws", async () => {
    const native = new FakeNativeServer();
    const fake = createRuntime(native);

    await assertRejects(
      () =>
        createDenoServerWithRuntime(fake.runtime, () => new Response("ok"), {
          onListen: () => {
            throw new Error("listen callback failed");
          },
        }),
      Error,
      "listen callback failed",
    );
    assertEquals(native.shutdownCalls, [1]);
  });

  it("fails closed and cleans up an invalid native bound address", async () => {
    const native = new FakeNativeServer({
      hostname: "127.0.0.1",
      port: 0,
      transport: "tcp",
    });
    const fake = createRuntime(native);

    await assertRejects(
      () => createDenoServerWithRuntime(fake.runtime, () => new Response("ok")),
      Error,
      "valid bound TCP address",
    );
    assertEquals(native.shutdownCalls, [1]);
  });

  it("stops startup if onListen aborts the serving signal", async () => {
    const native = new FakeNativeServer();
    const fake = createRuntime(native);
    const controller = new AbortController();

    await assertRejects(
      () =>
        createDenoServerWithRuntime(fake.runtime, () => new Response("ok"), {
          signal: controller.signal,
          onListen: () => {
            controller.abort(new DOMException("cancelled in callback", "AbortError"));
          },
        }),
      DOMException,
      "cancelled in callback",
    );
    assertEquals(native.shutdownCalls, [1]);
  });
});
