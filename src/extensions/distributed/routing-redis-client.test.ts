import { FakeTime } from "#std/testing/time";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  createRoutingRedisClient,
  type RoutingRedisClientOptions,
} from "./routing-redis-client.ts";

function fixture() {
  let options!: RoutingRedisClientOptions;
  const listeners = new Map<string, Array<() => void>>();
  const calls: string[] = [];
  const active = new Set<string>();
  const retirements: Array<() => void> = [];
  let deferred = false;
  let deferredChannel: string | undefined;
  let failSubscribe = false;
  let failUnsubscribe = false;
  let failDestroy = false;
  const owned = createRoutingRedisClient((configured) => {
    options = configured;
    return {
      connect: () => {
        calls.push("connect");
        return Promise.resolve();
      },
      publish: () => {
        calls.push("publish");
        return Promise.resolve(2);
      },
      subscribe: (channel) => {
        active.add(channel);
        calls.push("subscribe");
        if (failSubscribe) return Promise.reject(new Error("Uncertain subscribe result"));
        return Promise.resolve();
      },
      unsubscribe: (channel) => {
        calls.push("unsubscribe");
        if (failUnsubscribe) return Promise.reject(new Error("Unsubscribe refused"));
        if (deferred && (deferredChannel === undefined || deferredChannel === channel)) {
          return new Promise<void>((resolve) =>
            retirements.push(() => {
              active.delete(channel);
              resolve();
            })
          );
        }
        active.delete(channel);
        return Promise.resolve();
      },
      close: () => {
        calls.push("close");
      },
      destroy: () => {
        calls.push("destroy");
        if (failDestroy) throw new Error("Disposal refused");
      },
      on(event, listener) {
        const registered = listeners.get(event) ?? [];
        registered.push(listener as () => void);
        listeners.set(event, registered);
      },
    };
  }, "redis://127.0.0.1:1");
  return {
    owned,
    options,
    calls,
    active,
    failDisposal() {
      failUnsubscribe = true;
      failDestroy = true;
    },
    failSubscribe() {
      failSubscribe = true;
    },
    deferRetirement(channel?: string) {
      deferred = true;
      deferredChannel = channel;
    },
    finishRetirement() {
      const complete = retirements.shift();
      assert(complete);
      complete();
    },
    emit(event: string) {
      for (const fn of listeners.get(event) ?? []) fn();
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
it("destroys once when retirement cannot settle within its deadline and ignores late completion", async () => {
  const time = new FakeTime();
  try {
    const f = fixture();
    f.emit("ready");
    await f.owned.subscribe("ack", () => {});
    f.deferRetirement();
    const retiring = f.owned.unsubscribe("ack").catch(() => {});
    time.tick(3_000);
    await settle();
    await retiring;
    assertEquals(f.calls, ["subscribe", "unsubscribe", "destroy"]);
    f.finishRetirement();
    f.emit("ready");
    await settle();
    await assertRejects(() => f.owned.publish("event", "synthetic"), Error, "not ready");
    assert(f.options.socket.reconnectStrategy(0) instanceof Error);
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
