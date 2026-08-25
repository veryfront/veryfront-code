import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import {
  readBoundedFileHandlePrefix,
  readBoundedFilePrefix,
  readFileHandleWithinLimit,
  readFileWithinLimit,
} from "./bounded-file-read.ts";

Deno.test("bounded file reads reuse a chunk across partial native reads", async () => {
  const source = new Uint8Array([1, 2, 3, 4]);
  const observedBuffers: ArrayBufferLike[] = [];
  let offset = 0;

  const bytes = await readBoundedFileHandlePrefix(
    {
      read(buffer) {
        observedBuffers.push(buffer.buffer);
        if (offset >= source.byteLength) return Promise.resolve(null);
        buffer[0] = source[offset++]!;
        return Promise.resolve(1);
      },
    },
    source.byteLength,
  );

  assertEquals([...bytes], [...source]);
  assertEquals(
    observedBuffers.every((buffer) => buffer === observedBuffers[0]),
    true,
  );
});

Deno.test("bounded file reads use captured typed-array allocation", async () => {
  const NativeUint8Array = globalThis.Uint8Array;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Uint8Array");
  const source = new NativeUint8Array([1, 2, 3, 4]);
  let offset = 0;
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
    const bytes = await readBoundedFileHandlePrefix({
      read(buffer) {
        if (offset >= source.byteLength) return Promise.resolve(null);
        const count = Math.min(buffer.byteLength, source.byteLength - offset);
        buffer.set(source.subarray(offset, offset + count));
        offset += count;
        return Promise.resolve(count);
      },
    }, 4);
    assertEquals(bytes.byteLength, 4);
    assertEquals([...bytes], [1, 2, 3, 4]);
  } finally {
    if (descriptor === undefined) {
      delete (globalThis as Record<string, unknown>).Uint8Array;
    } else {
      Object.defineProperty(globalThis, "Uint8Array", descriptor);
    }
  }
});

Deno.test("bounded file reads use captured safe-integer validation", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(Number, "isSafeInteger")!;
  let bytes: Uint8Array | undefined;
  Object.defineProperty(Number, "isSafeInteger", {
    configurable: true,
    writable: true,
    value() {
      throw new Error("ambient safe-integer validation must not run");
    },
  });
  try {
    bytes = await readBoundedFileHandlePrefix({
      read() {
        return Promise.resolve(null);
      },
    }, 1);
  } finally {
    Object.defineProperty(Number, "isSafeInteger", descriptor);
  }

  assertEquals(bytes?.byteLength, 0);
});

Deno.test("bounded file reads use captured chunk sizing", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(Math, "min")!;
  let bytes: Uint8Array | undefined;
  let read = false;
  Object.defineProperty(Math, "min", {
    configurable: true,
    writable: true,
    value() {
      throw new Error("ambient minimum function must not run");
    },
  });
  try {
    bytes = await readBoundedFileHandlePrefix({
      read(buffer) {
        if (read) return Promise.resolve(null);
        read = true;
        buffer[0] = 7;
        return Promise.resolve(1);
      },
    }, 2);
  } finally {
    Object.defineProperty(Math, "min", descriptor);
  }

  assertEquals(bytes === undefined ? undefined : [...bytes], [7]);
});

Deno.test("bounded file reads use captured chunk aggregation", async () => {
  const NativeUint8Array = globalThis.Uint8Array;
  const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, "push")!;
  const nativePush = descriptor.value as (...values: unknown[]) => number;
  let bytes: Uint8Array | undefined;
  let read = false;
  Object.defineProperty(Array.prototype, "push", {
    configurable: true,
    writable: true,
    value: function (...values: unknown[]) {
      if (values.length === 1 && values[0] instanceof NativeUint8Array) {
        throw new Error("ambient array push must not run");
      }
      return Reflect.apply(nativePush, this, values);
    },
  });
  try {
    bytes = await readBoundedFileHandlePrefix({
      read(buffer) {
        if (read) return Promise.resolve(null);
        read = true;
        buffer[0] = 9;
        return Promise.resolve(1);
      },
    }, 2);
  } finally {
    Object.defineProperty(Array.prototype, "push", descriptor);
  }

  assertEquals(bytes === undefined ? undefined : [...bytes], [9]);
});

Deno.test("bounded file reads do not consult mutable array iteration", async () => {
  const NativeUint8Array = globalThis.Uint8Array;
  const descriptor = Object.getOwnPropertyDescriptor(
    Array.prototype,
    Symbol.iterator,
  )!;
  const nativeIterator = descriptor.value as () => ArrayIterator<unknown>;
  const byteLimit = 64 * 1024 + 1;
  let bytes: Uint8Array | undefined;
  let reads = 0;
  let poisoned = false;

  try {
    bytes = await readBoundedFileHandlePrefix({
      read(buffer) {
        buffer.fill(++reads);
        if (reads === 2) {
          poisoned = true;
          Object.defineProperty(Array.prototype, Symbol.iterator, {
            configurable: true,
            writable: true,
            value: function (this: unknown) {
              if (
                Array.isArray(this) &&
                this.length === 2 &&
                this[0] instanceof NativeUint8Array &&
                this[1] instanceof NativeUint8Array
              ) {
                throw new Error("ambient array iteration must not run");
              }
              return Reflect.apply(nativeIterator, this, []);
            },
          });
        }
        return Promise.resolve(buffer.byteLength);
      },
    }, byteLimit);
  } finally {
    if (poisoned) {
      Object.defineProperty(Array.prototype, Symbol.iterator, descriptor);
    }
  }

  assertEquals(bytes?.byteLength, byteLimit);
  assertEquals(bytes?.[0], 1);
  assertEquals(bytes?.[byteLimit - 1], 2);
});

Deno.test("bounded file reads do not consult typed-array species", async () => {
  const NativeUint8Array = globalThis.Uint8Array;
  const descriptor = Object.getOwnPropertyDescriptor(NativeUint8Array.prototype, "constructor")!;
  let speciesCalls = 0;
  class HostileSpecies extends NativeUint8Array {
    constructor(length: number) {
      speciesCalls++;
      super(length);
      throw new Error("typed-array species must not run");
    }
  }
  Object.defineProperty(NativeUint8Array.prototype, "constructor", {
    configurable: true,
    writable: true,
    value: HostileSpecies,
  });
  let next = 1;
  try {
    const bytes = await readBoundedFileHandlePrefix({
      read(buffer) {
        if (next > 2) return Promise.resolve(null);
        buffer[0] = next++;
        return Promise.resolve(1);
      },
    }, 4);
    assertEquals([...bytes], [1, 2]);
    assertEquals(speciesCalls, 0);
  } finally {
    Object.defineProperty(NativeUint8Array.prototype, "constructor", descriptor);
  }
});

Deno.test("bounded file reads validate before opening and always close opened handles", async () => {
  let opened = false;
  await assertRejects(
    () =>
      readBoundedFilePrefix(async () => {
        opened = true;
        throw new Error("must not open");
      }, 0),
    RangeError,
    "positive safe integer",
  );
  assertEquals(opened, false);

  let closed = false;
  await assertRejects(
    () =>
      readBoundedFilePrefix(
        () =>
          Promise.resolve({
            close() {
              closed = true;
            },
            read() {
              return Promise.resolve(Number.NaN);
            },
          }),
        1,
      ),
    TypeError,
    "invalid byte count",
  );
  assertEquals(closed, true);
});

Deno.test("exact bounded reads distinguish an exact-size file from overflow", async () => {
  const createReader = (source: Uint8Array) => {
    let offset = 0;
    return {
      read(buffer: Uint8Array) {
        if (offset >= source.byteLength) return Promise.resolve(null);
        const bytesRead = Math.min(buffer.byteLength, source.byteLength - offset);
        buffer.set(source.subarray(offset, offset + bytesRead));
        offset += bytesRead;
        return Promise.resolve(bytesRead);
      },
    };
  };

  assertEquals(
    [...await readFileHandleWithinLimit(createReader(new Uint8Array([1, 2, 3])), 3)],
    [1, 2, 3],
  );
  await assertRejects(
    () => readFileHandleWithinLimit(createReader(new Uint8Array([1, 2, 3, 4])), 3),
    RangeError,
    "exceeds byte limit of 3 bytes",
  );
});

Deno.test("exact bounded reads validate before opening and close after overflow", async () => {
  let opened = false;
  await assertRejects(
    () =>
      readFileWithinLimit(async () => {
        opened = true;
        throw new Error("must not open");
      }, 0),
    RangeError,
    "positive safe integer",
  );
  assertEquals(opened, false);

  let closed = false;
  let reads = 0;
  await assertRejects(
    () =>
      readFileWithinLimit(
        () =>
          Promise.resolve({
            close() {
              closed = true;
            },
            read(buffer: Uint8Array) {
              buffer[0] = ++reads;
              return Promise.resolve(1);
            },
          }),
        1,
      ),
    RangeError,
    "exceeds byte limit of 1 byte",
  );
  assertEquals(closed, true);
});

Deno.test("bounded reads preserve both a primary failure and a cleanup failure", async () => {
  const readFailure = new Error("read failed");
  const closeFailure = new Error("close failed");

  try {
    await readFileWithinLimit(
      () =>
        Promise.resolve({
          close() {
            throw closeFailure;
          },
          read() {
            throw readFailure;
          },
        }),
      1,
    );
    throw new Error("expected aggregate failure");
  } catch (error) {
    assertEquals(error instanceof AggregateError, true);
    assertEquals((error as AggregateError).errors, [readFailure, closeFailure]);
  }
});

Deno.test("prefix reads preserve both a primary failure and a cleanup failure", async () => {
  const readFailure = new Error("prefix read failed");
  const closeFailure = new Error("prefix close failed");

  try {
    await readBoundedFilePrefix(
      () =>
        Promise.resolve({
          close() {
            throw closeFailure;
          },
          read() {
            throw readFailure;
          },
        }),
      1,
    );
    throw new Error("expected aggregate failure");
  } catch (error) {
    assertEquals(error instanceof AggregateError, true);
    assertEquals((error as AggregateError).errors, [readFailure, closeFailure]);
  }
});

Deno.test("exact reads preserve overflow together with a cleanup failure", async () => {
  const closeFailure = new Error("overflow close failed");
  let nextByte = 0;

  try {
    await readFileWithinLimit(
      () =>
        Promise.resolve({
          close() {
            throw closeFailure;
          },
          read(buffer: Uint8Array) {
            buffer[0] = ++nextByte;
            return Promise.resolve(1);
          },
        }),
      1,
    );
    throw new Error("expected aggregate failure");
  } catch (error) {
    assertEquals(error instanceof AggregateError, true);
    const failures = (error as AggregateError).errors;
    assertEquals(failures.length, 2);
    assertEquals(failures[0] instanceof RangeError, true);
    assertEquals(failures[1], closeFailure);
  }
});
