/**
 * Filesystem stream writes under poisoned process intrinsics.
 *
 * These cases replace process-global prototypes and the Deno open primitive to
 * prove authenticated upload/download bytes stay behind host-owned stream
 * intrinsics. Process-global replacement belongs in the semantic integration
 * suite rather than the unit file.
 */
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";

describe("filesystem stream intrinsic boundary", () => {
  it("streams through captured reader intrinsics", async () => {
    const fs = createFileSystem();
    assertExists(fs.writeFileStream);
    const open = Deno.open;
    const getReader = ReadableStream.prototype.getReader;
    const read = ReadableStreamDefaultReader.prototype.read;
    const cancel = ReadableStreamDefaultReader.prototype.cancel;
    const releaseLock = ReadableStreamDefaultReader.prototype.releaseLock;
    let exposed = false;
    Object.defineProperty(ReadableStream.prototype, "getReader", {
      configurable: true,
      value(this: ReadableStream<Uint8Array>) {
        exposed = true;
        return Reflect.apply(getReader, this, []);
      },
    });
    ReadableStreamDefaultReader.prototype.read = function () {
      exposed = true;
      return Reflect.apply(read, this, []);
    };
    ReadableStreamDefaultReader.prototype.cancel = function (reason?: unknown) {
      exposed = true;
      return Reflect.apply(cancel, this, [reason]);
    };
    ReadableStreamDefaultReader.prototype.releaseLock = function () {
      exposed = true;
      return Reflect.apply(releaseLock, this, []);
    };
    Deno.open = (async () => ({
      write(chunk: Uint8Array) {
        return Promise.resolve(chunk.byteLength);
      },
      close() {},
    })) as unknown as typeof Deno.open;
    try {
      const source = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([7, 8, 9]));
          controller.close();
        },
      });
      const bytes = await fs.writeFileStream("unused", source);
      assertEquals(bytes, 3);
    } finally {
      ReadableStream.prototype.getReader = getReader;
      ReadableStreamDefaultReader.prototype.read = read;
      ReadableStreamDefaultReader.prototype.cancel = cancel;
      ReadableStreamDefaultReader.prototype.releaseLock = releaseLock;
      Deno.open = open;
    }
    assertEquals(exposed, false);
  });

  it("keeps reader chunks out of promise constructor hooks", async () => {
    const fs = createFileSystem();
    assertExists(fs.writeFileStream);
    const open = Deno.open;
    const promiseConstructor = Object.getOwnPropertyDescriptor(Promise.prototype, "constructor");
    const then = Promise.prototype.then;
    let exposed = false;
    function restorePromiseConstructor() {
      if (promiseConstructor) {
        Object.defineProperty(Promise.prototype, "constructor", promiseConstructor);
      } else delete (Promise.prototype as unknown as { constructor?: unknown }).constructor;
    }
    function hook(this: Promise<unknown>) {
      restorePromiseConstructor();
      void (Reflect.apply(then, this, [
        (value: unknown) => {
          if (
            value !== null &&
            typeof value === "object" &&
            "value" in value &&
            (value as { value?: unknown }).value instanceof Uint8Array
          ) {
            exposed = true;
          }
        },
        () => {},
      ]) as Promise<void>);
      Object.defineProperty(Promise.prototype, "constructor", {
        configurable: true,
        get: hook,
      });
      return Promise;
    }
    Deno.open = (async () => ({
      write(chunk: Uint8Array) {
        return Promise.resolve(chunk.byteLength);
      },
      close() {},
    })) as unknown as typeof Deno.open;
    Object.defineProperty(Promise.prototype, "constructor", {
      configurable: true,
      get: hook,
    });
    try {
      const source = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("private-upload"));
          controller.close();
        },
      });
      assertEquals(await fs.writeFileStream("unused", source), 14);
    } finally {
      restorePromiseConstructor();
      Deno.open = open;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(exposed, false);
  });

  it("writes partial chunks without project subarray hooks", async () => {
    const fs = createFileSystem();
    assertExists(fs.writeFileStream);
    const open = Deno.open;
    const subarray = Uint8Array.prototype.subarray;
    let writes = 0;
    let exposed = false;
    Deno.open = (async () => ({
      write(chunk: Uint8Array) {
        writes++;
        return Promise.resolve(writes === 1 ? 1 : chunk.byteLength);
      },
      close() {},
    })) as unknown as typeof Deno.open;
    Uint8Array.prototype.subarray = function (start?: number, end?: number): Uint8Array {
      exposed = true;
      return Reflect.apply(subarray, this, [start, end]) as Uint8Array;
    };
    try {
      const source = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([7, 8, 9]));
          controller.close();
        },
      });
      assertEquals(await fs.writeFileStream("unused", source), 3);
    } finally {
      Uint8Array.prototype.subarray = subarray;
      Deno.open = open;
    }
    assertEquals(exposed, false);
  });
});
