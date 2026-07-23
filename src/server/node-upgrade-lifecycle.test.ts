import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
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
