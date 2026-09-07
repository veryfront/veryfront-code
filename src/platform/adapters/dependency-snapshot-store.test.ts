import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  captureDependencySnapshotStore,
  createDependencySnapshotStoreHandle,
  resolveDependencySnapshotStoreHandle,
} from "./dependency-snapshot-store.ts";

describe("snapshot store capability", () => {
  it("exposes no provider methods and rejects forged, copied, and proxied handles", async () => {
    let reads = 0;
    const provider = {
      publish: () => Promise.resolve(),
      read: () => {
        reads++;
        return Promise.resolve(null);
      },
    };
    const handle = createDependencySnapshotStoreHandle(provider);
    assertEquals(Reflect.ownKeys(handle), []);
    assertEquals(Object.isFrozen(handle), true);
    assertEquals(await resolveDependencySnapshotStoreHandle(handle).read("scope", "key"), null);
    assertEquals(reads, 1);
    for (
      const invalid of [{}, { ...handle }, Object.create(handle), new Proxy(handle, {}), provider]
    ) {
      assertThrows(() => resolveDependencySnapshotStoreHandle(invalid));
    }
  });
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
  it("captures methods once and preserves their receiver", async () => {
    const value = {
      marker: "original",
      publish: () => Promise.resolve(),
      read() {
        return Promise.resolve({ value: this.marker, expiresAt: 100 });
      },
    };
    const captured = captureDependencySnapshotStore(value);
    value.read = () => Promise.reject(new Error("replaced"));
    assertEquals(await captured.read("scope", "key"), { value: "original", expiresAt: 100 });
    assertEquals(captureDependencySnapshotStore(value), captured);
  });
  it("rejects an accessor without invoking it", () => {
    let calls = 0;
    const value = {
      get publish() {
        calls++;
        return () => Promise.resolve();
      },
      read: () => Promise.resolve(null),
    };
    assertThrows(() => captureDependencySnapshotStore(value));
    assertEquals(calls, 0);
  });
  it("rejects inherited methods and proxy objects", () => {
    const valid = { publish: () => Promise.resolve(), read: () => Promise.resolve(null) };
    assertThrows(() => captureDependencySnapshotStore(Object.create(valid)));
    assertThrows(() => captureDependencySnapshotStore(new Proxy(valid, {})));
  });
});
