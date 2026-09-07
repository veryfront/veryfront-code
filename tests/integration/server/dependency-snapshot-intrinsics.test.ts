import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { captureDependencySnapshotStore } from "#veryfront/platform/adapters/dependency-snapshot-store.ts";
import type {
  DependencySnapshotRecord,
  DependencySnapshotStore,
} from "#veryfront/platform/adapters/dependency-snapshot-store.ts";
import { DependencySnapshotRegistry } from "#veryfront/transforms/esm/dependency-snapshot-registry.ts";
import {
  createDependencyPinningSnapshot,
  hashDependencyPins,
} from "#veryfront/transforms/esm/dependency-snapshot.ts";

function storeFixture() {
  const records = new Map<string, DependencySnapshotRecord>();
  const store: DependencySnapshotStore = {
    publish: (namespace, key, value, expiresAt) => {
      records.set(`${namespace}:${key}`, { value, expiresAt });
      return Promise.resolve();
    },
    read: (namespace, key) => Promise.resolve(records.get(`${namespace}:${key}`) ?? null),
  };
  return { store, records };
}
function snapshot(dependencies: Record<string, string> = {}) {
  return createDependencyPinningSnapshot(`on:${hashDependencyPins(dependencies)}`, dependencies);
}
describe("dependency snapshot intrinsic capture", () => {
  for (const operation of ["publish", "read"] as const) {
    it(`keeps ${operation} bounded when scheduling and abort helpers are replaced`, async () => {
      const schedule = globalThis.setTimeout;
      const cancel = globalThis.clearTimeout;
      const Controller = globalThis.AbortController;
      const abort = Controller.prototype.abort;
      const signalDescriptor = Object.getOwnPropertyDescriptor(Controller.prototype, "signal")!;
      const addListenerDescriptor = Object.getOwnPropertyDescriptor(
        AbortSignal.prototype,
        "addEventListener",
      );
      let touches = 0;
      let release!: () => void;
      let receivedSignal: AbortSignal | undefined;
      const stalled = new Promise<void>((resolve) => release = resolve);
      const store: DependencySnapshotStore = {
        publish: (_namespace, _key, _value, _expiresAt, signal) => {
          receivedSignal = signal;
          return stalled;
        },
        read: (_namespace, _key, signal) => {
          receivedSignal = signal;
          return stalled.then(() => null);
        },
      };
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      let outcome: string;
      try {
        globalThis.setTimeout = (() => {
          touches++;
          return 0;
        }) as typeof setTimeout;
        globalThis.clearTimeout = () => {
          touches++;
        };
        globalThis.AbortController = new Proxy(Controller, {
          construct() {
            touches++;
            return new Controller();
          },
        });
        Controller.prototype.abort = () => {
          touches++;
        };
        Object.defineProperty(Controller.prototype, "signal", {
          configurable: true,
          get() {
            touches++;
            return signalDescriptor.get!.call(this);
          },
        });
        Object.defineProperty(AbortSignal.prototype, "addEventListener", {
          configurable: true,
          value: () => {
            touches++;
          },
        });
        const registry = new DependencySnapshotRegistry({ store, timeoutMs: 5 });
        const pending = operation === "publish"
          ? registry.remember("bounded-source", snapshot())
          : registry.find("bounded-source", "on:1");
        outcome = await Promise.race([
          pending.then(() => "fulfilled", () => "rejected"),
          new Promise<string>((resolve) => watchdog = schedule(() => resolve("watchdog"), 250)),
        ]);
      } finally {
        globalThis.setTimeout = schedule;
        globalThis.clearTimeout = cancel;
        globalThis.AbortController = Controller;
        Controller.prototype.abort = abort;
        Object.defineProperty(Controller.prototype, "signal", signalDescriptor);
        if (addListenerDescriptor) {
          Object.defineProperty(AbortSignal.prototype, "addEventListener", addListenerDescriptor);
        } else Reflect.deleteProperty(AbortSignal.prototype, "addEventListener");
        if (watchdog !== undefined) cancel(watchdog);
        release();
      }
      assertEquals(outcome, "rejected");
      assertEquals(receivedSignal?.aborted, true);
      assertEquals(touches, 0);
    });
  }

  it("does not expose a host capability through replaced object and weak-map helpers", async () => {
    const store = { publish: () => Promise.resolve(), read: () => Promise.resolve(null) };
    const original = {
      apply: Reflect.apply,
      freeze: Object.freeze,
      descriptor: Object.getOwnPropertyDescriptor,
      get: WeakMap.prototype.get,
      set: WeakMap.prototype.set,
    };
    let observations = 0;
    let read: Promise<unknown> | undefined;
    try {
      Reflect.apply = ((...args: Parameters<typeof Reflect.apply>) => {
        if (args[1] === store) observations++;
        return original.apply(...args);
      }) as typeof Reflect.apply;
      Object.getOwnPropertyDescriptor = (target, key) => {
        if (target === store) observations++;
        return original.descriptor(target, key);
      };
      Object.freeze = ((target: unknown) => {
        observations++;
        return original.freeze(target);
      }) as typeof Object.freeze;
      WeakMap.prototype.get = function (key) {
        if (key === store) observations++;
        return original.apply(original.get, this, [key]);
      };
      WeakMap.prototype.set = function (key, value) {
        if (key === store) observations++;
        return original.apply(original.set, this, [key, value]);
      };
      read = captureDependencySnapshotStore(store).read("scope", "key");
    } finally {
      Reflect.apply = original.apply;
      Object.freeze = original.freeze;
      Object.getOwnPropertyDescriptor = original.descriptor;
      WeakMap.prototype.get = original.get;
      WeakMap.prototype.set = original.set;
    }
    assertEquals(await read, null);
    assertEquals(observations, 0);
  });
  it("does not capture an ambient replacement clock or expose its receiver", async () => {
    const originalNow = Date.now;
    const { store } = storeFixture();
    let ambientCalls = 0;
    try {
      Date.now = () => {
        ambientCalls++;
        return originalNow();
      };
      const registry = new DependencySnapshotRegistry({ store });
      await registry.remember("source", snapshot());
    } finally {
      Date.now = originalNow;
    }
    assertEquals(ambientCalls, 0);
    let receiver: unknown = "not-called";
    const registry = new DependencySnapshotRegistry({
      store,
      now: function (this: unknown) {
        receiver = this;
        return originalNow();
      },
    });
    await registry.remember("source", snapshot());
    assertEquals(receiver, undefined);
  });
  it("does not pass provider-bearing options to inherited configuration getters", async () => {
    let observations = 0;
    const { store } = storeFixture();
    Object.defineProperty(Object.prototype, "now", {
      configurable: true,
      get() {
        observations++;
        return Date.now;
      },
    });
    try {
      const registry = new DependencySnapshotRegistry({ store });
      await registry.remember("source", snapshot());
    } finally {
      Reflect.deleteProperty(Object.prototype, "now");
    }
    assertEquals(observations, 0);
  });
});
