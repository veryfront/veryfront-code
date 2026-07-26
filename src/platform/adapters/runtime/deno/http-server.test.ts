import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createDenoServerWithRuntime,
  type DenoNativeHttpServer,
  DenoServer,
  type DenoServeRuntime,
} from "./http-server.ts";

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
