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
