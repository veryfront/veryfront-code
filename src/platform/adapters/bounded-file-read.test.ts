import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { readBoundedFileHandlePrefix, readBoundedFilePrefix } from "./bounded-file-read.ts";

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
