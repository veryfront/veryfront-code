import { FileSnapshotPathError } from "#veryfront/platform/adapters/file-snapshot-error.ts";
import { readNodeFileSnapshotWithinLimit } from "#veryfront/platform/adapters/runtime/shared/node-filesystem-adapter.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";

it("does not iterate snapshot promise pairs through Array.prototype", async () => {
  const originalIterator = Array.prototype[Symbol.iterator];
  const source = new Uint8Array([7]);
  const stat = {
    dev: 1n,
    ino: 2n,
    size: 1n,
    mtimeNs: 3n,
    ctimeNs: 4n,
    isFile: () => true,
    isSymbolicLink: () => false,
  };
  let realpathCalls = 0;
  let pairCalls = 0;
  const operations = {
    realpath: () => Promise.resolve(realpathCalls++ === 0 ? "/root" : "/outside/file.ts"),
    lstat: () => Promise.resolve(stat),
    open: () =>
      Promise.resolve({
        stat: () => Promise.resolve(stat),
        read: (buffer: Uint8Array) => {
          buffer.set(source);
          return Promise.resolve({ bytesRead: source.byteLength });
        },
        writeFile: () => Promise.resolve(),
        close: () => Promise.resolve(),
      }),
  };

  try {
    Array.prototype[Symbol.iterator] = function (this: unknown[]): ArrayIterator<unknown> {
      if (
        this.length === 2 &&
        this[0] instanceof Promise &&
        this[1] instanceof Promise
      ) {
        pairCalls++;
        const values = pairCalls === 1
          ? [Promise.resolve("/root/file.ts"), this[1]]
          : [this[0], Promise.resolve("/root/file.ts")];
        return Reflect.apply(originalIterator, values, []);
      }
      return Reflect.apply(originalIterator, this, []);
    };

    await assertRejects(
      () =>
        readNodeFileSnapshotWithinLimit(
          operations,
          "posix",
          1,
          "/root/file.ts",
          "/root",
          1,
        ),
      FileSnapshotPathError,
      "Snapshot target must be contained",
    );
  } finally {
    Array.prototype[Symbol.iterator] = originalIterator;
  }
});

it("rejects a POSIX snapshot escape when Array.prototype.filter is poisoned", async () => {
  const originalFilter = Array.prototype.filter;
  const source = new Uint8Array([7]);
  const stat = {
    dev: 1n,
    ino: 2n,
    size: 1n,
    mtimeNs: 3n,
    ctimeNs: 4n,
    isFile: () => true,
    isSymbolicLink: () => false,
  };
  let openCalls = 0;
  const operations = {
    realpath: (path: string) => Promise.resolve(path),
    lstat: () => Promise.resolve(stat),
    open: () => {
      openCalls++;
      return Promise.resolve({
        stat: () => Promise.resolve(stat),
        read: (buffer: Uint8Array) => {
          buffer.set(source);
          return Promise.resolve({ bytesRead: source.byteLength });
        },
        writeFile: () => Promise.resolve(),
        close: () => Promise.resolve(),
      });
    },
  };

  try {
    Array.prototype.filter = function <T>(
      this: T[],
      predicate: (value: T, index: number, array: T[]) => unknown,
      thisArg?: unknown,
    ): T[] {
      if (this[0] === "" && (this[1] === "root" || this[1] === "outside")) return [];
      return Reflect.apply(originalFilter, this, [predicate, thisArg]) as T[];
    };

    await assertRejects(
      () =>
        readNodeFileSnapshotWithinLimit(
          operations,
          "posix",
          1,
          "/outside/file.ts",
          "/root",
          1,
        ),
      FileSnapshotPathError,
      "Snapshot path must be contained",
    );
  } finally {
    Array.prototype.filter = originalFilter;
  }

  assertEquals(openCalls, 0);
});
