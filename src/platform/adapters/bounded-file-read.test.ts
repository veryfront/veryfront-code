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
