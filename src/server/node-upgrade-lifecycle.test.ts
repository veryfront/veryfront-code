import "#veryfront/schemas/_test-setup.ts";

import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type NodeUpgradeEventSource,
  NodeUpgradeLifecycle,
  type OwnedWebSocketServer,
} from "./node-upgrade-lifecycle.ts";

class FakeUpgradeSource implements NodeUpgradeEventSource {
  readonly listeners = new Set<(...args: unknown[]) => void>();

  on(_event: "upgrade", listener: (...args: unknown[]) => void): void {
    this.listeners.add(listener);
  }

  off(_event: "upgrade", listener: (...args: unknown[]) => void): void {
    this.listeners.delete(listener);
  }
}

describe("NodeUpgradeLifecycle", () => {
  it("removes the retained listener and closes sockets exactly once", async () => {
    const lifecycle = new NodeUpgradeLifecycle();
    const source = new FakeUpgradeSource();
    const listener = () => {};
    let terminateCalls = 0;
    let closeCalls = 0;
    const socketServer: OwnedWebSocketServer = {
      clients: [{ terminate: () => terminateCalls++ }],
      close(callback) {
        closeCalls++;
        callback();
      },
    };

    assertEquals(lifecycle.attach(source, listener), true);
    assertEquals(lifecycle.attach(source, () => {}), false);
    lifecycle.track(socketServer);
    assertEquals(source.listeners.size, 1);

    const firstDispose = lifecycle.dispose();
    const secondDispose = lifecycle.dispose();
    assertStrictEquals(firstDispose, secondDispose);
    await firstDispose;

    assertEquals(source.listeners.size, 0);
    assertEquals(terminateCalls, 1);
    assertEquals(closeCalls, 1);
    await lifecycle.dispose();
    assertEquals(terminateCalls, 1);
    assertEquals(closeCalls, 1);
  });

  it("closes clients that only expose close()", async () => {
    const lifecycle = new NodeUpgradeLifecycle();
    let closeOnlyCalls = 0;
    lifecycle.track({
      clients: [{ close: () => closeOnlyCalls++ }],
      close(callback) {
        callback();
      },
    });

    await lifecycle.dispose();

    assertEquals(
      closeOnlyCalls,
      1,
      "a client without terminate() must still be closed during retirement",
    );
  });

  it("refuses new work after disposal", async () => {
    const lifecycle = new NodeUpgradeLifecycle();
    const source = new FakeUpgradeSource();

    await lifecycle.dispose();

    assertEquals(lifecycle.isDisposed, true, "dispose must mark the lifecycle disposed");
    assertThrows(
      () => lifecycle.attach(source, () => {}),
      Error,
      "already disposed",
      "a disposed lifecycle must refuse to attach a new upgrade listener",
    );
    assertThrows(
      () =>
        lifecycle.track({
          close(callback) {
            callback();
          },
        }),
      Error,
      "already disposed",
      "a disposed lifecycle must refuse to track a new socket server",
    );
    assertThrows(
      () => lifecycle.trackSocket({ destroy() {} }),
      Error,
      "already disposed",
      "a disposed lifecycle must refuse to retain a new upgrade socket",
    );
    assertEquals(
      source.listeners.size,
      0,
      "a refused attach must not leave a listener on the shared server",
    );
  });

  it("attempts every close and aggregates cleanup failures", async () => {
    const lifecycle = new NodeUpgradeLifecycle();
    let successfulCloseCalls = 0;
    lifecycle.track({
      close(callback) {
        callback(new Error("first close failed"));
      },
    });
    lifecycle.track({
      close(callback) {
        successfulCloseCalls++;
        callback();
      },
    });

    const error = await assertRejects(
      () => lifecycle.dispose(),
      AggregateError,
      "Node WebSocket upgrade cleanup failed",
    );
    assertEquals((error as AggregateError).errors.length, 1);
    assertEquals(successfulCloseCalls, 1);
  });

  it("retains failed resources so a later dispose call can retry cleanup", async () => {
    const lifecycle = new NodeUpgradeLifecycle();
    let closeCalls = 0;
    lifecycle.track({
      close(callback) {
        closeCalls++;
        callback(closeCalls === 1 ? new Error("transient close failure") : undefined);
      },
    });

    await assertRejects(
      () => lifecycle.dispose(),
      AggregateError,
      "transient close failure",
    );
    await lifecycle.dispose();

    assertEquals(closeCalls, 2);
  });

  it("retires a failed initialization once and shares that work with disposal", async () => {
    const lifecycle = new NodeUpgradeLifecycle();
    const closeStarted = Promise.withResolvers<void>();
    const finishClose = Promise.withResolvers<void>();
    let closeCalls = 0;
    const server: OwnedWebSocketServer = {
      close(callback) {
        closeCalls++;
        closeStarted.resolve();
        void finishClose.promise.then(() => callback());
      },
    };
    lifecycle.track(server);

    const retirement = lifecycle.retire(server);
    assertStrictEquals(lifecycle.retire(server), retirement);
    await closeStarted.promise;
    const disposal = lifecycle.dispose();
    finishClose.resolve();
    await Promise.all([retirement, disposal]);

    assertEquals(closeCalls, 1);
    await lifecycle.dispose();
    assertEquals(closeCalls, 1);
  });

  it("retains a failed immediate retirement for disposal retry", async () => {
    const lifecycle = new NodeUpgradeLifecycle();
    let closeCalls = 0;
    const server: OwnedWebSocketServer = {
      close(callback) {
        closeCalls++;
        callback(closeCalls === 1 ? new Error("initial retirement failed") : undefined);
      },
    };
    lifecycle.track(server);

    await assertRejects(
      () => lifecycle.retire(server),
      Error,
      "initial retirement failed",
    );
    await lifecycle.dispose();

    assertEquals(closeCalls, 2);
  });

  it("destroys raw sockets whose handler handshake is still in flight", async () => {
    const lifecycle = new NodeUpgradeLifecycle();
    let destroyCalls = 0;
    const release = lifecycle.trackSocket({
      destroy() {
        destroyCalls++;
      },
    });

    await lifecycle.dispose();
    release();
    await lifecycle.dispose();

    assertEquals(destroyCalls, 1);
  });
});
