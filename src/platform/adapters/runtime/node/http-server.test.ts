import "#veryfront/schemas/_test-setup.ts";

import {
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createServer, request as nodeRequest, Server as NativeHttpServer } from "node:http";
import { createConnection } from "node:net";
import { isNode } from "#veryfront/platform/compat/runtime.ts";
import { createWebSocketUpgradeResponse } from "../../base.ts";
import { createNodeServer, createNodeServerWithStartupOwner, NodeServer } from "./http-server.ts";
import type { NodeHttpServer } from "./types.ts";
import { NodeServerAdapter } from "./websocket-adapter.ts";
import { WsNodeWebSocketServerProvider } from "../../../../../extensions/ext-node-websocket-ws/src/index.ts";
import { NODE_WEBSOCKET_SERVER_PROVIDER_PACKAGE } from "#veryfront/extensions/websocket";

function createHttpServer(
  close: NodeHttpServer["close"],
): NodeHttpServer {
  return {
    listen: () => {},
    close,
  };
}

function rawHttpTransport(server: object): ReturnType<typeof createServer> {
  return (server as { server: ReturnType<typeof createServer> }).server;
}

function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  detail: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(detail)), milliseconds);
    }),
  ]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  });
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("NodeServer lifecycle", () => {
  it("accepts the lowest and highest valid listener ports", async () => {
    if (!isNode) return;
    const listenDescriptor = Object.getOwnPropertyDescriptor(
      NativeHttpServer.prototype,
      "listen",
    );
    const addressDescriptor = Object.getOwnPropertyDescriptor(
      NativeHttpServer.prototype,
      "address",
    );
    const closeDescriptor = Object.getOwnPropertyDescriptor(
      NativeHttpServer.prototype,
      "close",
    );
    const originalListen = NativeHttpServer.prototype.listen;
    const originalAddress = NativeHttpServer.prototype.address;
    const originalClose = NativeHttpServer.prototype.close;
    const listenedPorts: number[] = [];
    let currentPort = 0;

    NativeHttpServer.prototype.listen = function (
      this: NativeHttpServer,
      port?: number,
    ): NativeHttpServer {
      currentPort = port ?? 0;
      listenedPorts.push(currentPort);
      queueMicrotask(() => this.emit("listening"));
      return this;
    } as typeof originalListen;
    NativeHttpServer.prototype.address = function () {
      return { address: "127.0.0.1", family: "IPv4", port: currentPort };
    } as typeof originalAddress;
    NativeHttpServer.prototype.close = function (
      this: NativeHttpServer,
      callback?: (error?: Error) => void,
    ): NativeHttpServer {
      queueMicrotask(() => {
        this.emit("close");
        callback?.();
      });
      return this;
    } as typeof originalClose;

    try {
      for (const port of [0, 65_535]) {
        const server = await createNodeServer(() => new Response("ok"), {
          hostname: "127.0.0.1",
          port,
        });
        assertEquals(server.addr.port, port);
        await server.stop();
      }
    } finally {
      if (listenDescriptor) {
        Object.defineProperty(NativeHttpServer.prototype, "listen", listenDescriptor);
      } else {
        Reflect.deleteProperty(NativeHttpServer.prototype, "listen");
      }
      if (addressDescriptor) {
        Object.defineProperty(NativeHttpServer.prototype, "address", addressDescriptor);
      } else {
        Reflect.deleteProperty(NativeHttpServer.prototype, "address");
      }
      if (closeDescriptor) {
        Object.defineProperty(NativeHttpServer.prototype, "close", closeDescriptor);
      } else {
        Reflect.deleteProperty(NativeHttpServer.prototype, "close");
      }
    }
    assertEquals(listenedPorts, [0, 65_535]);
  });

  it("rejects invalid listener ports with the exact validation message", async () => {
    for (const port of [-1, 65_536, 1.5]) {
      await assertRejects(
        () =>
          createNodeServer(() => new Response("unreachable"), {
            hostname: "127.0.0.1",
            port,
          }),
        RangeError,
        `Node server port must be an integer from 0 to 65535, got ${port}`,
      );
    }
  });

  it("shares shutdown and retries only the failed HTTP close phase", async () => {
    let upgradeDisposeCalls = 0;
    let closeCalls = 0;
    let transportDetachCalls = 0;
    const server = new NodeServer(
      createHttpServer((callback) => {
        closeCalls++;
        callback(closeCalls === 1 ? new Error("transient HTTP close failure") : undefined);
      }),
      "localhost",
      3_000,
      () => {
        upgradeDisposeCalls++;
      },
      () => {
        transportDetachCalls++;
      },
    );

    const first = server.stop();
    const concurrent = server.stop();
    assertStrictEquals(first, concurrent);
    await assertRejects(() => first, Error, "transient HTTP close failure");
    assertEquals(transportDetachCalls, 0);

    await server.stop();
    await server.stop();
    assertEquals(upgradeDisposeCalls, 1);
    assertEquals(closeCalls, 2);
    assertEquals(transportDetachCalls, 1);
  });

  it("does not close HTTP while upgrade resources failed to retire", async () => {
    let upgradeDisposeCalls = 0;
    let closeCalls = 0;
    const server = new NodeServer(
      createHttpServer((callback) => {
        closeCalls++;
        callback();
      }),
      "localhost",
      3_000,
      () => {
        upgradeDisposeCalls++;
        if (upgradeDisposeCalls === 1) throw new Error("upgrade cleanup failed");
      },
    );

    await assertRejects(() => server.stop(), Error, "upgrade cleanup failed");
    assertEquals(closeCalls, 0);

    await server.stop();
    assertEquals(upgradeDisposeCalls, 2);
    assertEquals(closeCalls, 1);
  });

  it("publishes one stop attempt before synchronous cleanup can re-enter", async () => {
    let upgradeDisposeCalls = 0;
    let closeCalls = 0;
    let reentrantStop: Promise<void> | undefined;
    const server = new NodeServer(
      createHttpServer((callback) => {
        closeCalls++;
        callback();
      }),
      "localhost",
      3_000,
      () => {
        upgradeDisposeCalls++;
        reentrantStop = server.stop();
      },
    );

    const stop = server.stop();
    await Promise.resolve();
    assertStrictEquals(reentrantStop, stop);
    await stop;

    assertEquals(upgradeDisposeCalls, 1);
    assertEquals(closeCalls, 1);
  });

  it("does not settle a pending close until Node emits close", async () => {
    const closeListeners = new Set<() => void>();
    const onceWrappers = new Map<() => void, () => void>();
    const closeStarted = createDeferred<void>();
    const notRunning = Object.assign(
      new Error("Server is not running"),
      { code: "ERR_SERVER_NOT_RUNNING" },
    );
    const transport: NodeHttpServer = {
      listen: () => {},
      once: (_event, listener) => {
        const onceListener = () => {
          closeListeners.delete(onceListener);
          onceWrappers.delete(listener);
          listener();
        };
        onceWrappers.set(listener, onceListener);
        closeListeners.add(onceListener);
        return transport;
      },
      off: (_event, listener) => {
        const onceListener = onceWrappers.get(listener);
        if (onceListener) closeListeners.delete(onceListener);
        onceWrappers.delete(listener);
        return transport;
      },
      close: (callback) => {
        closeStarted.resolve();
        callback(notRunning);
      },
    };
    const server = new NodeServer(transport, "localhost", 3_000);
    server.markListenStarted();
    let settled = false;
    const stopping = server.stop().then(() => {
      settled = true;
    });

    await closeStarted.promise;
    await Promise.resolve();
    assertEquals(settled, false);
    for (const listener of [...closeListeners]) listener();

    await stopping;
    await server.stop();

    assertEquals(closeListeners.size, 0);
  });

  it("does not wait for a close event that the owned transport already emitted", async () => {
    const rawServer = createServer();
    const server = new NodeServer(
      rawServer as unknown as NodeHttpServer,
      "127.0.0.1",
      0,
    );
    await new Promise<void>((resolve) => rawServer.listen(0, "127.0.0.1", resolve));
    await new Promise<void>((resolve, reject) => {
      rawServer.close((error) => error ? reject(error) : resolve());
    });

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      server.stop().then(() => "stopped" as const),
      new Promise<"timeout">((resolve) => {
        timeoutId = setTimeout(() => resolve("timeout"), 50);
      }),
    ]).finally(() => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    });

    assertEquals(outcome, "stopped");
  });

  it("accepts Bun's inherited not-running close result after binding", async () => {
    const prototype = Object.create(Error.prototype, {
      code: {
        value: "ERR_SERVER_NOT_RUNNING",
        writable: true,
        enumerable: true,
        configurable: true,
      },
    });
    const notRunning = Object.create(prototype) as Error;
    Object.defineProperty(notRunning, "message", {
      value: "Server is not running.",
      writable: true,
      configurable: true,
    });
    const server = new NodeServer(
      createHttpServer((callback) => callback(notRunning)),
      "127.0.0.1",
      3_000,
    );
    server.setListeningPort(3_000);

    await server.stop();
    await server.stop();
  });

  it("rejects startup without listening when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await assertRejects(
      () =>
        createNodeServer(() => new Response("ok"), {
          hostname: "127.0.0.1",
          port: 0,
          signal: controller.signal,
        }),
      DOMException,
      "aborted",
    );
  });

  it("rejects when the startup owner aborts before signal registration", async () => {
    const controller = new AbortController();
    const abortReason = new Error("owner canceled startup");
    let rawServer: NativeHttpServer | undefined;
    let onListenCalls = 0;
    let rejection: unknown;

    try {
      await createNodeServerWithStartupOwner(
        () => new Response("unreachable"),
        {
          hostname: "127.0.0.1",
          port: 0,
          signal: controller.signal,
          onListen: () => {
            onListenCalls++;
          },
        },
        (server) => {
          rawServer = rawHttpTransport(server);
          controller.abort(abortReason);
        },
      );
    } catch (error) {
      rejection = error;
    } finally {
      if (rawServer?.listening) {
        await new Promise<void>((resolve, reject) => {
          rawServer?.close((error) => error ? reject(error) : resolve());
        });
      }
    }

    assertStrictEquals(rejection, abortReason);
    assertEquals(onListenCalls, 0);
    assertEquals(rawServer?.listening, false);
  });

  it("rejects an invalid runtime-error callback before binding", async () => {
    let listened = false;
    let rejection: unknown;
    let started: Awaited<ReturnType<typeof createNodeServer>> | undefined;

    try {
      started = await createNodeServer(() => new Response("unreachable"), {
        hostname: "127.0.0.1",
        port: 0,
        onListen: () => {
          listened = true;
        },
        onRuntimeError: "invalid" as unknown as (error: Error) => void,
      });
    } catch (error) {
      rejection = error;
    } finally {
      await started?.stop();
    }

    assertEquals(rejection instanceof TypeError, true);
    assertEquals(listened, false);
  });

  it("rejects a listener startup error instead of leaving the promise pending", async () => {
    if (!isNode) return;
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const address = blocker.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected an IP listener address");
    }

    try {
      await assertRejects(
        () =>
          createNodeServer(() => new Response("ok"), {
            hostname: "127.0.0.1",
            port: address.port,
          }),
        Error,
        "EADDRINUSE",
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        blocker.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it("settles a synchronous listen validation failure without awaiting close", async () => {
    await assertRejects(
      () =>
        withTimeout(
          createNodeServer(() => new Response("unreachable"), {
            hostname: "127.0.0.1",
            port: -1,
          }),
          2_000,
          "Node startup waited for a close event after listen threw synchronously",
        ),
      RangeError,
    );
  });

  it("does not mark the transport pending before synchronous listen returns", async () => {
    const listenDescriptor = Object.getOwnPropertyDescriptor(
      NativeHttpServer.prototype,
      "listen",
    );
    const closeDescriptor = Object.getOwnPropertyDescriptor(
      NativeHttpServer.prototype,
      "close",
    );
    const originalListen = NativeHttpServer.prototype.listen;
    const originalClose = NativeHttpServer.prototype.close;
    const listenError = new Error("listen threw synchronously");
    const notRunning = Object.assign(
      new Error("Server is not running"),
      { code: "ERR_SERVER_NOT_RUNNING" },
    );
    let closeCalls = 0;

    NativeHttpServer.prototype.listen = function (): NativeHttpServer {
      throw listenError;
    } as typeof originalListen;
    NativeHttpServer.prototype.close = function (
      this: NativeHttpServer,
      callback?: (error?: Error) => void,
    ): NativeHttpServer {
      closeCalls++;
      callback?.(notRunning);
      return this;
    } as typeof originalClose;

    let rejection: unknown;
    try {
      try {
        await withTimeout(
          createNodeServer(() => new Response("unreachable"), {
            hostname: "127.0.0.1",
            port: 0,
          }),
          200,
          "Node startup waited for a close event after listen threw synchronously",
        );
      } catch (error) {
        rejection = error;
      }
    } finally {
      if (listenDescriptor) {
        Object.defineProperty(NativeHttpServer.prototype, "listen", listenDescriptor);
      } else {
        Reflect.deleteProperty(NativeHttpServer.prototype, "listen");
      }
      if (closeDescriptor) {
        Object.defineProperty(NativeHttpServer.prototype, "close", closeDescriptor);
      } else {
        Reflect.deleteProperty(NativeHttpServer.prototype, "close");
      }
    }

    assertStrictEquals(rejection, listenError);
    assertEquals(closeCalls, 1);
  });

  it("releases startup closures while retaining bounded late-outcome guards", async () => {
    if (!isNode) return;
    const listenDescriptor = Object.getOwnPropertyDescriptor(
      NativeHttpServer.prototype,
      "listen",
    );
    const originalListen = NativeHttpServer.prototype.listen;
    const ownerPublished = createDeferred<void>();
    const controller = new AbortController();
    const abortReason = new Error("cancel pending native listen");
    let rawServer: NativeHttpServer | undefined;

    NativeHttpServer.prototype.listen = function (
      this: NativeHttpServer,
    ): NativeHttpServer {
      return this;
    } as typeof originalListen;

    try {
      const startup = createNodeServerWithStartupOwner(
        () => new Response("unreachable"),
        {
          hostname: "pending-listen.veryfront.invalid",
          port: 0,
          signal: controller.signal,
        },
        (server) => {
          rawServer = rawHttpTransport(server);
          ownerPublished.resolve();
        },
      );
      await ownerPublished.promise;
      if (!rawServer) throw new Error("Node startup owner was not published");

      const startupErrorListeners = rawServer.listeners("error");
      const startupListeningListeners = rawServer.listeners("listening");
      assertEquals(startupErrorListeners.length, 1);
      assertEquals(startupListeningListeners.length > 0, true);

      controller.abort(abortReason);
      let rejection: unknown;
      try {
        await startup;
      } catch (error) {
        rejection = error;
      }
      assertStrictEquals(rejection, abortReason);

      const lateErrorListeners = rawServer.listeners("error");
      const lateListeningListeners = rawServer.listeners("listening");
      assertEquals(lateErrorListeners.length, 1, "expected one late error guard");
      assertEquals(
        lateListeningListeners.length,
        startupListeningListeners.length,
        "expected one late listening guard alongside Node's existing listeners",
      );
      assertEquals(
        lateErrorListeners.some((listener) => startupErrorListeners.includes(listener)),
        false,
        "startup error closure was retained",
      );
      assertEquals(
        lateListeningListeners.filter((listener) => !startupListeningListeners.includes(listener))
          .length,
        1,
        "late listening guard was not installed",
      );
      assertEquals(
        startupListeningListeners.filter((listener) => !lateListeningListeners.includes(listener))
          .length,
        1,
        "startup listening closure was retained",
      );

      assertEquals(rawServer.emit("error", new Error("late canceled bind")), true);
      assertEquals(rawServer.listenerCount("error"), 0);
      assertEquals(
        rawServer.listenerCount("listening"),
        startupListeningListeners.length - 1,
      );
    } finally {
      controller.abort(abortReason);
      if (listenDescriptor) {
        Object.defineProperty(NativeHttpServer.prototype, "listen", listenDescriptor);
      } else {
        Reflect.deleteProperty(NativeHttpServer.prototype, "listen");
      }
    }
  });

  it("preserves fail-fast listener semantics without a runtime callback", async () => {
    const server = await createNodeServer(() => new Response("ok"), {
      hostname: "127.0.0.1",
      port: 0,
    });
    const rawServer = rawHttpTransport(server);

    try {
      assertEquals(rawServer.listenerCount("error"), 0);
    } finally {
      await server.stop();
    }
  });

  it("rejects with the exact abort reason when onListen aborts startup", async () => {
    const controller = new AbortController();
    const abortReason = new Error("abort during onListen");
    let rejection: unknown;
    let started: Awaited<ReturnType<typeof createNodeServer>> | undefined;

    try {
      started = await createNodeServer(() => new Response("unreachable"), {
        hostname: "127.0.0.1",
        port: 0,
        signal: controller.signal,
        onListen: () => {
          controller.abort(abortReason);
        },
      });
    } catch (error) {
      rejection = error;
    } finally {
      await started?.stop();
    }

    assertStrictEquals(rejection, abortReason);
  });

  it("closes a listener that emits an error reentrantly during onListen", async () => {
    const ownEmitDescriptor = Object.getOwnPropertyDescriptor(
      NativeHttpServer.prototype,
      "emit",
    );
    const originalEmit = NativeHttpServer.prototype.emit;
    let rawServer: ReturnType<typeof createServer> | undefined;
    NativeHttpServer.prototype.emit = function (
      this: ReturnType<typeof createServer>,
      event: string | symbol,
      ...args: unknown[]
    ): boolean {
      if (event === "listening") {
        rawServer = this;
      }
      return Reflect.apply(originalEmit, this, [event, ...args]);
    } as typeof originalEmit;

    const runtimeError = new Error("error during onListen");
    let rejection: unknown;
    let runtimeReports = 0;
    let continuedAfterError = false;
    let listeningAfterSettlement = false;
    try {
      try {
        await createNodeServer(() => new Response("unreachable"), {
          hostname: "127.0.0.1",
          port: 0,
          onListen: () => {
            if (!rawServer) throw new Error("Native Node listener was not captured");
            rawServer.emit("error", runtimeError);
            continuedAfterError = true;
          },
          onRuntimeError: () => {
            runtimeReports++;
          },
        });
      } catch (error) {
        rejection = error;
      }
    } finally {
      if (ownEmitDescriptor) {
        Object.defineProperty(
          NativeHttpServer.prototype,
          "emit",
          ownEmitDescriptor,
        );
      } else {
        Reflect.deleteProperty(NativeHttpServer.prototype, "emit");
      }
      listeningAfterSettlement = rawServer?.listening ?? false;
      if (rawServer?.listening) {
        await new Promise<void>((resolve, reject) => {
          rawServer?.close((error) => error ? reject(error) : resolve());
        });
      }
    }

    assertStrictEquals(rejection, runtimeError);
    assertEquals(runtimeReports, 0);
    assertEquals(continuedAfterError, false);
    assertEquals(listeningAfterSettlement, false);
    assertEquals(rawServer?.listenerCount("error"), 0);
  });

  it("keeps a reentrant transport error terminal when onListen catches it", async () => {
    const runtimeError = new Error("caught error during onListen");
    let rawServer: NativeHttpServer | undefined;
    let caughtError: unknown;
    let continuedAfterError = false;
    let rejection: unknown;
    let started: Awaited<ReturnType<typeof createNodeServer>> | undefined;

    try {
      started = await createNodeServerWithStartupOwner(
        () => new Response("unreachable"),
        {
          hostname: "127.0.0.1",
          port: 0,
          onListen: () => {
            if (!rawServer) throw new Error("Native Node listener was not captured");
            try {
              rawServer.emit("error", runtimeError);
            } catch (error) {
              caughtError = error;
            }
            continuedAfterError = true;
          },
        },
        (server) => {
          rawServer = rawHttpTransport(server);
        },
      );
    } catch (error) {
      rejection = error;
    } finally {
      await started?.stop();
      if (rawServer?.listening) {
        await new Promise<void>((resolve, reject) => {
          rawServer?.close((error) => error ? reject(error) : resolve());
        });
      }
    }

    assertStrictEquals(caughtError, runtimeError);
    assertEquals(continuedAfterError, true);
    assertStrictEquals(rejection, runtimeError);
    assertEquals(rawServer?.listening, false);
  });

  it("routes a post-readiness transport error once and detaches the route on stop", async () => {
    const runtimeError = new Error("late Node listener failure");
    const reported: Error[] = [];
    const server = await createNodeServer(() => new Response("ok"), {
      hostname: "127.0.0.1",
      port: 0,
      onRuntimeError: (error) => {
        reported.push(error);
      },
    });
    const rawServer = rawHttpTransport(server);

    try {
      assertEquals(rawServer.listenerCount("error"), 1);
      assertEquals(rawServer.emit("error", runtimeError), true);
      assertEquals(reported.length, 1);
      assertStrictEquals(reported[0], runtimeError);
    } finally {
      await server.stop();
    }

    assertEquals(rawServer.listenerCount("error"), 0);
  });

  it("contains synchronous and asynchronous runtime callback failures", async () => {
    let callbackCalls = 0;
    const server = await createNodeServer(() => new Response("ok"), {
      hostname: "127.0.0.1",
      port: 0,
      onRuntimeError: () => {
        callbackCalls++;
        if (callbackCalls === 1) throw new Error("synchronous callback failure");
        return Promise.reject(new Error("asynchronous callback failure"));
      },
    });
    const rawServer = rawHttpTransport(server);

    try {
      assertEquals(rawServer.emit("error", new Error("first transport failure")), true);
      assertEquals(rawServer.emit("error", new Error("second transport failure")), true);
      await new Promise((resolve) => setTimeout(resolve, 0));
      assertEquals(callbackCalls, 2);
    } finally {
      await server.stop();
    }
  });

  it("destroys an upgrade that the request handler did not authorize", async () => {
    if (!isNode) return;
    let handlerCalls = 0;
    const server = await createNodeServer(() => {
      handlerCalls++;
      return new Response("forbidden", { status: 403 });
    }, {
      hostname: "127.0.0.1",
      port: 0,
    });

    try {
      assertNotEquals(server.addr.port, 0);
      const socket = createConnection({ host: "127.0.0.1", port: server.addr.port });
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });
      socket.write(
        "GET /_ws HTTP/1.1\r\n" +
          "Host: 127.0.0.1\r\n" +
          "Connection: Upgrade\r\n" +
          "Upgrade: websocket\r\n" +
          "Sec-WebSocket-Version: 13\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
      );
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Unauthorized upgrade socket remained open")),
          1_000,
        );
        socket.once("close", () => {
          clearTimeout(timeout);
          resolve();
        });
        socket.once("error", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      assertEquals(handlerCalls, 1);
    } finally {
      await server.stop();
    }
  });

  it("fails an authorized upgrade closed when no Node WebSocket provider is configured", async () => {
    const adapter = new NodeServerAdapter();
    const applicationFailure = createDeferred<Error>();
    const applicationClose = createDeferred<void>();
    const server = await createNodeServer((request) => {
      const upgrade = adapter.upgradeWebSocket(request);
      upgrade.socket.addEventListener("error", (event) => {
        const error = (event as ErrorEvent).error;
        applicationFailure.resolve(
          error instanceof Error ? error : new Error(String(error)),
        );
      }, { once: true });
      upgrade.socket.addEventListener("close", () => applicationClose.resolve(), {
        once: true,
      });
      return upgrade.response;
    }, {
      hostname: "127.0.0.1",
      port: 0,
    });
    const socket = createConnection({ host: "127.0.0.1", port: server.addr.port });

    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });
      const transportClosed = new Promise<void>((resolve) => {
        socket.once("close", () => resolve());
      });
      socket.write(
        "GET /_ws HTTP/1.1\r\n" +
          "Host: 127.0.0.1\r\n" +
          "Connection: Upgrade\r\n" +
          "Upgrade: websocket\r\n" +
          "Sec-WebSocket-Version: 13\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
      );

      const error = await withTimeout(
        applicationFailure.promise,
        1_000,
        "Missing-provider failure did not reach the application socket",
      );
      assertStringIncludes(error.message, NODE_WEBSOCKET_SERVER_PROVIDER_PACKAGE);
      await withTimeout(
        applicationClose.promise,
        1_000,
        "Missing-provider application socket remained open",
      );
      if (isNode) {
        await withTimeout(
          transportClosed,
          1_000,
          "Missing-provider transport socket remained open",
        );
      }
    } finally {
      socket.destroy();
      await server.stop();
    }
  });

  it("retires an attach-failing provider server without reusing it", async () => {
    const adapter = new NodeServerAdapter();
    const outcomes = [createDeferred<Error>(), createDeferred<Error>()];
    const retirements = [createDeferred<void>(), createDeferred<void>()];
    let handlerCalls = 0;
    let createCalls = 0;
    let closeCalls = 0;
    let handleUpgradeCalls = 0;
    const provider = {
      createServer() {
        const generation = createCalls++;
        const candidate = {
          clients: new Set<never>(),
          on() {
            throw new Error(`attach failed for generation ${generation}`);
          },
          close(callback?: (error?: Error) => void) {
            closeCalls++;
            callback?.();
            retirements[generation]?.resolve();
          },
          handleUpgrade() {
            handleUpgradeCalls++;
          },
          emit() {},
        };
        return candidate;
      },
    };
    const server = await createNodeServer((request) => {
      const call = handlerCalls++;
      const upgrade = adapter.upgradeWebSocket(request);
      upgrade.socket.addEventListener("error", (event) => {
        const error = (event as ErrorEvent).error;
        outcomes[call]?.resolve(
          error instanceof Error ? error : new Error(String(error)),
        );
      }, { once: true });
      return upgrade.response;
    }, {
      hostname: "127.0.0.1",
      port: 0,
      nodeWebSocketServerProvider: provider,
    });

    try {
      for (let generation = 0; generation < outcomes.length; generation++) {
        const socket = createConnection({ host: "127.0.0.1", port: server.addr.port });
        try {
          await new Promise<void>((resolve, reject) => {
            socket.once("connect", resolve);
            socket.once("error", reject);
          });
          socket.write(
            "GET /_ws HTTP/1.1\r\n" +
              "Host: 127.0.0.1\r\n" +
              "Connection: Upgrade\r\n" +
              "Upgrade: websocket\r\n" +
              "Sec-WebSocket-Version: 13\r\n" +
              "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
          );

          const error = await withTimeout(
            outcomes[generation]!.promise,
            1_000,
            "Attach failure did not reach the application socket",
          );
          assertStringIncludes(error.message, `attach failed for generation ${generation}`);
          await withTimeout(
            retirements[generation]!.promise,
            1_000,
            "Attach-failing server was not retired",
          );
        } finally {
          socket.destroy();
        }
      }

      assertEquals([handlerCalls, createCalls, closeCalls, handleUpgradeCalls], [2, 2, 2, 0]);
    } finally {
      await server.stop();
    }
  });

  it("owns and terminates authorized WebSocket clients during stop", async () => {
    if (!isNode) return;
    const adapter = new NodeServerAdapter();
    const server = await createNodeServer((request) => {
      return adapter.upgradeWebSocket(request).response;
    }, {
      hostname: "127.0.0.1",
      port: 0,
      nodeWebSocketServerProvider: WsNodeWebSocketServerProvider,
    });
    const { WebSocket } = await import("ws");
    const client = new WebSocket(`ws://127.0.0.1:${server.addr.port}/_ws`);

    try {
      await new Promise<void>((resolve, reject) => {
        client.once("open", resolve);
        client.once("error", reject);
      });
      const closed = new Promise<void>((resolve) => client.once("close", () => resolve()));

      await server.stop();
      await closed;

      assertEquals(client.readyState, WebSocket.CLOSED);
    } finally {
      if (client.readyState !== WebSocket.CLOSED) client.terminate();
      await server.stop();
    }
  });

  it("honors the application's selected protocol and handshake headers on the wire", async () => {
    if (!isNode) return;
    const adapter = new NodeServerAdapter();
    const server = await createNodeServer((request) => {
      return adapter.upgradeWebSocket(request, {
        protocol: "hmr",
        headers: { "x-veryfront-handshake": "accepted" },
        idleTimeout: 0,
      }).response;
    }, {
      hostname: "127.0.0.1",
      port: 0,
      nodeWebSocketServerProvider: WsNodeWebSocketServerProvider,
    });
    const { WebSocket } = await import("ws");
    const client = new WebSocket(
      `ws://127.0.0.1:${server.addr.port}/_ws`,
      ["chat", "hmr"],
    );
    let handshakeHeader: string | string[] | undefined;
    client.once("upgrade", (response: import("node:http").IncomingMessage) => {
      handshakeHeader = response.headers["x-veryfront-handshake"];
    });

    try {
      await new Promise<void>((resolve, reject) => {
        client.once("open", resolve);
        client.once("error", reject);
      });

      assertEquals(client.protocol, "hmr");
      assertEquals(handshakeHeader, "accepted");
    } finally {
      if (client.readyState !== WebSocket.CLOSED) client.terminate();
      await server.stop();
    }
  });

  it("does not negotiate a client protocol unless the application selects it", async () => {
    if (!isNode) return;
    const adapter = new NodeServerAdapter();
    const server = await createNodeServer((request) => {
      return adapter.upgradeWebSocket(request).response;
    }, {
      hostname: "127.0.0.1",
      port: 0,
      nodeWebSocketServerProvider: WsNodeWebSocketServerProvider,
    });
    const socket = createConnection({ host: "127.0.0.1", port: server.addr.port });

    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });

      const responseHeaders = new Promise<string>((resolve, reject) => {
        let received = "";
        const timeout = setTimeout(
          () => reject(new Error("WebSocket handshake response timed out")),
          1_000,
        );
        socket.on("data", (chunk) => {
          received += chunk.toString();
          const end = received.indexOf("\r\n\r\n");
          if (end === -1) return;
          clearTimeout(timeout);
          resolve(received.slice(0, end));
        });
        socket.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
      socket.write(
        "GET /_ws HTTP/1.1\r\n" +
          "Host: 127.0.0.1\r\n" +
          "Connection: Upgrade\r\n" +
          "Upgrade: websocket\r\n" +
          "Sec-WebSocket-Version: 13\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
          "Sec-WebSocket-Protocol: chat, hmr\r\n\r\n",
      );

      const headers = (await responseHeaders).toLowerCase();
      assertEquals(headers.includes("101 switching protocols"), true);
      assertEquals(headers.includes("sec-websocket-protocol:"), false);
    } finally {
      socket.destroy();
      await server.stop();
    }
  });

  it("does not upgrade a forged sentinel without a registered application socket", async () => {
    if (!isNode) return;
    const server = await createNodeServer(
      () => createWebSocketUpgradeResponse(),
      {
        hostname: "127.0.0.1",
        port: 0,
      },
    );
    const socket = createConnection({ host: "127.0.0.1", port: server.addr.port });
    let received = "";

    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });
      socket.on("data", (chunk) => {
        received += chunk.toString();
      });
      socket.write(
        "GET /_ws HTTP/1.1\r\n" +
          "Host: 127.0.0.1\r\n" +
          "Connection: Upgrade\r\n" +
          "Upgrade: websocket\r\n" +
          "Sec-WebSocket-Version: 13\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
      );
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Forged upgrade socket remained open")),
          1_000,
        );
        socket.once("close", () => {
          clearTimeout(timeout);
          resolve();
        });
        socket.once("error", () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      assertEquals(received.includes("101 Switching Protocols"), false);
    } finally {
      socket.destroy();
      await server.stop();
    }
  });

  it("returns an HTTP error instead of hanging on an upgrade sentinel in a normal request", async () => {
    if (!isNode) return;
    const server = await createNodeServer(
      () => createWebSocketUpgradeResponse(),
      {
        hostname: "127.0.0.1",
        port: 0,
      },
    );

    try {
      const response = await fetch(`http://127.0.0.1:${server.addr.port}/not-an-upgrade`);
      assertEquals(response.status, 500);
      assertEquals(await response.text(), "Internal Server Error");
    } finally {
      await server.stop();
    }
  });

  it("force-closes an active HTTP connection so shutdown cannot deadlock", async () => {
    if (!isNode) return;
    const handlerStarted = createDeferred<void>();
    const requestAborted = createDeferred<void>();
    const server = await createNodeServer(async (request) => {
      handlerStarted.resolve();
      if (request.signal.aborted) requestAborted.resolve();
      else request.signal.addEventListener("abort", () => requestAborted.resolve(), { once: true });
      await requestAborted.promise;
      return new Response("too late");
    }, {
      hostname: "127.0.0.1",
      port: 0,
    });
    const client = nodeRequest({
      host: "127.0.0.1",
      port: server.addr.port,
      path: "/never-finishes",
    });
    client.on("error", () => {});
    client.end();

    try {
      await handlerStarted.promise;
      const stopped = server.stop().then(() => true);
      const completedBeforeDeadline = await Promise.race([
        stopped,
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 250)),
      ]);

      assertEquals(completedBeforeDeadline, true);
      await requestAborted.promise;
    } finally {
      client.destroy();
      await server.stop();
    }
  });

  it("aborts the Fetch request when the HTTP client disconnects", async () => {
    if (!isNode) return;
    const handlerStarted = createDeferred<void>();
    const requestAborted = createDeferred<void>();
    const server = await createNodeServer(async (request) => {
      handlerStarted.resolve();
      if (request.signal.aborted) requestAborted.resolve();
      else request.signal.addEventListener("abort", () => requestAborted.resolve(), { once: true });
      await requestAborted.promise;
      return new Response("too late");
    }, {
      hostname: "127.0.0.1",
      port: 0,
    });
    const client = nodeRequest({
      host: "127.0.0.1",
      port: server.addr.port,
      path: "/slow",
    });
    client.on("error", () => {});
    client.end();

    try {
      await handlerStarted.promise;
      client.destroy();
      await requestAborted.promise;
    } finally {
      client.destroy();
      await server.stop();
    }
  });

  it("waits for response drain and cancels the body when the client disconnects", async () => {
    if (!isNode) return;
    const totalChunks = 256;
    let producedChunks = 0;
    const bodyCancelled = createDeferred<void>();
    const server = await createNodeServer(() =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (producedChunks >= totalChunks) {
              controller.close();
              return;
            }
            producedChunks++;
            controller.enqueue(new Uint8Array(64 * 1024));
          },
          cancel() {
            bodyCancelled.resolve();
          },
        }),
      ), {
      hostname: "127.0.0.1",
      port: 0,
    });
    const client = nodeRequest({
      host: "127.0.0.1",
      port: server.addr.port,
      path: "/stream",
    });
    client.on("error", () => {});
    const responseReceived = new Promise<import("node:http").IncomingMessage>((resolve) => {
      client.once("response", (response) => {
        response.pause();
        resolve(response);
      });
    });
    client.end();

    try {
      const response = await responseReceived;
      await new Promise((resolve) => setTimeout(resolve, 50));
      assertEquals(producedChunks < totalChunks, true);

      response.destroy();
      client.destroy();
      await bodyCancelled.promise;
    } finally {
      client.destroy();
      await server.stop();
    }
  });
});
