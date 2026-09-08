import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { captureDependencySnapshotStore } from "#veryfront/platform/adapters/dependency-snapshot-store.ts";
import type {
  DependencySnapshotRecord,
  DependencySnapshotStore,
} from "#veryfront/platform/adapters/dependency-snapshot-store.ts";
import { DependencySnapshotRegistry } from "#veryfront/transforms/esm/dependency-snapshot-registry.ts";
import {
  createDependencyPinningSnapshot,
  decodeDependencySnapshot,
  encodeDependencySnapshot,
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
  for (const accepts of [false, true]) {
    it(`validates historical expiry when the integer hook returns ${accepts}`, async () => {
      const namespace = await computeHash("integer-validation");
      const original = snapshot();
      const value = encodeDependencySnapshot(namespace, original);
      const expiresAt = accepts ? NaN : Date.now() + 60_000;
      const registry = new DependencySnapshotRegistry({
        store: {
          publish: () => Promise.resolve(),
          read: () => Promise.resolve({ value, expiresAt }),
        },
      });
      const validator = Number.isSafeInteger;
      let touches = 0, rejected = false;
      let restored: unknown;
      try {
        Number.isSafeInteger = () => {
          touches++;
          return accepts;
        };
        try {
          restored = await registry.find("integer-validation", original.cacheKey);
        } catch {
          rejected = true;
        }
      } finally {
        Number.isSafeInteger = validator;
      }
      assertEquals(touches, 0, "history validation must not invoke the replacement");
      assertEquals(
        rejected,
        accepts,
        "invalid expiry must reject while valid history remains readable",
      );
      assertEquals(restored, accepts ? undefined : original);
      assertEquals(
        registry.peek("integer-validation", original.cacheKey),
        accepts ? undefined : original,
      );
    });
  }

  it("validates every registry limit without consulting an ambient array iterator", () => {
    const iterator = Array.prototype[Symbol.iterator];
    const limits = ["retentionMs", "maxEntries", "maxBytes", "timeoutMs"] as const;
    let rejected = 0, touches = 0;
    try {
      Array.prototype[Symbol.iterator] = function () {
        touches++;
        return iterator.call([]);
      };
      for (let index = 0; index < limits.length; index++) {
        try {
          new DependencySnapshotRegistry({ [limits[index]!]: NaN });
        } catch {
          rejected++;
        }
      }
    } finally {
      Array.prototype[Symbol.iterator] = iterator;
    }
    assertEquals(rejected, limits.length, "all invalid limits must reject");
    assertEquals(touches, 0, "constructor validation must not invoke the replacement iterator");
  });

  const codecPrimitives: Array<[string, object, PropertyKey]> = [
    ["JSON.parse", JSON, "parse"],
    ["JSON.stringify", JSON, "stringify"],
    ["Object.entries", Object, "entries"],
    ["Object.values", Object, "values"],
    ["Object.keys", Object, "keys"],
    ["Object.fromEntries", Object, "fromEntries"],
    ["Object.assign", Object, "assign"],
    ["Object.create", Object, "create"],
    ["Object.freeze", Object, "freeze"],
    ["Object.hasOwn", Object, "hasOwn"],
    ["Object.getOwnPropertyDescriptor", Object, "getOwnPropertyDescriptor"],
    ["Object.setPrototypeOf", Object, "setPrototypeOf"],
    ["Array.isArray", Array, "isArray"],
    ["Array.sort", Array.prototype, "sort"],
    ["Array.some", Array.prototype, "some"],
    ["Array.iterator", Array.prototype, Symbol.iterator],
    ["String.localeCompare", String.prototype, "localeCompare"],
    ["String.charCodeAt", String.prototype, "charCodeAt"],
    ["BigInt", globalThis, "BigInt"],
    ["BigInt.toString", BigInt.prototype, "toString"],
    ["RegExp.exec", RegExp.prototype, "exec"],
    ["Reflect.apply", Reflect, "apply"],
  ];
  for (const [name, target, property] of codecPrimitives) {
    it(`keeps snapshot bytes and pins stable after ${name} is replaced`, () => {
      const namespace = "a".repeat(64);
      const dependencies = { zod: "4.0.0", react: "19.2.4" };
      const configured = { react: { declaration: "^19", effective: "19.2.4" } };
      const key = `on:${hashDependencyPins(dependencies, configured)}`;
      const expected = encodeDependencySnapshot(
        namespace,
        createDependencyPinningSnapshot(key, dependencies, configured),
      );
      const descriptor = Object.getOwnPropertyDescriptor(target, property)!;
      const define = Object.defineProperty;
      let touches = 0, actualKey = "", actualBytes = "";
      let failure: unknown;
      try {
        define(target, property, {
          configurable: true,
          writable: true,
          value: () => {
            touches++;
            throw new Error("Replaced codec primitive invoked");
          },
        });
        actualKey = `on:${hashDependencyPins(dependencies, configured)}`;
        const captured = createDependencyPinningSnapshot(key, dependencies, configured);
        actualBytes = encodeDependencySnapshot(namespace, captured);
        decodeDependencySnapshot(expected, namespace, key);
      } catch (error) {
        failure = error;
      } finally {
        define(target, property, descriptor);
      }
      assertEquals(failure, undefined, `${name} must not affect snapshot processing`);
      assertEquals(touches, 0);
      assertEquals(actualKey, key);
      assertEquals(actualBytes, expected);
    });
  }

  it("does not consult inherited JSON or missing-field hooks", () => {
    const namespace = "a".repeat(64);
    const original = snapshot({ react: "19.2.4" });
    const expected = encodeDependencySnapshot(namespace, original);
    const targets: Array<[object, string]> = [
      [Object.prototype, "toJSON"],
      [Array.prototype, "toJSON"],
      [Object.prototype, "configuredVersions"],
      [Object.prototype, "version"],
    ];
    const descriptors = targets.map(([target, key]) =>
      Object.getOwnPropertyDescriptor(target, key)
    );
    let touches = 0, actualBytes = "", invalidRejected = false;
    let failure: unknown;
    try {
      for (const [target, key] of targets) {
        Object.defineProperty(target, key, {
          configurable: true,
          get() {
            touches++;
            throw new Error("Inherited codec hook invoked");
          },
        });
      }
      actualBytes = encodeDependencySnapshot(namespace, original);
      decodeDependencySnapshot(expected, namespace, original.cacheKey);
      try {
        decodeDependencySnapshot("{}", namespace, original.cacheKey);
      } catch {
        invalidRejected = true;
      }
    } catch (error) {
      failure = error;
    } finally {
      targets.forEach(([target, key], index) => {
        const descriptor = descriptors[index];
        if (descriptor) Object.defineProperty(target, key, descriptor);
        else Reflect.deleteProperty(target, key);
      });
    }
    assertEquals(failure, undefined);
    assertEquals({ touches, actualBytes, invalidRejected }, {
      touches: 0,
      actualBytes: expected,
      invalidRejected: true,
    });
  });

  it("preserves local eviction without consulting replaced Map constructors or methods", async () => {
    const OriginalMap = Map;
    const methodNames = ["get", "set", "delete", "clear", "keys", "size"] as const;
    const descriptors = methodNames.map((name) =>
      Object.getOwnPropertyDescriptor(OriginalMap.prototype, name)!
    );
    const iteratorPrototype = Object.getPrototypeOf(new OriginalMap().keys());
    const nextDescriptor = Object.getOwnPropertyDescriptor(iteratorPrototype, "next")!;
    let touches = 0;
    let evicted = false, retained = false, cleared = false;
    try {
      globalThis.Map = new Proxy(OriginalMap, {
        construct(target, args) {
          touches++;
          return Reflect.construct(target, args);
        },
      });
      for (const [index, name] of methodNames.entries()) {
        const descriptor = descriptors[index]!;
        Object.defineProperty(
          OriginalMap.prototype,
          name,
          name === "size" ? { configurable: true, get: () => (touches++, 0) } : {
            configurable: true,
            writable: true,
            value: function (this: object, ...args: unknown[]) {
              touches++;
              return Reflect.apply(descriptor.value, this, args);
            },
          },
        );
      }
      Object.defineProperty(iteratorPrototype, "next", {
        configurable: true,
        writable: true,
        value: function (this: object) {
          touches++;
          return Reflect.apply(nextDescriptor.value, this, []);
        },
      });
      const registry = new DependencySnapshotRegistry({ maxEntries: 1 });
      const first = snapshot({ react: "19.1.0" });
      const second = snapshot({ react: "19.2.4" });
      await registry.remember("map-eviction", first);
      await registry.remember("map-eviction", second);
      evicted = registry.peek("map-eviction", first.cacheKey) === undefined;
      retained = registry.peek("map-eviction", second.cacheKey) === second;
      registry.clear();
      cleared = registry.peek("map-eviction", second.cacheKey) === undefined;
    } finally {
      globalThis.Map = OriginalMap;
      for (const [index, name] of methodNames.entries()) {
        Object.defineProperty(OriginalMap.prototype, name, descriptors[index]!);
      }
      Object.defineProperty(iteratorPrototype, "next", nextDescriptor);
    }
    assertEquals({ evicted, retained, cleared, touches }, {
      evicted: true,
      retained: true,
      cleared: true,
      touches: 0,
    });
  });

  for (const operation of ["publish", "read"] as const) {
    it(`limits stalled ${operation} producers when the Map size getter is replaced`, async () => {
      const sizeDescriptor = Object.getOwnPropertyDescriptor(Map.prototype, "size")!;
      let calls = 0;
      let release!: () => void;
      const stalled = new Promise<void>((resolve) => release = resolve);
      const store: DependencySnapshotStore = {
        publish: () => {
          calls++;
          return stalled;
        },
        read: () => {
          calls++;
          return stalled.then(() => null);
        },
      };
      const registry = new DependencySnapshotRegistry({ store, timeoutMs: 5 });
      try {
        Object.defineProperty(Map.prototype, "size", { configurable: true, get: () => 0 });
        await Promise.allSettled(
          Array.from(
            { length: 65 },
            (_, index) =>
              operation === "publish"
                ? registry.remember(`bounded-map-${index}`, snapshot())
                : registry.find(`bounded-map-${index}`, "on:1"),
          ),
        );
      } finally {
        Object.defineProperty(Map.prototype, "size", sizeDescriptor);
        release();
      }
      assertEquals(
        calls,
        64,
        "unsettled producers must remain bounded despite the replaced getter",
      );
      // Settlement releases admission even after every caller has timed out.
      await stalled;
      await registry.find("after-settlement", "on:1");
      assertEquals(calls, 65, "settled producers must release their admission slots");
    });
  }

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
