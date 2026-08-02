import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runInNewContext } from "node:vm";
import {
  captureBoundedTextReader,
  captureSnapshotTextReader,
  copyFixedUint8ArrayWithinLimit,
} from "./bounded-text-reader.ts";

describe("platform/adapters/bounded-text-reader", () => {
  it("copies admitted byte views into a tight fixed buffer", () => {
    const source = new Uint8Array([9, 1, 2, 8]);
    const admitted = copyFixedUint8ArrayWithinLimit(
      source.subarray(1, 3),
      2,
      "Test bytes",
    );

    source[1] = 7;
    assertEquals([...admitted], [1, 2]);
    assertEquals(admitted.byteOffset, 0);
    assertEquals(admitted.buffer.byteLength, 2);
  });

  it("uses the captured native constructor after the global is replaced", () => {
    const NativeUint8Array = globalThis.Uint8Array;
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Uint8Array");
    const source = new NativeUint8Array([1, 2, 3, 4]);
    class OversizedUint8Array extends NativeUint8Array {
      constructor(length: number) {
        super(length * 8);
      }
    }
    Object.defineProperty(globalThis, "Uint8Array", {
      configurable: true,
      writable: true,
      value: OversizedUint8Array,
    });
    try {
      const admitted = copyFixedUint8ArrayWithinLimit(source, 4, "Test bytes");
      assertEquals(admitted.byteLength, 4);
      assertEquals([...admitted], [1, 2, 3, 4]);
    } finally {
      if (descriptor === undefined) {
        delete (globalThis as Record<string, unknown>).Uint8Array;
      } else {
        Object.defineProperty(globalThis, "Uint8Array", descriptor);
      }
    }
  });

  it("rejects a dishonest exact-reader result before fixed-buffer admission", async () => {
    const reader = captureBoundedTextReader({
      readFileBytesWithinLimit: () => Promise.resolve(new Uint8Array(5)),
    });

    await assertRejects(
      () => reader.readUtf8("/oversized.css", 4, "Exact stylesheet"),
      TypeError,
      "Exact stylesheet exceeds 4 bytes",
    );
  });

  it("rejects a dishonest whole-reader result before fixed-buffer admission", async () => {
    const reader = captureBoundedTextReader({
      readFileBytes: () => Promise.resolve(new Uint8Array(5)),
      maxWholeFileReadBytes: 4,
    });

    await assertRejects(
      () => reader.readUtf8("/oversized.css", 4, "Whole stylesheet"),
      TypeError,
      "Whole stylesheet exceeds 4 bytes",
    );
  });

  it("normalizes an oversized snapshot result to the content-admission error", async () => {
    const reader = captureSnapshotTextReader({
      readFileSnapshotWithinLimit: () => Promise.resolve(new Uint8Array(9)),
    }, "Snapshot text reader");

    await assertRejects(
      () => reader.readUtf8("/oversized.css", "/root", 4, "Snapshot stylesheet"),
      TypeError,
      "Snapshot stylesheet exceeds 4 bytes",
    );
  });

  it("captures only bounded-text read fields", async () => {
    let unrelatedReads = 0;
    const adapter = {
      readFileBytesWithinLimit: () => Promise.resolve(new TextEncoder().encode("safe")),
    };
    Object.defineProperty(adapter, "writeFileBytes", {
      get() {
        unrelatedReads++;
        throw new Error("must not run");
      },
    });
    Object.defineProperty(adapter, "createFileBytesExclusive", {
      get() {
        unrelatedReads++;
        throw new Error("must not run");
      },
    });
    const reader = captureBoundedTextReader(adapter);

    assertEquals(await reader.readUtf8("safe.css", 4, "CSS input"), {
      content: "safe",
      byteLength: 4,
    });
    assertEquals(unrelatedReads, 0);
  });

  it("passes the accepted maximum directly to an exact bounded reader", async () => {
    let receivedLimit = 0;
    const reader = captureBoundedTextReader({
      readFileBytesWithinLimit: (_path: string, byteLimit: number) => {
        receivedLimit = byteLimit;
        return Promise.resolve(new TextEncoder().encode("safe"));
      },
    });

    assertEquals(await reader.readUtf8("safe.css", 4, "CSS input"), {
      content: "safe",
      byteLength: 4,
    });
    assertEquals(receivedLimit, 4);
  });

  it("captures and forwards one root-bound stable snapshot reader", async () => {
    const calls: Array<[string, string, number]> = [];
    let replacementCalls = 0;
    const adapter = {
      readFileSnapshotWithinLimit: (path: string, root: string, byteLimit: number) => {
        calls.push([path, root, byteLimit]);
        return Promise.resolve(new TextEncoder().encode("safe"));
      },
    };
    const reader = captureSnapshotTextReader(adapter, "Project filesystem");
    adapter.readFileSnapshotWithinLimit = () => {
      replacementCalls++;
      return Promise.resolve(new Uint8Array());
    };

    assertEquals(
      await reader.readUtf8("/project/app.css", "/project", 4, "Project CSS"),
      { content: "safe", byteLength: 4 },
    );
    assertEquals(calls, [["/project/app.css", "/project", 4]]);
    assertEquals(replacementCalls, 0);
  });

  it("requires stable snapshot authority during capture", () => {
    try {
      captureSnapshotTextReader({
        readFileBytesWithinLimit: () => Promise.resolve(new Uint8Array()),
      });
      throw new Error("expected missing snapshot authority to reject");
    } catch (error) {
      assertEquals(error instanceof TypeError, true);
      assertEquals((error as Error).message.includes("stable snapshot"), true);
    }
  });

  it("accounts bytes through the captured intrinsic getter", async () => {
    const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
    const descriptor = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!;
    const source = new TextEncoder().encode("safe");
    const reader = captureBoundedTextReader({
      readFileBytesWithinLimit: () => Promise.resolve(source),
    });
    Object.defineProperty(typedArrayPrototype, "byteLength", {
      configurable: true,
      get: () => 999,
    });
    try {
      assertEquals(await reader.readUtf8("safe.css", 4, "CSS input"), {
        content: "safe",
        byteLength: 4,
      });
    } finally {
      Object.defineProperty(typedArrayPrototype, "byteLength", descriptor);
    }
  });

  it("exposes fixed byte length without consulting a poisoned getter", async () => {
    const module = await import("./bounded-text-reader.ts") as unknown as {
      getFixedUint8ArrayByteLength?: (value: unknown, label: string) => number;
    };
    const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
    const descriptor = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!;
    const source = new TextEncoder().encode("safe");
    Object.defineProperty(typedArrayPrototype, "byteLength", {
      configurable: true,
      get: () => 999,
    });
    try {
      assertEquals(
        module.getFixedUint8ArrayByteLength?.(source, "CSS input"),
        4,
      );
    } finally {
      Object.defineProperty(typedArrayPrototype, "byteLength", descriptor);
    }
  });

  it("accepts a whole reader only when its fixed upstream ceiling fits", async () => {
    const bytes = new TextEncoder().encode("safe");
    const reader = captureBoundedTextReader({
      maxWholeFileReadBytes: 16,
      readFileBytes: () => Promise.resolve(bytes),
    });

    assertEquals(await reader.readUtf8("safe.css", 16, "CSS input"), {
      content: "safe",
      byteLength: 4,
    });
  });

  it("rejects a 64 MiB whole-reader ceiling for a 16 MiB source without reading", async () => {
    let reads = 0;
    const reader = captureBoundedTextReader({
      maxWholeFileReadBytes: 64 * 1024 * 1024,
      readFileBytes: () => {
        reads++;
        return Promise.resolve(new Uint8Array());
      },
    });

    await assertRejects(
      () => reader.readUtf8("source.tsx", 16 * 1024 * 1024, "CSS source file"),
      TypeError,
      "exact bounded byte reader",
    );
    assertEquals(reads, 0);
  });

  it("rejects proxied capability objects without invoking traps", () => {
    let trapCalls = 0;
    const reader = new Proxy({
      readFileBytesWithinLimit: () => Promise.resolve(new Uint8Array()),
    }, {
      getOwnPropertyDescriptor(target, property) {
        trapCalls++;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      getPrototypeOf(target) {
        trapCalls++;
        return Reflect.getPrototypeOf(target);
      },
    });

    try {
      captureBoundedTextReader(reader);
      throw new Error("expected proxy rejection");
    } catch (error) {
      assertEquals(error instanceof TypeError, true);
    }
    assertEquals(trapCalls, 0);
  });

  it("does not accept a capability forged on a foreign Object.prototype", async () => {
    const foreign = runInNewContext(`
      let calls = 0;
      Object.prototype.readFileBytesWithinLimit = function () {
        calls++;
        return Promise.resolve(new Uint8Array([1]));
      };
      ({ adapter: {}, getCalls: () => calls });
    `) as { adapter: object; getCalls: () => number };
    const reader = captureBoundedTextReader(foreign.adapter);

    await assertRejects(
      () => reader.readUtf8("forged.css", 1, "Foreign CSS source"),
      TypeError,
      "exact bounded byte reader",
    );
    assertEquals(foreign.getCalls(), 0);
  });

  it("accepts an explicitly supplied null-prototype capability object", async () => {
    const adapter = Object.assign(Object.create(null), {
      readFileBytesWithinLimit: () => Promise.resolve(new TextEncoder().encode("safe")),
    });
    const reader = captureBoundedTextReader(adapter);

    assertEquals(await reader.readUtf8("safe.css", 4, "CSS source"), {
      content: "safe",
      byteLength: 4,
    });
  });

  it("does not accept a prefix-only reader as an exact bounded reader", async () => {
    let reads = 0;
    const reader = captureBoundedTextReader({
      readFileBytesBounded: () => {
        reads++;
        return Promise.resolve(new Uint8Array());
      },
    });

    await assertRejects(
      () => reader.readUtf8("source.tsx", 16, "CSS source file"),
      TypeError,
      "exact bounded byte reader",
    );
    assertEquals(reads, 0);
  });

  it("propagates proxied operational failures without invoking their traps", async () => {
    let trapCalls = 0;
    const failure = new Proxy(new Error("read failed"), {
      getPrototypeOf() {
        trapCalls++;
        throw new Error("must not run");
      },
      getOwnPropertyDescriptor() {
        trapCalls++;
        throw new Error("must not run");
      },
    });
    const reader = captureBoundedTextReader({
      readFileBytesWithinLimit: () => Promise.reject(failure),
    });

    let caught: unknown;
    try {
      await reader.readUtf8("source.tsx", 16, "CSS source file");
    } catch (error) {
      caught = error;
    }
    assertEquals(caught === failure, true);
    assertEquals(trapCalls, 0);
  });

  it("rejects SharedArrayBuffer-backed bytes before UTF-8 decoding", async () => {
    const shared = new SharedArrayBuffer(4);
    const bytes = new Uint8Array(shared);
    bytes.set([0x73, 0x61, 0x66, 0x65]);
    const reader = captureBoundedTextReader({
      readFileBytesWithinLimit: () => Promise.resolve(bytes),
    });

    await assertRejects(
      () => reader.readUtf8("shared.css", 4, "CSS source file"),
      TypeError,
      "fixed ArrayBuffer",
    );
  });

  it("rejects resizable ArrayBuffer-backed bytes before UTF-8 decoding", async () => {
    let buffer: ArrayBuffer;
    try {
      buffer = Reflect.construct(ArrayBuffer, [4, { maxByteLength: 8 }]);
    } catch {
      // Resizable ArrayBuffers are unavailable in this runtime.
      return;
    }
    if (!buffer.resizable) return;

    const bytes = new Uint8Array(buffer);
    bytes.set([0x73, 0x61, 0x66, 0x65]);
    const reader = captureBoundedTextReader({
      readFileBytesWithinLimit: () => Promise.resolve(bytes),
    });

    await assertRejects(
      () => reader.readUtf8("resizable.css", 4, "CSS source file"),
      TypeError,
      "fixed ArrayBuffer",
    );
  });
});
