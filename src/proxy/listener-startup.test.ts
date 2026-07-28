import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type Handler,
  type HttpServer,
  NodeHttpServer,
  type ServeOptions,
} from "#veryfront/platform/compat/http/index.ts";
import type { Server as NativeNodeHttpServer } from "node:http";
import { startProxyListener } from "./listener-startup.ts";
import { createProxyShutdownCoordinator } from "./shutdown-coordinator.ts";
import { createProxyStartupRollback } from "./startup-rollback.ts";

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakeHttpServer implements HttpServer {
  serveCalls = 0;
  closeCalls = 0;

  constructor(
    private readonly start: (
      options: ServeOptions,
    ) => Promise<void>,
    private readonly stop: () => Promise<void> = () => Promise.resolve(),
  ) {}

  serve(_handler: Handler, options: ServeOptions = {}): Promise<void> {
    this.serveCalls++;
    return this.start(options);
  }

  close(): Promise<void> {
    this.closeCalls++;
    return this.stop();
  }
}

const handler: Handler = () => new Response("ok");

function rawNodeTransport(server: NodeHttpServer): NativeNodeHttpServer {
  return (server as unknown as {
    active: { server: { server: NativeNodeHttpServer } };
  }).active.server.server;
}

describe("proxy listener startup", () => {
  it("commits once at Node-style onListen readiness", async () => {
    const events: string[] = [];
    const server = new FakeHttpServer((options) => {
      options.onListen?.({ hostname: "127.0.0.1", port: 4_321 });
      return Promise.resolve();
    });
    let commitCalls = 0;
    const listener = startProxyListener({
      server,
      handler,
      hostname: "127.0.0.1",
      port: 4_321,
      commitStartup: () => {
        commitCalls++;
        events.push("commit");
        return true;
      },
      onRuntimeFailure: () => {
        events.push("runtime-failure");
      },
    });

    assertEquals(await listener.ready, {
      hostname: "127.0.0.1",
      port: 4_321,
    });
    await listener.finished;

    assertEquals(server.serveCalls, 1);
    assertEquals(commitCalls, 1);
    assertEquals(events, ["commit"]);
  });

  it("separates Deno-style readiness from listener lifetime", async () => {
    const lifetime = deferred<void>();
    let runtimeFailures = 0;
    const server = new FakeHttpServer((options) => {
      options.onListen?.({ hostname: "127.0.0.1", port: 4_322 });
      return lifetime.promise;
    });
    const listener = startProxyListener({
      server,
      handler,
      hostname: "127.0.0.1",
      port: 4_322,
      commitStartup: () => true,
      onRuntimeFailure: () => {
        runtimeFailures++;
      },
    });

    await listener.ready;
    let finished = false;
    void listener.finished.then(() => {
      finished = true;
    });
    await Promise.resolve();
    assertEquals(finished, false);
    assertEquals(server.serveCalls, 1);

    lifetime.resolve();
    await listener.finished;
    assertEquals(finished, true);
    assertEquals(runtimeFailures, 0);
  });

  it("lets successful Deno-style shutdown settlement share one cleanup", async () => {
    const lifetime = deferred<void>();
    const rollback = createProxyStartupRollback({ cleanupTimeoutMs: 100 });
    let cleanupCalls = 0;
    let runtimeFailureReports = 0;
    const server = new FakeHttpServer(
      (options) => {
        options.onListen?.({ hostname: "127.0.0.1", port: 4_326 });
        return lifetime.promise;
      },
      () => {
        lifetime.resolve();
        return Promise.resolve();
      },
    );
    const coordinator = createProxyShutdownCoordinator({
      performShutdown: async () => {
        cleanupCalls++;
        await server.close();
      },
      reportListenerFailure: () => {
        runtimeFailureReports++;
      },
      handleShutdownFailure: () => {},
    });
    const listener = startProxyListener({
      server,
      handler,
      hostname: "127.0.0.1",
      port: 4_326,
      commitStartup: () => rollback.commit(),
      onRuntimeFailure: (error) => coordinator.request({ source: "http-listener", error }),
    });

    await rollback.run(() => listener.ready);
    const shutdown = coordinator.request({
      source: "signal",
      signal: "SIGTERM",
    });
    await Promise.all([shutdown, listener.finished]);

    assertEquals(cleanupCalls, 1);
    assertEquals(server.closeCalls, 1);
    assertEquals(runtimeFailureReports, 0);
  });

  it("rolls back an exact rejection before readiness", async () => {
    const startupError = new Error("bind failed");
    const server = new FakeHttpServer(() => Promise.reject(startupError));
    const cleanup: string[] = [];
    const rollback = createProxyStartupRollback({ cleanupTimeoutMs: 100 });
    rollback.own("resource", () => {
      cleanup.push("resource");
    });
    const listener = startProxyListener({
      server,
      handler,
      hostname: "127.0.0.1",
      port: 4_323,
      commitStartup: () => rollback.commit(),
      onRuntimeFailure: () => {
        throw new Error("must not handle a startup failure");
      },
    });

    let rejection: unknown;
    try {
      await rollback.run(() => listener.ready);
    } catch (error) {
      rejection = error;
    }
    await listener.finished;

    assertStrictEquals(rejection, startupError);
    assertEquals(cleanup, ["resource"]);
    assertEquals(server.serveCalls, 1);
  });

  it("rolls back when the synchronous startup commit throws", async () => {
    const commitError = new Error("startup commit failed");
    const cleanup: string[] = [];
    const rollback = createProxyStartupRollback({ cleanupTimeoutMs: 100 });
    rollback.own("resource", () => {
      cleanup.push("resource");
    });
    const server = new FakeHttpServer(async (options) => {
      options.onListen?.({ hostname: "127.0.0.1", port: 4_327 });
    });
    let runtimeFailures = 0;
    const listener = startProxyListener({
      server,
      handler,
      hostname: "127.0.0.1",
      port: 4_327,
      commitStartup: () => {
        throw commitError;
      },
      onRuntimeFailure: () => {
        runtimeFailures++;
      },
    });

    let rejection: unknown;
    try {
      await rollback.run(() => listener.ready);
    } catch (error) {
      rejection = error;
    }
    await listener.finished;

    assertStrictEquals(rejection, commitError);
    assertEquals(cleanup, ["resource"]);
    assertEquals(runtimeFailures, 0);
    assertEquals(rollback.commit(), false);
  });

  it("routes an exact post-readiness rejection outside startup rollback", async () => {
    const lifetime = deferred<void>();
    const runtimeError = new Error("listener failed");
    const failures: unknown[] = [];
    const cleanup: string[] = [];
    const rollback = createProxyStartupRollback({ cleanupTimeoutMs: 100 });
    rollback.own("resource", () => {
      cleanup.push("resource");
    });
    const server = new FakeHttpServer((options) => {
      options.onListen?.({ hostname: "127.0.0.1", port: 4_324 });
      return lifetime.promise;
    });
    const listener = startProxyListener({
      server,
      handler,
      hostname: "127.0.0.1",
      port: 4_324,
      commitStartup: () => rollback.commit(),
      onRuntimeFailure: (error) => {
        failures.push(error);
      },
    });

    await rollback.run(() => listener.ready);
    lifetime.reject(runtimeError);
    await listener.finished;

    assertEquals(failures.length, 1);
    assertStrictEquals(failures[0], runtimeError);
    assertEquals(cleanup, []);
    assertEquals(rollback.commit(), false);
  });

  it("shares one cleanup when a post-readiness Node error races signal shutdown", async () => {
    const server = new NodeHttpServer();
    const rollback = createProxyStartupRollback({ cleanupTimeoutMs: 100 });
    const cleanupGate = deferred<void>();
    const runtimeError = new Error("late Node listener failure");
    const reports: unknown[] = [];
    let cleanupCalls = 0;
    let runtimeFailureCalls = 0;
    let runtimeShutdown: Promise<void> | undefined;
    const coordinator = createProxyShutdownCoordinator({
      performShutdown: async () => {
        cleanupCalls++;
        await cleanupGate.promise;
        await server.close();
      },
      reportListenerFailure: (error) => {
        reports.push(error);
      },
      handleShutdownFailure: () => {},
    });
    const listener = startProxyListener({
      server,
      handler,
      hostname: "127.0.0.1",
      port: 0,
      commitStartup: () => rollback.commit(),
      onRuntimeFailure: (error) => {
        runtimeFailureCalls++;
        runtimeShutdown = coordinator.request({ source: "http-listener", error });
        return runtimeShutdown;
      },
    });

    await rollback.run(() => listener.ready);
    await listener.finished;
    const rawServer = rawNodeTransport(server);
    const signalShutdown = coordinator.request({
      source: "signal",
      signal: "SIGTERM",
    });

    try {
      assertEquals(cleanupCalls, 1);
      assertEquals(rawServer.emit("error", runtimeError), true);
      assertExists(runtimeShutdown);
      assertStrictEquals(runtimeShutdown, signalShutdown);
      assertEquals(runtimeFailureCalls, 1);
      assertEquals(reports.length, 1);
      assertStrictEquals(reports[0], runtimeError);
      assertEquals(coordinator.hasListenerFailure(), true);
    } finally {
      cleanupGate.resolve();
      await Promise.allSettled([signalShutdown, runtimeShutdown]);
      await server.close();
    }

    assertEquals(cleanupCalls, 1);
    assertEquals(rawServer.listenerCount("error"), 0);
  });

  it("fails closed when serve settles without onListen", async () => {
    const server = new FakeHttpServer(() => Promise.resolve());
    const listener = startProxyListener({
      server,
      handler,
      hostname: "127.0.0.1",
      port: 4_325,
      commitStartup: () => true,
      onRuntimeFailure: () => {},
    });

    await assertRejects(
      () => listener.ready,
      Error,
      "settled before reporting listener readiness",
    );
    await listener.finished;
    assertEquals(server.serveCalls, 1);
  });
});
