import { FakeTime } from "#std/testing/time";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  createRoutingRedisClient,
  type RoutingRedisClientOptions,
} from "./routing-redis-client.ts";

function fixture() {
  type Instance = {
    ready: boolean;
    options: RoutingRedisClientOptions;
    listeners: Map<string, Array<(error?: unknown) => void>>;
    active: Set<string>;
    deliveries: Map<string, (message: string, channel: string) => void>;
    retirements: Array<() => void>;
    pendingSubscriptions: Array<() => void>;
  };
  const instances: Instance[] = [];
  const calls: string[] = [];
  let deferred = false;
  let deferredChannel: string | undefined;
  let deferredSubscribe: string | undefined;
  let failSubscribe = false;
  let failUnsubscribe = false;
  let failDestroy = false;
  const owned = createRoutingRedisClient((options) => {
    const instance: Instance = {
      ready: false,
      options,
      listeners: new Map(),
      active: new Set(),
      deliveries: new Map(),
      retirements: [],
      pendingSubscriptions: [],
    };
    instances.push(instance);
    return {
      get isReady() {
        return instance.ready;
      },
      connect: () => {
        calls.push("connect");
        return Promise.resolve();
      },
      publish: () => {
        calls.push("publish");
        return Promise.resolve(2);
      },
      subscribe: (channel, listener) => {
        instance.active.add(channel);
        instance.deliveries.set(channel, listener);
        calls.push("subscribe");
        if (failSubscribe) return Promise.reject(new Error("Uncertain subscribe result"));
        if (deferredSubscribe === channel) {
          return new Promise<void>((resolve) => instance.pendingSubscriptions.push(resolve));
        }
        return Promise.resolve();
      },
      unsubscribe: (channel) => {
        calls.push("unsubscribe");
        if (failUnsubscribe) return Promise.reject(new Error("Unsubscribe refused"));
        if (deferred && (deferredChannel === undefined || deferredChannel === channel)) {
          return new Promise<void>((resolve) =>
            instance.retirements.push(() => {
              instance.active.delete(channel);
              resolve();
            })
          );
        }
        instance.active.delete(channel);
        return Promise.resolve();
      },
      close: () => {
        calls.push("close");
        instance.ready = false;
        instance.active.clear();
      },
      destroy: () => {
        calls.push("destroy");
        if (failDestroy) throw new Error("Disposal refused");
        instance.ready = false;
        instance.active.clear();
      },
      on(event, listener) {
        const listeners = instance.listeners.get(event) ?? [];
        listeners.push(listener);
        instance.listeners.set(event, listeners);
      },
    };
  }, "redis://127.0.0.1:1");
  const current = () => instances.at(-1)!;
  return {
    owned,
    calls,
    instances,
    get active() {
      return current().active;
    },
    get options() {
      return current().options;
    },
    failDisposal() {
      failUnsubscribe = true;
      failDestroy = true;
    },
    failSubscribe() {
      failSubscribe = true;
    },
    refuseRetirement() {
      failUnsubscribe = true;
    },
    allowRetirement() {
      failUnsubscribe = false;
      deferred = false;
    },
    deferSubscription(channel: string) {
      deferredSubscribe = channel;
    },
    finishSubscription(index = instances.length - 1) {
      const finish = instances[index]!.pendingSubscriptions.shift();
      assert(finish);
      finish();
    },
    deferRetirement(channel?: string) {
      deferred = true;
      deferredChannel = channel;
    },
    finishRetirement(index = instances.length - 1) {
      const finish = instances[index]!.retirements.shift();
      assert(finish);
      finish();
    },
    emit(event: string, index = instances.length - 1, preserveReady = false) {
      const instance = instances[index]!;
      if (event === "ready") instance.ready = true;
      else if (
        (event === "error" && !preserveReady) || event === "reconnecting" || event === "end"
      ) instance.ready = false;
      for (const listener of instance.listeners.get(event) ?? []) {
        listener(
          new Error("Synthetic Redis event"),
        );
      }
    },
    deliver(index: number, channel: string) {
      instances[index]!.deliveries.get(channel)?.("synthetic", channel);
    },
  };
}

it("bounds initial connection attempts but keeps one capped recovery owner after readiness", () => {
  const f = fixture();
  assert(f.options.socket.reconnectStrategy(5) instanceof Error);
  assertEquals(f.options.socket.connectTimeout, 3_000);
  assertEquals(f.options.disableOfflineQueue, true);
  f.emit("ready");
  for (const attempt of [5, 50, Number.MAX_SAFE_INTEGER]) {
    assertEquals(f.options.socket.reconnectStrategy(attempt), 1_000);
  }
});
it("refuses routing and acknowledgement work offline without adding underlying commands", async () => {
  const f = fixture();
  await f.owned.connect();
  await assertRejects(() => f.owned.subscribe("ack", () => {}), Error, "not ready");
  f.emit("ready");
  assertEquals(await f.owned.publish("event", "synthetic"), 2);
  await f.owned.subscribe("ack", () => {});
  f.emit("reconnecting");
  await assertRejects(() => f.owned.publish("event", "synthetic"), Error, "not ready");
  await assertRejects(() => f.owned.subscribe("ack", () => {}), Error, "not ready");
  await assertRejects(() => f.owned.unsubscribe("ack"), Error, "not ready");
  assertEquals(f.calls, ["connect", "publish", "subscribe"]);
  f.emit("ready");
  await settle();
  await f.owned.subscribe("ack", () => {});
  assertEquals(f.calls, ["connect", "publish", "subscribe", "unsubscribe", "subscribe"]);
});
it("intentional close suppresses late ready events, recovery and new work", async () => {
  const f = fixture();
  f.emit("ready");
  f.emit("error");
  await f.owned.close();
  await f.owned.close();
  f.emit("ready");
  assert(f.options.socket.reconnectStrategy(0) instanceof Error);
  await assertRejects(() => f.owned.connect(), Error, "stopped");
  await assertRejects(() => f.owned.publish("event", "synthetic"), Error, "not ready");
  assertEquals(f.calls, ["destroy"]);
});

async function settle() {
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
}
it("retires a disconnected ACK before accepting same-channel subscribe or routing work", async () => {
  const f = fixture();
  f.emit("ready");
  await f.owned.subscribe("ack", () => {});
  f.emit("error");
  await assertRejects(() => f.owned.unsubscribe("ack"), Error, "not ready");
  assertEquals(f.calls, ["subscribe"]);
  f.deferRetirement();
  f.emit("ready");
  await assertRejects(() => f.owned.subscribe("ack", () => {}), Error, "not ready");
  await assertRejects(() => f.owned.publish("event", "synthetic"), Error, "not ready");
  assert(f.active.has("ack"));
  f.finishRetirement();
  await settle();
  assert(!f.active.has("ack"));
  await f.owned.subscribe("ack", () => {});
  assertEquals(f.calls, ["subscribe", "unsubscribe", "subscribe"]);
  await f.owned.close();
});
it("shares retirement across callers and serializes a new ready epoch behind the old command", async () => {
  const f = fixture();
  f.emit("ready");
  await f.owned.subscribe("ack", () => {});
  f.deferRetirement();
  const first = f.owned.unsubscribe("ack").catch(() => {});
  const second = f.owned.unsubscribe("ack").catch(() => {});
  assertEquals(f.calls, ["subscribe", "unsubscribe"]);
  f.emit("error");
  f.emit("ready");
  assertEquals(f.calls, ["subscribe", "unsubscribe"]);
  f.finishRetirement();
  await settle();
  assertEquals(f.calls, ["subscribe", "unsubscribe", "unsubscribe"]);
  await assertRejects(() => f.owned.publish("event", "synthetic"), Error, "not ready");
  f.finishRetirement();
  await settle();
  await Promise.all([first, second]);
  await f.owned.publish("event", "synthetic");
  await f.owned.close();
});
it("resets a timed-out retirement and restores only acknowledged live subscriptions", async () => {
  const time = new FakeTime();
  try {
    const f = fixture();
    let delivered = 0;
    f.emit("ready");
    await f.owned.subscribe("main", () => delivered++);
    await f.owned.subscribe("ack", () => {});
    f.deferRetirement("ack");
    const retiring = f.owned.unsubscribe("ack").catch(() => {});
    time.tick(3_000);
    await settle();
    await retiring;
    assertEquals(f.instances.length, 1);
    assert(!f.instances[0]!.ready);
    time.tick(999);
    assertEquals(f.instances.length, 1);
    time.tick(1);
    await settle();
    assertEquals(f.instances.length, 2);
    f.emit("ready");
    await settle();
    assertEquals([...f.active], ["main"]);
    assertEquals(await f.owned.publish("event", "synthetic"), 2);
    f.deliver(0, "main");
    assertEquals(delivered, 0);
    f.deliver(1, "main");
    assertEquals(delivered, 1);
    f.finishRetirement(0);
    f.emit("ready", 0);
    await settle();
    assertEquals(f.instances.length, 2);
    await f.owned.close();
  } finally {
    time.restore();
  }
});
it("close during an unsettled retirement destroys instead of waiting on raw close", async () => {
  const f = fixture();
  f.emit("ready");
  await f.owned.subscribe("ack", () => {});
  f.deferRetirement();
  const retiring = f.owned.unsubscribe("ack").catch(() => {});
  await f.owned.close();
  await retiring;
  assertEquals(f.calls, ["subscribe", "unsubscribe", "destroy"]);
  f.finishRetirement();
  f.emit("ready");
  await settle();
  await assertRejects(() => f.owned.subscribe("ack", () => {}), Error, "not ready");
});
it("caps owned and retiring subscriptions before any additional raw listener is registered", async () => {
  const f = fixture();
  f.emit("ready");
  for (let index = 0; index < 512; index++) await f.owned.subscribe(`channel-${index}`, () => {});
  await assertRejects(() => f.owned.subscribe("excess", () => {}), Error, "capacity exhausted");
  await assertRejects(() => f.owned.subscribe("channel-0", () => {}), Error, "already owned");
  assertEquals(f.active.size, 512);
  assertEquals(f.calls.length, 512);
  f.emit("error");
  await assertRejects(() => f.owned.unsubscribe("channel-0"), Error, "not ready");
  for (let index = 0; index < 600; index++) await f.owned.unsubscribe(`unknown-${index}`);
  assertEquals(f.calls.length, 512);
  await f.owned.close();
  assertEquals(f.calls.at(-1), "destroy");
});

it("reserves uncertain subscriptions and defers facade ready observers until retirement confirms", async () => {
  const f = fixture();
  let readyObserved = 0;
  Reflect.apply(f.owned.on, f.owned, ["ready", () => readyObserved++]);
  f.emit("ready");
  assertEquals(readyObserved, 1);
  f.failSubscribe();
  f.deferRetirement();
  await assertRejects(
    () => f.owned.subscribe("ack", () => {}),
    Error,
    "Uncertain subscribe result",
  );
  assertEquals(f.calls, ["subscribe", "unsubscribe"]);
  assertEquals(readyObserved, 1);
  await assertRejects(() => f.owned.publish("event", "synthetic"), Error, "not ready");
  f.finishRetirement();
  await settle();
  assert(!f.active.has("ack"));
  assertEquals(readyObserved, 2);
  await f.owned.publish("event", "synthetic");
  await f.owned.close();
});

it("contains secondary disposal errors from background retirement and stays unavailable", async () => {
  const f = fixture();
  f.emit("ready");
  f.failSubscribe();
  f.failDisposal();
  await assertRejects(
    () => f.owned.subscribe("ack", () => {}),
    Error,
    "Uncertain subscribe result",
  );
  await settle();
  assertEquals(f.calls, ["subscribe", "unsubscribe", "destroy"]);
  f.emit("ready");
  await settle();
  await assertRejects(() => f.owned.publish("event", "synthetic"), Error, "not ready");
  await assertRejects(() => f.owned.subscribe("ack", () => {}), Error, "not ready");
  assert(f.options.socket.reconnectStrategy(0) instanceof Error);
  await f.owned.close();
});

it("does not lose a retirement admitted as the previous drain is completing", async () => {
  for (let turns = 0; turns < 16; turns++) {
    const f = fixture();
    f.emit("ready");
    await f.owned.subscribe("a", () => {});
    await f.owned.subscribe("b", () => {});
    f.deferRetirement("a");
    const a = f.owned.unsubscribe("a");
    f.finishRetirement();
    for (let turn = 0; turn < turns; turn++) await Promise.resolve();
    try {
      await f.owned.unsubscribe("b");
      await a;
      assert(!f.active.has("a") && !f.active.has("b"));
      await f.owned.publish("event", "synthetic");
    } finally {
      await f.owned.close();
    }
  }
});
it("keeps unrelated publications available during confirmed online channel cleanup", async () => {
  const f = fixture();
  f.emit("ready");
  await f.owned.subscribe("a", () => {});
  f.deferRetirement("a");
  const retiring = f.owned.unsubscribe("a").catch(() => {});
  try {
    await f.owned.subscribe("b", () => {});
    assertEquals(await f.owned.publish("event", "synthetic"), 2);
    await assertRejects(() => f.owned.subscribe("a", () => {}), Error, "already owned");
    f.finishRetirement();
    await retiring;
    await f.owned.subscribe("a", () => {});
  } finally {
    await f.owned.close();
  }
});
it("confirms the original retirement when a ready observer immediately reuses its channel", async () => {
  const f = fixture();
  f.emit("ready");
  await f.owned.subscribe("a", () => {});
  f.emit("error");
  await assertRejects(() => f.owned.unsubscribe("a"), Error, "not ready");
  f.deferRetirement("a");
  f.emit("ready");
  const confirming = f.owned.unsubscribe("a");
  let reused: Promise<void> | undefined;
  Reflect.apply(f.owned.on, f.owned, ["ready", () => {
    reused = f.owned.subscribe("a", () => {});
  }]);
  f.finishRetirement();
  try {
    await confirming;
    assert(reused);
    await reused;
    assert(f.active.has("a"));
  } finally {
    await f.owned.close();
  }
});

it("does not poison a usable transport for a decoder error", async () => {
  const f = fixture();
  f.emit("ready");
  f.emit("error", 0, true);
  assertEquals(await f.owned.publish("event", "synthetic"), 2);
  await f.owned.subscribe("main", () => {});
  await f.owned.close();
});
it("resets a retirement protocol refusal at a capped cadence and fences old callbacks", async () => {
  const time = new FakeTime();
  try {
    const f = fixture();
    f.emit("ready");
    await f.owned.subscribe("main", () => {});
    await f.owned.subscribe("ack", () => {});
    f.refuseRetirement();
    await f.owned.unsubscribe("ack");
    await settle();
    assertEquals(f.instances.length, 1);
    await assertRejects(() => f.owned.publish("event", "synthetic"), Error, "not ready");
    f.allowRetirement();
    time.tick(1_000);
    await settle();
    f.emit("ready");
    await settle();
    assertEquals([...f.active], ["main"]);
    assertEquals(await f.owned.publish("event", "synthetic"), 2);
    f.emit("error", 0);
    assertEquals(await f.owned.publish("event", "synthetic"), 2);
    await f.owned.close();
  } finally {
    time.restore();
  }
});
it("does not restore an unacknowledged subscription or admit its stale completion", async () => {
  const time = new FakeTime();
  try {
    const f = fixture();
    f.emit("ready");
    await f.owned.subscribe("main", () => {});
    await f.owned.subscribe("ack", () => {});
    f.deferSubscription("uncertain");
    const pending = f.owned.subscribe("uncertain", () => {}).catch((e) => e);
    f.deferRetirement("ack");
    const retiring = f.owned.unsubscribe("ack").catch(() => {});
    time.tick(3_000);
    await settle();
    await retiring;
    time.tick(1_000);
    await settle();
    f.emit("ready");
    await settle();
    assertEquals([...f.active], ["main"]);
    f.finishSubscription(0);
    assert((await pending) instanceof Error);
    assertEquals([...f.active], ["main"]);
    await f.owned.close();
  } finally {
    time.restore();
  }
});
it("shutdown during reset prevents the replacement constructor and late ready work", async () => {
  const time = new FakeTime();
  try {
    const f = fixture();
    f.emit("ready");
    await f.owned.subscribe("ack", () => {});
    f.refuseRetirement();
    await f.owned.unsubscribe("ack");
    await f.owned.close();
    time.tick(5_000);
    await settle();
    f.emit("ready", 0);
    assertEquals(f.instances.length, 1);
    await assertRejects(() => f.owned.publish("event", "synthetic"), Error, "not ready");
  } finally {
    time.restore();
  }
});

it("never expands finite initial startup into a generation restart loop", async () => {
  const time = new FakeTime();
  try {
    const f = fixture();
    f.emit("end");
    time.tick(10_000);
    await settle();
    assertEquals(f.instances.length, 1);
    await assertRejects(() => f.owned.connect(), Error, "stopped");
  } finally {
    time.restore();
  }
});

it("delivers owned current-generation messages during native resubscription without admitting commands", async () => {
  const f = fixture();
  let delivered = 0;
  f.emit("ready");
  await f.owned.subscribe("main", () => delivered++);
  f.emit("reconnecting");
  f.deliver(0, "main");
  assertEquals(delivered, 1);
  await assertRejects(() => f.owned.publish("event", "synthetic"), Error, "not ready");
  f.emit("ready");
  await f.owned.close();
});
it("delivers known-live replacement messages before restore completion but fences the old generation", async () => {
  const time = new FakeTime();
  try {
    const f = fixture();
    let delivered = 0;
    f.emit("ready");
    await f.owned.subscribe("main", () => delivered++);
    await f.owned.subscribe("ack", () => {});
    f.deferSubscription("main");
    f.deferRetirement("ack");
    const retiring = f.owned.unsubscribe("ack").catch(() => {});
    time.tick(3_000);
    await settle();
    await retiring;
    time.tick(1_000);
    await settle();
    f.emit("ready");
    f.deliver(1, "main");
    assertEquals(delivered, 1);
    f.deliver(0, "main");
    assertEquals(delivered, 1);
    await assertRejects(() => f.owned.publish("event", "synthetic"), Error, "not ready");
    f.finishSubscription(1);
    await settle();
    assertEquals(await f.owned.publish("event", "synthetic"), 2);
    await f.owned.close();
  } finally {
    time.restore();
  }
});
