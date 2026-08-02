import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runInNewContext } from "node:vm";
import {
  captureByteReadCapabilities,
  captureExclusiveCreateCapability,
  captureSnapshotReadCapability,
  captureStaticReadCapabilities,
} from "./file-system-capabilities.ts";

function assertFrozenNullRecord(value: object): void {
  assertEquals(Object.isFrozen(value), true);
  assertEquals(Object.getPrototypeOf(value), null);
}

describe("filesystem capability capture", () => {
  it("captures snapshot authority without inspecting unrelated reader fields", async () => {
    let unrelatedGetterCalls = 0;
    const adapter = {
      readFileSnapshotWithinLimit: () => Promise.resolve(new Uint8Array([1, 2])),
    };
    Object.defineProperty(adapter, "readFileBytesWithinLimit", {
      get() {
        unrelatedGetterCalls++;
        throw new Error("must not run");
      },
    });

    const captured = captureSnapshotReadCapability(adapter)!;
    assertFrozenNullRecord(captured);
    assertEquals([...(await captured.read("/root/a", "/root", 2))], [1, 2]);
    assertEquals(unrelatedGetterCalls, 0);
  });

  it("captures exclusive-create authority without inspecting unrelated readers", async () => {
    let unrelatedGetterCalls = 0;
    let createdPath = "";
    const adapter = {
      createFileBytesExclusive(path: string) {
        createdPath = path;
        return Promise.resolve();
      },
    };
    Object.defineProperty(adapter, "maxWholeFileReadBytes", {
      get() {
        unrelatedGetterCalls++;
        throw new Error("must not run");
      },
    });

    const captured = captureExclusiveCreateCapability(adapter)!;
    assertFrozenNullRecord(captured);
    await captured.create("/root/new", new Uint8Array([1]));
    assertEquals(createdPath, "/root/new");
    assertEquals(unrelatedGetterCalls, 0);
  });

  it("freezes ordinary reader authority and receiver identity at capture time", async () => {
    let receiverMatches = false;
    const adapter = {
      maxWholeFileReadBytes: 4,
      readFileBytes(path: string) {
        receiverMatches = this === adapter;
        return Promise.resolve(new Uint8Array([path.length]));
      },
      readFileBytesWithinLimit(_path: string, maximumBytes: number) {
        return Promise.resolve(new Uint8Array([maximumBytes]));
      },
    };
    const captured = captureByteReadCapabilities(adapter);
    adapter.readFileBytes = () => Promise.resolve(new Uint8Array([9]));
    adapter.readFileBytesWithinLimit = () => Promise.resolve(new Uint8Array([9]));

    assertFrozenNullRecord(captured);
    assertFrozenNullRecord(captured.whole!);
    assertEquals([...(await captured.unbounded!("/a"))], [2]);
    assertEquals([...(await captured.whole!.read("/a"))], [2]);
    assertEquals([...(await captured.exact!("/a", 3))], [3]);
    assertEquals(receiverMatches, true);
  });

  it("rejects malformed selected data properties without invoking accessors", () => {
    let getterCalls = 0;
    const adapter = {};
    Object.defineProperty(adapter, "readFileBytesWithinLimit", {
      get() {
        getterCalls++;
        return () => Promise.resolve(new Uint8Array());
      },
    });

    assertThrows(
      () => captureByteReadCapabilities(adapter),
      TypeError,
      "must be a data property",
    );
    assertEquals(getterCalls, 0);
    assertThrows(
      () => captureByteReadCapabilities({ maxWholeFileReadBytes: 4 }),
      TypeError,
      "requires readFileBytes",
    );
  });

  it("keeps proven snapshot authority when malformed ordinary readers are quarantined", async () => {
    let getterCalls = 0;
    const adapter = {
      symlinkSemantics: "none" as const,
      readFileSnapshotWithinLimit: () => Promise.resolve(new Uint8Array([1])),
      getSourceSnapshotVersion: () => 1,
    };
    Object.defineProperty(adapter, "readFileBytesWithinLimit", {
      get() {
        getterCalls++;
        throw new Error("must not run");
      },
    });

    const captured = captureStaticReadCapabilities(adapter);
    assertEquals(captured.virtual, undefined);
    assertEquals([...(await captured.snapshot!.read("/root/a", "/root", 1))], [1]);
    assertEquals(getterCalls, 0);
  });

  it("requires an own data marker before inspecting virtual authority", () => {
    let getterCalls = 0;
    const withoutMarker = {
      getSourceSnapshotVersion: () => 1,
    };
    Object.defineProperty(withoutMarker, "readFileBytesWithinLimit", {
      get() {
        getterCalls++;
        throw new Error("must not run");
      },
    });
    assertEquals(captureStaticReadCapabilities(withoutMarker).virtual, undefined);
    assertEquals(getterCalls, 0);

    const inheritedMarker = Object.create({ symlinkSemantics: "none" }) as Record<
      string,
      unknown
    >;
    inheritedMarker.getSourceSnapshotVersion = () => 1;
    inheritedMarker.readFileBytesWithinLimit = () => Promise.resolve(new Uint8Array());
    assertEquals(captureStaticReadCapabilities(inheritedMarker).virtual, undefined);
  });

  it("captures snapshot and virtual generation records independently", async () => {
    const adapter = {
      symlinkSemantics: "none" as const,
      readFileSnapshotWithinLimit: () => Promise.resolve(new Uint8Array([1])),
      getSourceSnapshotVersion: () => 7,
      readFileBytesWithinLimit: () => Promise.resolve(new Uint8Array([2])),
      readFileBytes: () => Promise.resolve(new Uint8Array([3])),
      maxWholeFileReadBytes: 4,
    };
    const captured = captureStaticReadCapabilities(adapter);

    assertFrozenNullRecord(captured);
    assertFrozenNullRecord(captured.snapshot!);
    assertFrozenNullRecord(captured.virtual!);
    assertFrozenNullRecord(captured.virtual!.whole!);
    assertEquals(await captured.virtual!.generation(), 7);
    assertEquals([...(await captured.virtual!.exact!("/a", 2))], [2]);
    assertEquals([...(await captured.virtual!.whole!.read("/b"))], [3]);
  });

  it("validates every virtual generation at the authority boundary", async () => {
    let generation: unknown = 0;
    const captured = captureStaticReadCapabilities({
      symlinkSemantics: "none",
      getSourceSnapshotVersion: () => generation,
      readFileBytesWithinLimit: () => Promise.resolve(new Uint8Array()),
    });

    assertEquals(await captured.virtual!.generation(), 0);
    generation = 1;
    assertEquals(await captured.virtual!.generation(), 1);
    for (const invalid of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, undefined, "1"]) {
      generation = invalid;
      await assertRejects(() => captured.virtual!.generation(), RangeError);
    }
  });

  it("ignores local and foreign terminal Object.prototype capabilities", () => {
    const prior = Object.getOwnPropertyDescriptor(
      Object.prototype,
      "readFileSnapshotWithinLimit",
    );
    Object.defineProperty(Object.prototype, "readFileSnapshotWithinLimit", {
      configurable: true,
      value: () => Promise.resolve(new Uint8Array([1])),
    });
    try {
      assertEquals(captureSnapshotReadCapability({}), undefined);
    } finally {
      if (prior === undefined) {
        Reflect.deleteProperty(Object.prototype, "readFileSnapshotWithinLimit");
      } else {
        Object.defineProperty(Object.prototype, "readFileSnapshotWithinLimit", prior);
      }
    }

    const foreign = runInNewContext(`
      Object.prototype.readFileSnapshotWithinLimit = () => Promise.resolve(new Uint8Array([1]));
      ({});
    `) as object;
    assertEquals(captureSnapshotReadCapability(foreign), undefined);
  });

  it("bounds hostile prototype traversal and captures Proxy authority only once", async () => {
    let deep = Object.create(null) as object;
    for (let depth = 0; depth < 65; depth++) deep = Object.create(deep) as object;
    assertThrows(
      () => captureSnapshotReadCapability(deep),
      TypeError,
      "prototype chain is too deep",
    );

    let traps = 0;
    const proxied = new Proxy(
      {
        readFileSnapshotWithinLimit: () => Promise.resolve(new Uint8Array([4])),
      },
      {
        getOwnPropertyDescriptor(target, property) {
          traps++;
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
        getPrototypeOf(target) {
          traps++;
          return Reflect.getPrototypeOf(target);
        },
      },
    );
    const captured = captureSnapshotReadCapability(proxied)!;
    const captureTrapCount = traps;
    assertEquals(captureTrapCount > 0, true);
    assertEquals([...(await captured.read("/a", "/", 1))], [4]);
    assertEquals(traps, captureTrapCount);
  });

  it("copies subclassed and cross-realm byte results into tight fixed arrays", async () => {
    class Bytes extends Uint8Array {}
    const subclassed = new Bytes([8, 1, 2, 9]);
    const foreign = runInNewContext("new Uint8Array([3, 4])") as Uint8Array;
    let result: Uint8Array = subclassed.subarray(1, 3);
    const captured = captureSnapshotReadCapability({
      readFileSnapshotWithinLimit: () => Promise.resolve(result),
    })!;

    const first = await captured.read("/root/a", "/root", 2);
    subclassed[1] = 7;
    assertEquals([...first], [1, 2]);
    assertEquals(first.byteOffset, 0);
    assertEquals(first.buffer.byteLength, 2);
    assertEquals(Object.getPrototypeOf(first), Uint8Array.prototype);

    result = foreign;
    const second = await captured.read("/root/b", "/root", 2);
    foreign[0] = 9;
    assertEquals([...second], [3, 4]);
    assertEquals(second.byteOffset, 0);
    assertEquals(second.buffer.byteLength, 2);
  });

  it("rejects mutable shared or resizable byte storage", async () => {
    let result: Uint8Array = new Uint8Array(new SharedArrayBuffer(2));
    const captured = captureSnapshotReadCapability({
      readFileSnapshotWithinLimit: () => Promise.resolve(result),
    })!;
    await assertRejects(
      () => captured.read("/root/a", "/root", 2),
      TypeError,
      "fixed ArrayBuffer",
    );

    if (Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get) {
      const ResizableArrayBuffer = ArrayBuffer as unknown as new (
        byteLength: number,
        options: { maxByteLength: number },
      ) => ArrayBuffer;
      result = new Uint8Array(new ResizableArrayBuffer(2, { maxByteLength: 4 }));
      await assertRejects(
        () => captured.read("/root/a", "/root", 2),
        TypeError,
        "fixed ArrayBuffer",
      );
    }
  });

  it("copies bytes without consulting poisoned view properties or species", async () => {
    class PoisonedBytes extends Uint8Array {}
    Object.defineProperties(PoisonedBytes.prototype, {
      buffer: { get: () => Promise.reject(new Error("poisoned buffer")) },
      byteLength: { get: () => Promise.reject(new Error("poisoned length")) },
      byteOffset: { get: () => Promise.reject(new Error("poisoned offset")) },
      [Symbol.toStringTag]: { get: () => Promise.reject(new Error("poisoned tag")) },
    });
    Object.defineProperty(PoisonedBytes, Symbol.species, {
      get: () => Promise.reject(new Error("poisoned species")),
    });
    const bytes = new PoisonedBytes([5, 6]);
    const captured = captureSnapshotReadCapability({
      readFileSnapshotWithinLimit: () => Promise.resolve(bytes),
    })!;

    assertEquals([...(await captured.read("/root/a", "/root", 2))], [5, 6]);
  });

  it("snapshots exclusive-create input before asynchronous observation", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let observed: number[] = [];
    const captured = captureExclusiveCreateCapability({
      async createFileBytesExclusive(_path: string, content: Uint8Array) {
        await gate;
        observed = [...content];
      },
    })!;
    const source = new Uint8Array([1, 2]);

    const pending = captured.create("/root/new", source);
    source[0] = 9;
    release();
    await pending;
    assertEquals(observed, [1, 2]);
  });
});
