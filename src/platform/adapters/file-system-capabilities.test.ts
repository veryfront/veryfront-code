import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runInNewContext } from "node:vm";
import * as capabilityModule from "./file-system-capabilities.ts";

type SnapshotReader = {
  read(path: string, containmentRoot: string, byteLimit: number): Promise<Uint8Array>;
};
type ExclusiveCreator = {
  create(path: string, content: Uint8Array): Promise<void>;
};
type StaticReaders = {
  snapshot?: SnapshotReader;
  virtual?: {
    generation(): Promise<number>;
    exact?: (path: string, byteLimit: number) => Promise<Uint8Array>;
    whole?: { maximumBytes: number; read(path: string): Promise<Uint8Array> };
  };
};
type ByteReaders = {
  unbounded?: (path: string) => Promise<Uint8Array>;
  whole?: { maximumBytes: number; read(path: string): Promise<Uint8Array> };
  prefix?: (path: string, byteLimit: number) => Promise<Uint8Array>;
  exact?: (path: string, byteLimit: number) => Promise<Uint8Array>;
};

const captureSnapshotReadCapability = (
  capabilityModule as unknown as {
    captureSnapshotReadCapability?: (value: unknown, label?: string) =>
      | SnapshotReader
      | undefined;
  }
).captureSnapshotReadCapability!;
const captureExclusiveCreateCapability = (
  capabilityModule as unknown as {
    captureExclusiveCreateCapability?: (value: unknown, label?: string) =>
      | ExclusiveCreator
      | undefined;
  }
).captureExclusiveCreateCapability!;
const captureStaticReadCapabilities = (
  capabilityModule as unknown as {
    captureStaticReadCapabilities?: (
      value: unknown,
      label?: string,
      allowExplicitUndefined?: boolean,
    ) => StaticReaders;
  }
).captureStaticReadCapabilities!;
const captureLegacyFileSystemCapabilitiesForSnapshot = (
  capabilityModule as unknown as {
    captureLegacyFileSystemCapabilitiesForSnapshot?: (
      value: unknown,
      label?: string,
    ) => {
      readFileBytes?: (path: string) => Promise<Uint8Array>;
      readFileBytesBounded?: (path: string, byteLimit: number) => Promise<Uint8Array>;
      readFileBytesWithinLimit?: (path: string, byteLimit: number) => Promise<Uint8Array>;
      writeFileBytes?: (path: string, content: Uint8Array) => Promise<void>;
      wholeFileReader?: {
        maximumBytes: number;
        read(path: string): Promise<Uint8Array>;
      };
    };
  }
).captureLegacyFileSystemCapabilitiesForSnapshot!;
const captureByteReadCapabilities = (
  capabilityModule as unknown as {
    captureByteReadCapabilities?: (value: unknown, label?: string) => ByteReaders;
  }
).captureByteReadCapabilities!;

function assertFrozenNullRecord(value: object): void {
  assertEquals(Object.isFrozen(value), true);
  assertEquals(Object.getPrototypeOf(value), null);
}

describe("platform/adapters/file-system-capabilities", () => {
  it("preserves the defensive byte-reader compatibility surface", async () => {
    let receiverMatches = false;
    const source = new Uint8Array([1, 2]);
    const adapter = {
      maxWholeFileReadBytes: 2,
      readFileBytes() {
        receiverMatches = this === adapter;
        return Promise.resolve(source);
      },
      readFileBytesBounded(_path: string, byteLimit: number) {
        return Promise.resolve(source.subarray(0, byteLimit));
      },
      readFileBytesWithinLimit(_path: string, byteLimit: number) {
        return Promise.resolve(source.subarray(0, byteLimit));
      },
    };
    const captured = captureByteReadCapabilities(adapter);

    assertFrozenNullRecord(captured);
    assertFrozenNullRecord(captured.whole!);
    const results = await Promise.all([
      captured.unbounded!("/a"),
      captured.whole!.read("/a"),
      captured.prefix!("/a", 2),
      captured.exact!("/a", 2),
    ]);
    source[0] = 9;
    for (const result of results) assertEquals([...result], [1, 2]);
    assertEquals(receiverMatches, true);
    await assertRejects(() => captured.exact!("/a", 0), RangeError, "positive safe integer");
  });

  it("separates size overflow from malformed result types", () => {
    assertThrows(
      () => capabilityModule.copyFixedUint8ArrayWithinLimit(new Uint8Array(3), 2, "Payload"),
      RangeError,
      "Payload exceeds 2 bytes",
    );
    assertThrows(
      () => capabilityModule.copyFixedUint8ArrayWithinLimit("not bytes", 2, "Payload"),
      TypeError,
      "Payload reader returned invalid bytes",
    );
  });

  it("captures byte readers without inspecting an unrelated malformed writer", async () => {
    const captured = captureByteReadCapabilities({
      readFileBytesWithinLimit: () => Promise.resolve(new Uint8Array([4])),
      writeFileBytes: new Proxy(function () {}, {}),
    });

    assertEquals([...(await captured.exact!("/a", 1))], [4]);
  });

  it("captures snapshot authority without inspecting unrelated writer fields", async () => {
    let unrelatedReads = 0;
    const adapter = {
      readFileSnapshotWithinLimit() {
        return Promise.resolve(new Uint8Array([1, 2]));
      },
      createFileBytesExclusive: new Proxy(function () {}, {}),
    };
    Object.defineProperty(adapter, "maxWholeFileReadBytes", {
      get() {
        unrelatedReads++;
        throw new Error("must not run");
      },
    });

    const captured = captureSnapshotReadCapability(adapter)!;

    assertFrozenNullRecord(captured);
    assertEquals([...(await captured.read("/root/a", "/root", 2))], [1, 2]);
    assertEquals(unrelatedReads, 0);
  });

  it("quarantines malformed legacy fields independently for a proven snapshot adapter", async () => {
    let ceilingGetterCalls = 0;
    let exactApplyCalls = 0;
    let writeCalls = 0;
    const adapter = {
      readFileBytes: () => Promise.resolve(new Uint8Array([1])),
      readFileBytesBounded: () => Promise.resolve(new Uint8Array([2])),
      readFileBytesWithinLimit: new Proxy(function () {}, {
        apply() {
          exactApplyCalls++;
          throw new Error("must not run");
        },
      }),
      writeFileBytes: () => {
        writeCalls++;
        return Promise.resolve();
      },
    };
    Object.defineProperty(adapter, "maxWholeFileReadBytes", {
      get() {
        ceilingGetterCalls++;
        throw new Error("must not run");
      },
    });

    const captured = captureLegacyFileSystemCapabilitiesForSnapshot(adapter);

    assertFrozenNullRecord(captured);
    assertEquals([...(await captured.readFileBytes!("/a"))], [1]);
    assertEquals([...(await captured.readFileBytesBounded!("/a", 1))], [2]);
    await captured.writeFileBytes!("/a", new Uint8Array([3]));
    assertEquals(captured.readFileBytesWithinLimit, undefined);
    assertEquals(captured.wholeFileReader, undefined);
    assertEquals({ ceilingGetterCalls, exactApplyCalls, writeCalls }, {
      ceilingGetterCalls: 0,
      exactApplyCalls: 0,
      writeCalls: 1,
    });
  });

  it("still rejects unsafe capability provenance for a proven snapshot adapter", () => {
    let trapCalls = 0;
    const hostilePrototype = new Proxy({}, {
      getOwnPropertyDescriptor() {
        trapCalls++;
        throw new Error("must not run");
      },
      getPrototypeOf() {
        trapCalls++;
        throw new Error("must not run");
      },
    });
    const adapter = Object.setPrototypeOf({}, hostilePrototype);

    assertThrows(
      () => captureLegacyFileSystemCapabilitiesForSnapshot(adapter),
      TypeError,
      "Proxy",
    );
    assertEquals(trapCalls, 0);
  });

  it("captures exclusive-create authority without inspecting unrelated reader fields", async () => {
    let unrelatedReads = 0;
    let created = "";
    const adapter = {
      createFileBytesExclusive(path: string) {
        created = path;
        return Promise.resolve();
      },
      readFileSnapshotWithinLimit: new Proxy(function () {}, {}),
    };
    Object.defineProperty(adapter, "readFileBytesWithinLimit", {
      get() {
        unrelatedReads++;
        throw new Error("must not run");
      },
    });

    const captured = captureExclusiveCreateCapability(adapter)!;

    assertFrozenNullRecord(captured);
    await captured.create("/root/new", new Uint8Array([1]));
    assertEquals(created, "/root/new");
    assertEquals(unrelatedReads, 0);
  });

  it("keeps virtual authority when a wrapper publishes absent slots as undefined", () => {
    // FSAdapterWrapper freezes every optional capability slot, publishing
    // `undefined` for the ones the adapter does not implement. Strict capture
    // threw on that shape, and SecureFs swallows the throw, so wrapper-backed
    // filesystems lost virtual snapshot authority silently rather than loudly.
    const wrapperShaped = {
      symlinkSemantics: "none",
      getSourceSnapshotVersion: () => 7,
      readFileBytes: () => Promise.resolve(new Uint8Array([1])),
      readFileBytesWithinLimit: () => Promise.resolve(new Uint8Array([1])),
      maxWholeFileReadBytes: 1024,
      // Published but unimplemented, exactly as the wrapper does.
      readFileSnapshotWithinLimit: undefined,
    };

    assertThrows(() => captureStaticReadCapabilities(wrapperShaped));

    const captured = captureStaticReadCapabilities(wrapperShaped, "Filesystem", true);
    assertEquals(captured.snapshot, undefined);
    assertEquals(typeof captured.virtual?.generation, "function");
    assertEquals(typeof captured.virtual?.exact, "function");
  });

  it("returns undefined only when a single-purpose raw method is absent", () => {
    assertEquals(captureSnapshotReadCapability({}), undefined);
    assertEquals(captureExclusiveCreateCapability({}), undefined);
    assertThrows(
      () => captureSnapshotReadCapability({ readFileSnapshotWithinLimit: undefined }),
      TypeError,
      "readFileSnapshotWithinLimit must be a non-Proxy function",
    );
    assertThrows(
      () => captureExclusiveCreateCapability({ createFileBytesExclusive: undefined }),
      TypeError,
      "createFileBytesExclusive must be a non-Proxy function",
    );
    assertThrows(
      () => captureSnapshotReadCapability({ readFileSnapshotWithinLimit: 1 }),
      TypeError,
      "readFileSnapshotWithinLimit must be a non-Proxy function",
    );
    assertThrows(
      () => captureExclusiveCreateCapability({ createFileBytesExclusive: 1 }),
      TypeError,
      "createFileBytesExclusive must be a non-Proxy function",
    );
  });

  it("rejects direct Proxy capability objects and selected Proxy functions", () => {
    let trapCalls = 0;
    const adapter = new Proxy({}, {
      getOwnPropertyDescriptor() {
        trapCalls++;
        throw new Error("must not run");
      },
      getPrototypeOf() {
        trapCalls++;
        throw new Error("must not run");
      },
    });

    assertThrows(() => captureSnapshotReadCapability(adapter), TypeError, "non-Proxy object");
    assertEquals(trapCalls, 0);
    assertThrows(
      () =>
        captureSnapshotReadCapability({
          readFileSnapshotWithinLimit: new Proxy(function () {}, {}),
        }),
      TypeError,
      "non-Proxy function",
    );
  });

  it("ignores local and foreign terminal Object.prototype capabilities", () => {
    const localDescriptor = Object.getOwnPropertyDescriptor(
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
      if (localDescriptor === undefined) {
        Reflect.deleteProperty(Object.prototype, "readFileSnapshotWithinLimit");
      } else {
        Object.defineProperty(
          Object.prototype,
          "readFileSnapshotWithinLimit",
          localDescriptor,
        );
      }
    }

    const foreign = runInNewContext(`
      Object.prototype.readFileSnapshotWithinLimit = function () {
        return Promise.resolve(new Uint8Array([1]));
      };
      ({});
    `) as object;
    assertEquals(captureSnapshotReadCapability(foreign), undefined);
  });

  it("rejects a 65-level capability prototype chain", () => {
    let adapter = Object.create(null) as object;
    for (let depth = 0; depth < 65; depth++) adapter = Object.create(adapter) as object;

    assertThrows(
      () => captureSnapshotReadCapability(adapter),
      TypeError,
      "prototype chain is too deep",
    );
  });

  it("keeps captured methods bound to the exact original adapter after mutation", async () => {
    let receiverMatches = false;
    const adapter = {
      readFileSnapshotWithinLimit(
        path: string,
        containmentRoot: string,
        byteLimit: number,
      ) {
        receiverMatches = this === adapter;
        return Promise.resolve(new Uint8Array([path.length, containmentRoot.length, byteLimit]));
      },
    };
    const captured = captureSnapshotReadCapability(adapter)!;
    adapter.readFileSnapshotWithinLimit = () => Promise.resolve(new Uint8Array([9]));

    assertEquals([...(await captured.read("/a", "/", 3))], [2, 1, 3]);
    assertEquals(receiverMatches, true);
  });

  it("copies subclassed and cross-realm snapshot byte results into tight fixed arrays", async () => {
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

  it("rejects SharedArrayBuffer-backed and resizable snapshot results", async () => {
    let result: Uint8Array = new Uint8Array(new SharedArrayBuffer(2));
    const captured = captureSnapshotReadCapability({
      readFileSnapshotWithinLimit: () => Promise.resolve(result),
    })!;

    await assertRejects(
      () => captured.read("/root/a", "/root", 2),
      TypeError,
      "fixed ArrayBuffer",
    );

    try {
      const resizableBuffer = Reflect.construct(ArrayBuffer, [
        2,
        { maxByteLength: 4 },
      ]);
      if (resizableBuffer instanceof ArrayBuffer && resizableBuffer.resizable) {
        result = new Uint8Array(resizableBuffer);
        await assertRejects(
          () => captured.read("/root/a", "/root", 2),
          TypeError,
          "fixed ArrayBuffer",
        );
      }
    } catch {
      // Resizable ArrayBuffers are unavailable in this runtime.
    }
  });

  it("copies snapshot bytes without consulting poisoned view properties or species", async () => {
    class PoisonedBytes extends Uint8Array {}
    Object.defineProperties(PoisonedBytes.prototype, {
      buffer: {
        get: () => {
          throw new Error("poisoned buffer");
        },
      },
      byteLength: {
        get: () => {
          throw new Error("poisoned byteLength");
        },
      },
      byteOffset: {
        get: () => {
          throw new Error("poisoned byteOffset");
        },
      },
      length: {
        get: () => {
          throw new Error("poisoned length");
        },
      },
      [Symbol.toStringTag]: {
        get: () => {
          throw new Error("poisoned tag");
        },
      },
    });
    Object.defineProperty(PoisonedBytes, Symbol.species, {
      get: () => {
        throw new Error("poisoned species");
      },
    });
    const bytes = new PoisonedBytes([5, 6]);
    const captured = captureSnapshotReadCapability({
      readFileSnapshotWithinLimit: () => Promise.resolve(bytes),
    })!;

    assertEquals([...(await captured.read("/root/a", "/root", 2))], [5, 6]);
  });

  it("snapshots exclusive-create input before the raw creator can observe mutation", async () => {
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

  it("captures snapshot and virtual records independently", async () => {
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
    assertEquals([...(await captured.virtual!.exact!("/a", 1))], [2]);
    assertEquals([...(await captured.virtual!.whole!.read("/b"))], [3]);
    assertEquals(captured.virtual!.whole!.maximumBytes, 4);
  });

  it("does not inspect virtual readers unless the own-data virtual gate is established", async () => {
    let unrelatedReads = 0;
    const adapter = {
      readFileSnapshotWithinLimit: () => Promise.resolve(new Uint8Array([1])),
      getSourceSnapshotVersion: () => 1,
    };
    Object.defineProperty(adapter, "maxWholeFileReadBytes", {
      get() {
        unrelatedReads++;
        throw new Error("must not run");
      },
    });
    const captured = captureStaticReadCapabilities(adapter);

    assertEquals(captured.virtual, undefined);
    assertEquals([...(await captured.snapshot!.read("/root/a", "/root", 1))], [1]);
    assertEquals(unrelatedReads, 0);

    const inheritedMarker = Object.create({ symlinkSemantics: "none" }) as Record<string, unknown>;
    inheritedMarker.getSourceSnapshotVersion = () => 1;
    inheritedMarker.readFileBytesWithinLimit = () => Promise.resolve(new Uint8Array());
    assertEquals(captureStaticReadCapabilities(inheritedMarker).virtual, undefined);
  });

  it("fails closed on malformed selected virtual fields", () => {
    const accessorAdapter = { symlinkSemantics: "none" };
    Object.defineProperty(accessorAdapter, "getSourceSnapshotVersion", {
      get() {
        throw new Error("must not run");
      },
    });
    assertThrows(
      () => captureStaticReadCapabilities(accessorAdapter),
      TypeError,
      "getSourceSnapshotVersion must be a data-property method",
    );

    assertThrows(
      () =>
        captureStaticReadCapabilities({
          symlinkSemantics: "none",
          getSourceSnapshotVersion: new Proxy(function () {}, {}),
        }),
      TypeError,
      "getSourceSnapshotVersion must be a non-Proxy function",
    );

    const readerAccessor = {
      symlinkSemantics: "none" as const,
      getSourceSnapshotVersion: () => 1,
    };
    Object.defineProperty(readerAccessor, "readFileBytesWithinLimit", {
      get() {
        throw new Error("must not run");
      },
    });
    assertThrows(
      () => captureStaticReadCapabilities(readerAccessor),
      TypeError,
      "readFileBytesWithinLimit must be a data-property method",
    );
  });

  it("does not publish virtual authority without an admissible bounded reader", () => {
    const captured = captureStaticReadCapabilities({
      symlinkSemantics: "none",
      getSourceSnapshotVersion: () => 0,
    });
    assertEquals(captured.virtual, undefined);
  });

  it("validates every virtual generation result as a non-negative safe integer", async () => {
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
      await assertRejects(
        () => captured.virtual!.generation(),
        TypeError,
        "non-negative safe integer",
      );
    }
  });
});
