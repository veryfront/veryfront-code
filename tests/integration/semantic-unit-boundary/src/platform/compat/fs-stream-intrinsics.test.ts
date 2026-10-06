/**
 * Filesystem stream writes under poisoned process intrinsics.
 *
 * These cases replace process-global prototypes and the Deno open primitive to
 * prove authenticated upload/download bytes stay behind host-owned stream
 * intrinsics. Process-global replacement belongs in the semantic integration
 * suite rather than the unit file.
 */
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createFileSystem, writeStreamExclusive } from "#veryfront/platform/compat/fs.ts";

describe("filesystem stream intrinsic boundary", () => {
  it("keeps private bytes behind captured native file operations", async () => {
    const fs = createFileSystem();
    assertExists(fs.writeFileStream);
    const directory = await Deno.makeTempDir();
    const target = `${directory}/private.bin`;
    const open = Deno.open;
    const remove = Deno.remove;
    const write = Deno.FsFile.prototype.write;
    const close = Deno.FsFile.prototype.close;
    let exposed = false;
    Deno.open = async (path, options) => {
      exposed = true;
      return await open(path, options);
    };
    Deno.remove = async (path, options) => {
      exposed = true;
      await remove(path, options);
    };
    Deno.FsFile.prototype.write = function (chunk) {
      exposed = true;
      return Reflect.apply(write, this, [chunk]);
    };
    Deno.FsFile.prototype.close = function () {
      exposed = true;
      Reflect.apply(close, this, []);
    };
    try {
      const payload = new TextEncoder().encode("private-authenticated-download");
      const source = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(payload);
          controller.close();
        },
      });
      assertEquals(await fs.writeFileStream(target, source), payload.byteLength);
    } finally {
      Deno.open = open;
      Deno.remove = remove;
      Deno.FsFile.prototype.write = write;
      Deno.FsFile.prototype.close = close;
    }
    try {
      assertEquals(await Deno.readTextFile(target), "private-authenticated-download");
      assertEquals(exposed, false);
    } finally {
      await remove(directory, { recursive: true });
    }
  });

  it("cleans up a cancelled real file through captured host operations", async () => {
    const fs = createFileSystem();
    assertExists(fs.writeFileStream);
    const directory = await Deno.makeTempDir();
    const target = `${directory}/cancelled.bin`;
    const open = Deno.open;
    const remove = Deno.remove;
    const close = Deno.FsFile.prototype.close;
    const controller = new AbortController();
    let notifyRead!: () => void;
    const reading = new Promise<void>((resolve) => {
      notifyRead = resolve;
    });
    let pulls = 0;
    const source = new ReadableStream<Uint8Array>({
      pull(stream) {
        if (pulls++ === 0) stream.enqueue(new TextEncoder().encode("private-cancelled-download"));
        else notifyRead();
      },
    });
    let exposed = false;
    Deno.open = async (path, options) => {
      exposed = true;
      return await open(path, options);
    };
    Deno.remove = async (path, options) => {
      exposed = true;
      await remove(path, options);
    };
    Deno.FsFile.prototype.close = function () {
      exposed = true;
      Reflect.apply(close, this, []);
    };
    try {
      const writing = fs.writeFileStream(target, source, controller.signal);
      const rejection = assertRejects(() => writing, Error, "cancel private file");
      await reading;
      controller.abort(new Error("cancel private file"));
      await rejection;
    } finally {
      Deno.open = open;
      Deno.remove = remove;
      Deno.FsFile.prototype.close = close;
    }
    try {
      await assertRejects(() => Deno.stat(target), Deno.errors.NotFound);
      assertEquals(exposed, false);
    } finally {
      await remove(directory, { recursive: true });
    }
  });

  it("waits for source cancellation when promise catch is patched", async () => {
    const nativeCatch = Promise.prototype.catch;
    const controller = new AbortController();
    let notifyRead!: () => void;
    const reading = new Promise<void>((resolve) => {
      notifyRead = resolve;
    });
    let releaseCancellation!: () => void;
    const cancellation = new Promise<void>((resolve) => {
      releaseCancellation = resolve;
    });
    let released = false;
    let removed = false;
    let removedBeforeRelease = false;
    const source = new ReadableStream<Uint8Array>({
      pull() {
        notifyRead();
      },
      cancel() {
        return cancellation;
      },
    });
    const open = async () => ({
      write(chunk: Uint8Array) {
        return Promise.resolve(chunk.byteLength);
      },
      close() {},
    });
    const remove = async () => {
      removed = true;
      removedBeforeRelease = !released;
    };
    Promise.prototype.catch = function () {
      return Promise.resolve();
    };
    try {
      const writing = writeStreamExclusive(source, controller.signal, open, remove);
      const rejection = assertRejects(() => writing, Error, "cancel private file");
      await reading;
      controller.abort(new Error("cancel private file"));
      await new Promise((resolve) => setTimeout(resolve, 20));
      assertEquals(removed, false);
      released = true;
      releaseCancellation();
      await rejection;
      assertEquals({ removed, removedBeforeRelease }, {
        removed: true,
        removedBeforeRelease: false,
      });
    } finally {
      Promise.prototype.catch = nativeCatch;
    }
  });

  it("discards thenable cancellation rejection reasons during cleanup", async () => {
    const controller = new AbortController();
    let notifyRead!: () => void;
    const reading = new Promise<void>((resolve) => {
      notifyRead = resolve;
    });
    let removed = false;
    const source = new ReadableStream<Uint8Array>({
      pull() {
        notifyRead();
      },
      cancel() {
        return Promise.reject(new Promise(() => {}));
      },
    });
    const open = async () => ({
      write(chunk: Uint8Array) {
        return Promise.resolve(chunk.byteLength);
      },
      close() {},
    });
    const remove = async () => {
      removed = true;
    };
    const writing = writeStreamExclusive(source, controller.signal, open, remove);
    const rejection = assertRejects(() => writing, Error, "cancel private file");
    await reading;
    controller.abort(new Error("cancel private file"));
    await rejection;
    assertEquals(removed, true);
  });

  it("refuses inherited then hooks before reading private chunks", async () => {
    const objectThen = Object.getOwnPropertyDescriptor(Object.prototype, "then");
    let observed = "";
    Object.defineProperty(Object.prototype, "then", {
      configurable: true,
      get() {
        if (
          this !== null &&
          typeof this === "object" &&
          "value" in this &&
          (this as { value?: unknown }).value instanceof Uint8Array
        ) {
          observed = new TextDecoder().decode((this as { value: Uint8Array }).value);
        }
        return undefined;
      },
    });
    try {
      const source = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("private-inherited-then"));
          controller.close();
        },
      });
      await assertRejects(
        () =>
          writeStreamExclusive(
            source,
            undefined,
            async () => ({
              write(chunk: Uint8Array) {
                return Promise.resolve(chunk.byteLength);
              },
              close() {},
            }),
            async () => {},
          ),
        TypeError,
        "inherited then hook",
      );
    } finally {
      if (objectThen) Object.defineProperty(Object.prototype, "then", objectThen);
      else delete (Object.prototype as { then?: unknown }).then;
    }
    assertEquals(observed, "");
  });

  it("streams through captured reader intrinsics", async () => {
    const fs = createFileSystem();
    assertExists(fs.writeFileStream);
    const directory = await Deno.makeTempDir();
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
    try {
      const source = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([7, 8, 9]));
          controller.close();
        },
      });
      const bytes = await fs.writeFileStream(`${directory}/reader.bin`, source);
      assertEquals(bytes, 3);
    } finally {
      ReadableStream.prototype.getReader = getReader;
      ReadableStreamDefaultReader.prototype.read = read;
      ReadableStreamDefaultReader.prototype.cancel = cancel;
      ReadableStreamDefaultReader.prototype.releaseLock = releaseLock;
      await Deno.remove(directory, { recursive: true });
    }
    assertEquals(exposed, false);
  });

  it("keeps reader chunks out of promise constructor hooks", async () => {
    const fs = createFileSystem();
    assertExists(fs.writeFileStream);
    const directory = await Deno.makeTempDir();
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
      assertEquals(await fs.writeFileStream(`${directory}/promise.bin`, source), 14);
    } finally {
      restorePromiseConstructor();
      await Deno.remove(directory, { recursive: true });
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(exposed, false);
  });

  it("writes partial chunks without project subarray hooks", async () => {
    const subarray = Uint8Array.prototype.subarray;
    let writes = 0;
    let exposed = false;
    const open = async () => ({
      write(chunk: Uint8Array) {
        writes++;
        return Promise.resolve(writes === 1 ? 1 : chunk.byteLength);
      },
      close() {},
    });
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
      assertEquals(await writeStreamExclusive(source, undefined, open, async () => {}), 3);
      assertEquals(writes, 2);
    } finally {
      Uint8Array.prototype.subarray = subarray;
    }
    assertEquals(exposed, false);
  });
});
