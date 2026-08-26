import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { constants as nodeFsConstants } from "node:fs";
import { FileSnapshotChangedError } from "../../file-snapshot-error.ts";
import { isNativeFileSystemAdapter } from "../../native-file-system-provenance.ts";
import {
  hasUsableWindowsSnapshotIdentity,
  NodeCompatibleFileSystemAdapter,
  readNodeFileSnapshotWithinLimit,
  resolveNoFollowFlag,
} from "./node-filesystem-adapter.ts";
import { setupNodeFsWatcher } from "./shared-watcher.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";

type AdapterOptions = {
  noFollow?: number;
  platform?: "posix" | "windows";
  exclusiveCreate?: boolean;
  operations?: Record<string, unknown>;
};

const TestableNodeCompatibleFileSystemAdapter = NodeCompatibleFileSystemAdapter as unknown as new (
  logger?: undefined,
  options?: AdapterOptions,
) => NodeCompatibleFileSystemAdapter;

function requireSnapshotReader(adapter: NodeCompatibleFileSystemAdapter) {
  assertEquals(Object.hasOwn(adapter, "readFileSnapshotWithinLimit"), true);
  assertExists(adapter.readFileSnapshotWithinLimit);
  return adapter.readFileSnapshotWithinLimit;
}

function requireExclusiveCreator(adapter: NodeCompatibleFileSystemAdapter) {
  assertEquals(Object.hasOwn(adapter, "createFileBytesExclusive"), true);
  assertExists(adapter.createFileBytesExclusive);
  return adapter.createFileBytesExclusive;
}

describe("resolveNoFollowFlag", () => {
  it("does not throw when node:fs constants are unavailable (#3661)", () => {
    // In a browser bundle `nodeFsConstants` is `undefined`. Reading `.O_NOFOLLOW`
    // off it must degrade to "unavailable", not throw at construction. Passing
    // `undefined` for `constants` reproduces the non-Node runtime directly.
    assertEquals(resolveNoFollowFlag({}, undefined), undefined);
  });

  it("returns the runtime O_NOFOLLOW when the constants are present", () => {
    assertEquals(resolveNoFollowFlag({}, { O_NOFOLLOW: 0x20000 }), 0x20000);
  });

  it("lets an own noFollow option win over the runtime constants (test seam)", () => {
    assertEquals(resolveNoFollowFlag({ noFollow: 7 }, { O_NOFOLLOW: 0x20000 }), 7);
    // An own `undefined` means "unavailable" even when constants exist.
    assertEquals(resolveNoFollowFlag({ noFollow: undefined }, { O_NOFOLLOW: 0x20000 }), undefined);
  });
});

describe("NodeCompatibleFileSystemAdapter", () => {
  it("constructs without exact-snapshot support when node:fs constants are absent (#3661)", () => {
    // Reproduce the browser path end to end: no runtime O_NOFOLLOW available, so
    // the adapter must construct (not throw) and simply cannot bind an exact
    // inode snapshot. `noFollow: undefined` is the documented "unavailable" seam.
    const adapter = new NodeCompatibleFileSystemAdapter(undefined, {
      noFollow: undefined,
      platform: "posix",
    });
    assertEquals(
      (adapter as { readFileSnapshotWithinLimit?: unknown }).readFileSnapshotWithinLimit,
      undefined,
    );
  });

  it("reads empty and exact-limit snapshots and rejects invalid or oversized inputs", async () => {
    const root = await makeTempDir({ prefix: "veryfront-node-snapshot-" });
    try {
      const empty = `${root}/empty.bin`;
      const exact = `${root}/exact.bin`;
      const oversized = `${root}/oversized.bin`;
      const directory = `${root}/directory`;
      const link = `${root}/link.bin`;
      await Deno.writeFile(empty, new Uint8Array());
      await Deno.writeFile(exact, new Uint8Array([1, 2, 3]));
      await Deno.writeFile(oversized, new Uint8Array([1, 2, 3, 4]));
      await Deno.mkdir(directory);
      await Deno.symlink(exact, link);

      const readSnapshot = requireSnapshotReader(new NodeCompatibleFileSystemAdapter());
      assertEquals([...await readSnapshot(empty, root, 1)], []);
      assertEquals([...await readSnapshot(exact, root, 3)], [1, 2, 3]);
      await assertRejects(() => readSnapshot(oversized, root, 3), RangeError);
      for (const limit of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        await assertRejects(() => readSnapshot(exact, root, limit), RangeError);
      }
      await assertRejects(() => readSnapshot(directory, root, 3), TypeError);
      await assertRejects(() => readSnapshot(link, root, 3), TypeError);
      await assertRejects(() => readSnapshot(`${root}/../outside.bin`, root, 3), TypeError);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("accepts a canonical candidate beneath a symlinked containment root", async () => {
    if (Deno.build.os === "windows") return;
    const workspace = await makeTempDir({ prefix: "veryfront-node-snapshot-root-" });
    const physicalRoot = `${workspace}/physical`;
    const linkedRoot = `${workspace}/linked`;
    try {
      await Deno.mkdir(physicalRoot);
      await Deno.writeFile(`${physicalRoot}/asset.bin`, new Uint8Array([1, 2, 3]));
      await Deno.symlink(physicalRoot, linkedRoot);
      const canonicalCandidate = await Deno.realPath(`${linkedRoot}/asset.bin`);

      const readSnapshot = requireSnapshotReader(new NodeCompatibleFileSystemAdapter());
      assertEquals([...await readSnapshot(canonicalCandidate, linkedRoot, 3)], [1, 2, 3]);
    } finally {
      await Deno.remove(workspace, { recursive: true });
    }
  });

  it("omits snapshot authority on POSIX when O_NOFOLLOW is absent or zero", () => {
    for (const noFollow of [undefined, 0]) {
      const adapter = new TestableNodeCompatibleFileSystemAdapter(undefined, {
        noFollow,
        platform: "posix",
      });
      assertEquals(Object.hasOwn(adapter, "readFileSnapshotWithinLimit"), false);
      assertEquals(adapter.readFileSnapshotWithinLimit, undefined);
      assertEquals(Object.hasOwn(adapter, "createFileBytesExclusive"), true);
    }
  });

  it("reads an exact Windows snapshot through an identity-verified handle", async () => {
    const source = new Uint8Array([4, 5, 6]);
    const stat = {
      dev: 1n,
      ino: 2n,
      size: BigInt(source.byteLength),
      mtimeNs: 4n,
      ctimeNs: 5n,
      isFile: () => true,
      isSymbolicLink: () => false,
    };
    const openedWith: Array<number | string> = [];
    const operations = {
      realpath: (path: string) => Promise.resolve(path),
      lstat: () => Promise.resolve(stat),
      open: (_path: string, flags: number | string) => {
        openedWith.push(flags);
        return Promise.resolve({
          stat: () => Promise.resolve(stat),
          read: (buffer: Uint8Array, offset: number, length: number, position: number) => {
            buffer.set(source.subarray(position, position + length), offset);
            return Promise.resolve({ bytesRead: length });
          },
          writeFile: () => Promise.resolve(),
          close: () => Promise.resolve(),
        });
      },
    };
    assertEquals(
      [
        ...await readNodeFileSnapshotWithinLimit(
          operations,
          "windows",
          0,
          "C:\\root\\file.bin",
          "C:\\root",
          3,
        ),
      ],
      [4, 5, 6],
    );
    assertEquals(openedWith, ["r"]);
  });

  it("opens a POSIX snapshot with the runtime no-follow flag", async () => {
    const source = new Uint8Array([7, 8, 9]);
    const stat = {
      dev: 1n,
      ino: 2n,
      size: BigInt(source.byteLength),
      mtimeNs: 4n,
      ctimeNs: 5n,
      isFile: () => true,
      isSymbolicLink: () => false,
    };
    const openedWith: Array<number | string> = [];
    const operations = {
      realpath: (path: string) => Promise.resolve(path),
      lstat: () => Promise.resolve(stat),
      open: (_path: string, flags: number | string) => {
        openedWith.push(flags);
        return Promise.resolve({
          stat: () => Promise.resolve(stat),
          read: (buffer: Uint8Array, offset: number, length: number, position: number) => {
            buffer.set(source.subarray(position, position + length), offset);
            return Promise.resolve({ bytesRead: length });
          },
          writeFile: () => Promise.resolve(),
          close: () => Promise.resolve(),
        });
      },
    };
    assertEquals(
      [
        ...await readNodeFileSnapshotWithinLimit(
          operations,
          "posix",
          0x20000,
          "/root/file.bin",
          "/root",
          3,
        ),
      ],
      [7, 8, 9],
      "a POSIX snapshot must read the exact admitted bytes",
    );
    assertEquals(
      openedWith,
      [nodeFsConstants.O_RDONLY | 0x20000],
      "POSIX snapshot opens must carry O_NOFOLLOW",
    );
  });

  it("preserves a literal POSIX backslash through snapshot resolution", async () => {
    const source = new Uint8Array([7]);
    const stat = {
      dev: 1n,
      ino: 2n,
      size: 1n,
      mtimeNs: 4n,
      ctimeNs: 5n,
      isFile: () => true,
      isSymbolicLink: () => false,
    };
    const realPaths: string[] = [];
    const lstatPaths: string[] = [];
    const openedPaths: string[] = [];
    const operations = {
      realpath: (path: string) => {
        realPaths.push(path);
        return Promise.resolve(path);
      },
      lstat: (path: string) => {
        lstatPaths.push(path);
        return Promise.resolve(stat);
      },
      open: (path: string) => {
        openedPaths.push(path);
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
    const candidate = String.raw`/root/a\b.tsx`;

    assertEquals(
      [
        ...await readNodeFileSnapshotWithinLimit(
          operations,
          "posix",
          0x20000,
          candidate,
          "/root",
          1,
        ),
      ],
      [7],
    );
    assertEquals(realPaths, ["/root", candidate, candidate]);
    assertEquals(lstatPaths, [candidate, candidate, candidate]);
    assertEquals(openedPaths, [candidate]);
  });

  it("rejects a Windows lexical containment escape before candidate filesystem access", async () => {
    let operationCalls = 0;
    const operations = {
      realpath: () => {
        operationCalls++;
        return Promise.resolve("C:/root");
      },
      lstat: () => {
        operationCalls++;
        throw new Error("outside paths must not be inspected");
      },
      open: () => {
        operationCalls++;
        throw new Error("outside paths must not be opened");
      },
    };

    await assertRejects(
      () =>
        readNodeFileSnapshotWithinLimit(
          operations,
          "windows",
          0,
          "C:\\outside\\file.bin",
          "C:\\root",
          1,
        ),
      TypeError,
      "Snapshot path must be contained",
    );
    // Canonicalizing the trusted root is required to admit canonical candidates
    // beneath symlinked roots. The untrusted candidate is never inspected.
    assertEquals(operationCalls, 1);
  });

  it("rejects a Windows canonical target outside the containment root", async () => {
    const source = new Uint8Array([7]);
    const stat = {
      dev: 1n,
      ino: 2n,
      size: 1n,
      mtimeNs: 4n,
      ctimeNs: 5n,
      isFile: () => true,
      isSymbolicLink: () => false,
    };
    let realpathCalls = 0;
    let closeCalls = 0;
    const operations = {
      realpath: () =>
        Promise.resolve(
          realpathCalls++ === 0 ? "C:/root" : "C:/outside/file.bin",
        ),
      lstat: () => Promise.resolve(stat),
      open: () =>
        Promise.resolve({
          stat: () => Promise.resolve(stat),
          read: (buffer: Uint8Array) => {
            buffer.set(source);
            return Promise.resolve({ bytesRead: source.byteLength });
          },
          writeFile: () => Promise.resolve(),
          close: () => {
            closeCalls++;
            return Promise.resolve();
          },
        }),
    };

    await assertRejects(
      () =>
        readNodeFileSnapshotWithinLimit(
          operations,
          "windows",
          0,
          "C:\\root\\linked\\file.bin",
          "C:\\root",
          1,
        ),
      TypeError,
      "Snapshot target must be contained",
    );
    assertEquals(closeCalls, 1);
  });

  it("fails closed when Windows cannot provide a stable native file identity", async () => {
    let opens = 0;
    const stat = {
      dev: 0n,
      ino: 2n,
      size: 1n,
      mtimeNs: 4n,
      ctimeNs: 5n,
      isFile: () => true,
      isSymbolicLink: () => false,
    };
    const operations = {
      realpath: (path: string) => Promise.resolve(path),
      lstat: () => Promise.resolve(stat),
      open: () => {
        opens++;
        throw new Error("must not open without an identity");
      },
    };

    await assertRejects(
      () =>
        readNodeFileSnapshotWithinLimit(
          operations,
          "windows",
          0,
          "C:\\root\\file.bin",
          "C:\\root",
          1,
        ),
      FileSnapshotChangedError,
      "Stable native file identity is unavailable",
    );
    assertEquals(opens, 0);
  });

  it("publishes Windows snapshot authority only for Node's usable identity contract", () => {
    assertEquals(hasUsableWindowsSnapshotIdentity("node"), true);
    for (const runtime of ["bun", "deno", "unknown"] as const) {
      assertEquals(hasUsableWindowsSnapshotIdentity(runtime), false);
    }

    // This suite runs under Deno, so forcing Windows path semantics must not
    // turn the shared adapter into a Node-provenance publisher.
    const adapter = new TestableNodeCompatibleFileSystemAdapter(undefined, {
      noFollow: 0,
      platform: "windows",
      operations: {
        realpath: (path: string) => Promise.resolve(path),
        lstat: () =>
          Promise.resolve({
            dev: 1n,
            ino: 2n,
            size: 0n,
            mtimeNs: 3n,
            ctimeNs: 4n,
            isFile: () => true,
            isSymbolicLink: () => false,
          }),
        open: () => {
          throw new Error("unpublished capability must not open files");
        },
      },
    });
    assertEquals(Object.hasOwn(adapter, "readFileSnapshotWithinLimit"), false);
    assertEquals(adapter.readFileSnapshotWithinLimit, undefined);
    assertEquals(Object.hasOwn(adapter, "createFileBytesExclusive"), true);
  });

  it("omits exclusive create independently from available snapshot authority", () => {
    const adapter = new TestableNodeCompatibleFileSystemAdapter(undefined, {
      noFollow: 1,
      exclusiveCreate: false,
    });
    assertEquals(Object.hasOwn(adapter, "readFileSnapshotWithinLimit"), true);
    assertEquals(Object.hasOwn(adapter, "createFileBytesExclusive"), false);
  });

  it("rejects oversize from handle metadata without reading or retaining limit plus one", async () => {
    let readCalls = 0;
    const stat = {
      dev: 1n,
      ino: 2n,
      size: 3n,
      mtimeNs: 4n,
      ctimeNs: 5n,
      isFile: () => true,
      isSymbolicLink: () => false,
    };
    const operations = {
      realpath: () => Promise.resolve("/root"),
      lstat: () => Promise.resolve(stat),
      open: () =>
        Promise.resolve({
          stat: () => Promise.resolve(stat),
          read: () => {
            readCalls++;
            return Promise.resolve({ bytesRead: 0 });
          },
          close: () => Promise.resolve(),
        }),
    };
    const adapter = new TestableNodeCompatibleFileSystemAdapter(undefined, {
      noFollow: 1,
      operations,
    });

    await assertRejects(
      () => requireSnapshotReader(adapter)("/root/file.bin", "/root", 2),
      RangeError,
    );
    assertEquals(readCalls, 0);
  });

  it("does not report allocation capacity failure as byte-limit overflow", async () => {
    const stat = {
      dev: 1n,
      ino: 2n,
      size: BigInt(Number.MAX_SAFE_INTEGER),
      mtimeNs: 4n,
      ctimeNs: 5n,
      isFile: () => true,
      isSymbolicLink: () => false,
    };
    const adapter = new TestableNodeCompatibleFileSystemAdapter(undefined, {
      noFollow: 1,
      operations: {
        realpath: (path: string) => Promise.resolve(path),
        lstat: () => Promise.resolve(stat),
        open: () =>
          Promise.resolve({
            stat: () => Promise.resolve(stat),
            close: () => Promise.resolve(),
          }),
      },
    });

    const error = await assertRejects(
      () =>
        requireSnapshotReader(adapter)(
          "/root/file.bin",
          "/root",
          Number.MAX_SAFE_INTEGER,
        ),
      Error,
    );
    assertEquals(error instanceof RangeError, false);
  });

  it("reads only the opened handle and rejects pathname replacement", async () => {
    const opened = {
      dev: 1n,
      ino: 2n,
      size: 3n,
      mtimeNs: 4n,
      ctimeNs: 5n,
      isFile: () => true,
      isSymbolicLink: () => false,
    };
    const replacement = { ...opened, ino: 9n };
    let lstatCalls = 0;
    let openCalls = 0;
    let closed = false;
    const operations = {
      realpath: () => Promise.resolve("/root/file.bin"),
      lstat: () => Promise.resolve(lstatCalls++ === 0 ? opened : replacement),
      open: () => {
        openCalls++;
        return Promise.resolve({
          stat: () => Promise.resolve(opened),
          read: (buffer: Uint8Array) => {
            buffer.set([1, 2, 3]);
            return Promise.resolve({ bytesRead: 3 });
          },
          close: () => {
            closed = true;
            return Promise.resolve();
          },
        });
      },
    };
    const adapter = new TestableNodeCompatibleFileSystemAdapter(undefined, {
      noFollow: 1,
      operations,
    });

    await assertRejects(
      () => requireSnapshotReader(adapter)("/root/file.bin", "/root", 3),
      FileSnapshotChangedError,
    );
    assertEquals(openCalls, 1);
    assertEquals(closed, true);
  });

  it("wraps post-lstat open failure as snapshot identity uncertainty", async () => {
    const openFailure = Object.assign(new Error("pathname removed before open"), {
      code: "ENOENT",
    });
    const stat = {
      dev: 1n,
      ino: 2n,
      size: 3n,
      mtimeNs: 4n,
      ctimeNs: 5n,
      isFile: () => true,
      isSymbolicLink: () => false,
    };
    let lstatCalls = 0;
    const adapter = new TestableNodeCompatibleFileSystemAdapter(undefined, {
      noFollow: 1,
      operations: {
        realpath: (path: string) => Promise.resolve(path),
        lstat: () => {
          lstatCalls++;
          return Promise.resolve(stat);
        },
        open: () => Promise.reject(openFailure),
      },
    });

    const error = await assertRejects(
      () => requireSnapshotReader(adapter)("/root/file.bin", "/root", 3),
      FileSnapshotChangedError,
    ) as FileSnapshotChangedError & { cause?: unknown };
    assertEquals(error.cause, openFailure);
    assertEquals(lstatCalls, 1);
  });

  it("brands a no-follow open symlink race as snapshot identity uncertainty", async () => {
    const symlinkRace = Object.assign(new Error("pathname replaced by a symlink"), {
      code: "ELOOP",
    });
    const stat = {
      dev: 1n,
      ino: 2n,
      size: 3n,
      mtimeNs: 4n,
      ctimeNs: 5n,
      isFile: () => true,
      isSymbolicLink: () => false,
    };
    let lstatCalls = 0;
    const adapter = new TestableNodeCompatibleFileSystemAdapter(undefined, {
      noFollow: 1,
      operations: {
        realpath: (path: string) => Promise.resolve(path),
        lstat: () => {
          lstatCalls++;
          return Promise.resolve(stat);
        },
        open: () => Promise.reject(symlinkRace),
      },
    });

    const error = await assertRejects(
      () => requireSnapshotReader(adapter)("/root/file.bin", "/root", 3),
      FileSnapshotChangedError,
    ) as FileSnapshotChangedError & { cause?: unknown };
    assertStrictEquals(error.cause, symlinkRace);
    assertEquals(lstatCalls, 1);
  });

  it("propagates operational post-lstat open failures with exact identity", async () => {
    const permissionFailure = Object.assign(new Error("snapshot open denied"), {
      code: "EACCES",
    });
    const stat = {
      dev: 1n,
      ino: 2n,
      size: 3n,
      mtimeNs: 4n,
      ctimeNs: 5n,
      isFile: () => true,
      isSymbolicLink: () => false,
    };
    const adapter = new TestableNodeCompatibleFileSystemAdapter(undefined, {
      noFollow: 1,
      operations: {
        realpath: (path: string) => Promise.resolve(path),
        lstat: () => Promise.resolve(stat),
        open: () => Promise.reject(permissionFailure),
      },
    });

    const error = await assertRejects(
      () => requireSnapshotReader(adapter)("/root/file.bin", "/root", 3),
      Error,
      "snapshot open denied",
    );
    assertStrictEquals(error, permissionFailure);
  });

  it("propagates a plain ENOENT-shaped post-lstat open rejection unchanged", async () => {
    const failure = Object.freeze({ code: "ENOENT" });
    const stat = {
      dev: 1n,
      ino: 2n,
      size: 3n,
      mtimeNs: 4n,
      ctimeNs: 5n,
      isFile: () => true,
      isSymbolicLink: () => false,
    };
    const adapter = new TestableNodeCompatibleFileSystemAdapter(undefined, {
      noFollow: 1,
      operations: {
        realpath: (path: string) => Promise.resolve(path),
        lstat: () => Promise.resolve(stat),
        open: () => Promise.reject(failure),
      },
    });

    const actual = await assertRejects(() =>
      requireSnapshotReader(adapter)("/root/file.bin", "/root", 3)
    );

    assertStrictEquals(actual, failure);
  });

  it("wraps the first handle metadata failure as snapshot identity uncertainty", async () => {
    const statFailure = Object.assign(new Error("opened handle identity unavailable"), {
      code: "ENOENT",
    });
    const pathnameStat = {
      dev: 1n,
      ino: 2n,
      size: 3n,
      mtimeNs: 4n,
      ctimeNs: 5n,
      isFile: () => true,
      isSymbolicLink: () => false,
    };
    let closeCalls = 0;
    const adapter = new TestableNodeCompatibleFileSystemAdapter(undefined, {
      noFollow: 1,
      operations: {
        realpath: (path: string) => Promise.resolve(path),
        lstat: () => Promise.resolve(pathnameStat),
        open: () =>
          Promise.resolve({
            stat: () => Promise.reject(statFailure),
            close: () => {
              closeCalls++;
              return Promise.resolve();
            },
          }),
      },
    });

    const error = await assertRejects(
      () => requireSnapshotReader(adapter)("/root/file.bin", "/root", 3),
      FileSnapshotChangedError,
    ) as FileSnapshotChangedError & { cause?: unknown };
    assertEquals(error.cause, statFailure);
    assertEquals(closeCalls, 1);
  });

  it("propagates a first handle metadata ELOOP with exact identity", async () => {
    const symlinkLoop = Object.assign(new Error("opened handle reported a symlink loop"), {
      code: "ELOOP",
    });
    const pathnameStat = {
      dev: 1n,
      ino: 2n,
      size: 3n,
      mtimeNs: 4n,
      ctimeNs: 5n,
      isFile: () => true,
      isSymbolicLink: () => false,
    };
    let closeCalls = 0;
    const adapter = new TestableNodeCompatibleFileSystemAdapter(undefined, {
      noFollow: 1,
      operations: {
        realpath: (path: string) => Promise.resolve(path),
        lstat: () => Promise.resolve(pathnameStat),
        open: () =>
          Promise.resolve({
            stat: () => Promise.reject(symlinkLoop),
            close: () => {
              closeCalls++;
              return Promise.resolve();
            },
          }),
      },
    });

    const error = await assertRejects(
      () => requireSnapshotReader(adapter)("/root/file.bin", "/root", 3),
      Error,
    );
    assertStrictEquals(error, symlinkLoop);
    assertEquals(closeCalls, 1);
  });

  it("preserves snapshot verification and handle cleanup failures", async () => {
    const statFailure = Object.assign(new Error("opened handle identity unavailable"), {
      code: "EIO",
    });
    const closeFailure = new Error("snapshot handle close failed");
    const pathnameStat = {
      dev: 1n,
      ino: 2n,
      size: 3n,
      mtimeNs: 4n,
      ctimeNs: 5n,
      isFile: () => true,
      isSymbolicLink: () => false,
    };
    let closeCalls = 0;
    const adapter = new TestableNodeCompatibleFileSystemAdapter(undefined, {
      noFollow: 1,
      operations: {
        realpath: (path: string) => Promise.resolve(path),
        lstat: () => Promise.resolve(pathnameStat),
        open: () =>
          Promise.resolve({
            stat: () => Promise.reject(statFailure),
            close: () => {
              closeCalls++;
              return Promise.reject(closeFailure);
            },
          }),
      },
    });

    const error = await assertRejects(
      () => requireSnapshotReader(adapter)("/root/file.bin", "/root", 3),
      AggregateError,
    ) as AggregateError;
    assertEquals(error.errors.length, 2);
    assertStrictEquals(error.errors[0], statFailure);
    assertEquals(error.errors[1], closeFailure);
    assertEquals(closeCalls, 1);
  });

  it("brands a pathname symlink race during verification as a snapshot change", async () => {
    const symlinkRace = Object.assign(new Error("pathname became a symlink"), {
      code: "ELOOP",
    });
    const stat = {
      dev: 1n,
      ino: 2n,
      size: 3n,
      mtimeNs: 4n,
      ctimeNs: 5n,
      isFile: () => true,
      isSymbolicLink: () => false,
    };
    let lstatCalls = 0;
    let closeCalls = 0;
    const adapter = new TestableNodeCompatibleFileSystemAdapter(undefined, {
      noFollow: 1,
      operations: {
        realpath: (path: string) => Promise.resolve(path),
        lstat: () => {
          lstatCalls++;
          return lstatCalls === 1 ? Promise.resolve(stat) : Promise.reject(symlinkRace);
        },
        open: () =>
          Promise.resolve({
            stat: () => Promise.resolve(stat),
            close: () => {
              closeCalls++;
              return Promise.resolve();
            },
          }),
      },
    });

    const error = await assertRejects(
      () => requireSnapshotReader(adapter)("/root/file.bin", "/root", 3),
      FileSnapshotChangedError,
    ) as FileSnapshotChangedError & { cause?: unknown };
    assertStrictEquals(error.cause, symlinkRace);
    assertEquals(closeCalls, 1);
  });

  it("propagates operational pathname verification failures with exact identity", async () => {
    const permissionFailure = Object.assign(new Error("snapshot verification denied"), {
      code: "EACCES",
    });
    const stat = {
      dev: 1n,
      ino: 2n,
      size: 3n,
      mtimeNs: 4n,
      ctimeNs: 5n,
      isFile: () => true,
      isSymbolicLink: () => false,
    };
    let lstatCalls = 0;
    let closeCalls = 0;
    const adapter = new TestableNodeCompatibleFileSystemAdapter(undefined, {
      noFollow: 1,
      operations: {
        realpath: (path: string) => Promise.resolve(path),
        lstat: () => {
          lstatCalls++;
          return lstatCalls === 1 ? Promise.resolve(stat) : Promise.reject(permissionFailure);
        },
        open: () =>
          Promise.resolve({
            stat: () => Promise.resolve(stat),
            close: () => {
              closeCalls++;
              return Promise.resolve();
            },
          }),
      },
    });

    const error = await assertRejects(
      () => requireSnapshotReader(adapter)("/root/file.bin", "/root", 3),
      Error,
      "snapshot verification denied",
    );
    assertStrictEquals(error, permissionFailure);
    assertEquals(closeCalls, 1);
  });

  it("propagates operational post-read verification failures with exact identity", async () => {
    const ioFailure = Object.assign(new Error("snapshot verification device failed"), {
      code: "EIO",
    });
    const stat = {
      dev: 1n,
      ino: 2n,
      size: 3n,
      mtimeNs: 4n,
      ctimeNs: 5n,
      isFile: () => true,
      isSymbolicLink: () => false,
    };
    let handleStatCalls = 0;
    let closeCalls = 0;
    const adapter = new TestableNodeCompatibleFileSystemAdapter(undefined, {
      noFollow: 1,
      operations: {
        realpath: (path: string) => Promise.resolve(path),
        lstat: () => Promise.resolve(stat),
        open: () =>
          Promise.resolve({
            stat: () => handleStatCalls++ === 0 ? Promise.resolve(stat) : Promise.reject(ioFailure),
            read: (buffer: Uint8Array) => {
              buffer.set([1, 2, 3]);
              return Promise.resolve({ bytesRead: 3 });
            },
            close: () => {
              closeCalls++;
              return Promise.resolve();
            },
          }),
      },
    });

    const error = await assertRejects(
      () => requireSnapshotReader(adapter)("/root/file.bin", "/root", 3),
      Error,
      "snapshot verification device failed",
    );
    assertStrictEquals(error, ioFailure);
    assertEquals(closeCalls, 1);
  });

  it("propagates a post-read handle metadata ELOOP with exact identity", async () => {
    const symlinkLoop = Object.assign(new Error("opened handle reported a symlink loop"), {
      code: "ELOOP",
    });
    const stat = {
      dev: 1n,
      ino: 2n,
      size: 3n,
      mtimeNs: 4n,
      ctimeNs: 5n,
      isFile: () => true,
      isSymbolicLink: () => false,
    };
    let handleStatCalls = 0;
    let closeCalls = 0;
    const adapter = new TestableNodeCompatibleFileSystemAdapter(undefined, {
      noFollow: 1,
      operations: {
        realpath: (path: string) => Promise.resolve(path),
        lstat: () => Promise.resolve(stat),
        open: () =>
          Promise.resolve({
            stat: () =>
              handleStatCalls++ === 0 ? Promise.resolve(stat) : Promise.reject(symlinkLoop),
            read: (buffer: Uint8Array) => {
              buffer.set([1, 2, 3]);
              return Promise.resolve({ bytesRead: 3 });
            },
            close: () => {
              closeCalls++;
              return Promise.resolve();
            },
          }),
      },
    });

    const error = await assertRejects(
      () => requireSnapshotReader(adapter)("/root/file.bin", "/root", 3),
      Error,
    );
    assertStrictEquals(error, symlinkLoop);
    assertEquals(closeCalls, 1);
  });

  it("rejects mutation of the opened file between metadata reads", async () => {
    const before = {
      dev: 1n,
      ino: 2n,
      size: 3n,
      mtimeNs: 4n,
      ctimeNs: 5n,
      isFile: () => true,
      isSymbolicLink: () => false,
    };
    const after = { ...before, mtimeNs: 8n, ctimeNs: 9n };
    let handleStatCalls = 0;
    const operations = {
      realpath: () => Promise.resolve("/root/file.bin"),
      lstat: () => Promise.resolve(before),
      open: () =>
        Promise.resolve({
          stat: () => Promise.resolve(handleStatCalls++ === 0 ? before : after),
          read: (buffer: Uint8Array) => {
            buffer.set([1, 2, 3]);
            return Promise.resolve({ bytesRead: 3 });
          },
          close: () => Promise.resolve(),
        }),
    };
    const adapter = new TestableNodeCompatibleFileSystemAdapter(undefined, {
      noFollow: 1,
      operations,
    });

    await assertRejects(
      () => requireSnapshotReader(adapter)("/root/file.bin", "/root", 3),
      FileSnapshotChangedError,
    );
  });

  it("creates byte files exclusively and never truncates colliding entries", async () => {
    const root = await makeTempDir({ prefix: "veryfront-node-exclusive-" });
    try {
      const absent = `${root}/created.bin`;
      const existing = `${root}/existing.bin`;
      const directory = `${root}/directory`;
      await Deno.writeFile(existing, new Uint8Array([9, 8, 7]));
      await Deno.mkdir(directory);
      const createExclusive = requireExclusiveCreator(new NodeCompatibleFileSystemAdapter());

      await createExclusive(absent, new Uint8Array([0, 255, 1]));
      assertEquals([...await Deno.readFile(absent)], [0, 255, 1]);
      await assertRejects(() => createExclusive(existing, new Uint8Array([1])), Error);
      assertEquals([...await Deno.readFile(existing)], [9, 8, 7]);
      await assertRejects(() => createExclusive(directory, new Uint8Array([1])), Error);
      assertEquals((await Deno.stat(directory)).isDirectory, true);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("does not guess ownership by deleting a reserved path after write failure", async () => {
    const root = await makeTempDir({ prefix: "veryfront-node-reserved-" });
    try {
      const target = `${root}/reserved.bin`;
      await Deno.writeFile(target, new Uint8Array([9, 8, 7]));
      let closeCalls = 0;
      const failure = new Error("injected write failure");
      const operations = {
        open: () =>
          Promise.resolve({
            writeFile: () => Promise.reject(failure),
            close: () => {
              closeCalls++;
              return Promise.resolve();
            },
          }),
      };
      const adapter = new TestableNodeCompatibleFileSystemAdapter(undefined, { operations });

      const error = await assertRejects(
        () => requireExclusiveCreator(adapter)(target, new Uint8Array([1])),
        Error,
      );
      assertEquals(error, failure);
      assertEquals(closeCalls, 1);
      assertEquals(
        (await Deno.lstat(target)).isFile,
        true,
        "a failed exclusive write must not delete a path the adapter does not own",
      );
      assertEquals(
        [...await Deno.readFile(target)],
        [9, 8, 7],
        "the pre-existing bytes must survive the failed write",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("preserves exclusive-create write and handle cleanup failures", async () => {
    const writeFailure = new Error("injected write failure");
    const closeFailure = new Error("exclusive-create handle close failed");
    let closeCalls = 0;
    const adapter = new TestableNodeCompatibleFileSystemAdapter(undefined, {
      operations: {
        open: () =>
          Promise.resolve({
            writeFile: () => Promise.reject(writeFailure),
            close: () => {
              closeCalls++;
              return Promise.reject(closeFailure);
            },
          }),
      },
    });

    const error = await assertRejects(
      () => requireExclusiveCreator(adapter)("/reserved.bin", new Uint8Array([1])),
      AggregateError,
    ) as AggregateError;
    assertEquals(error.errors, [writeFailure, closeFailure]);
    assertEquals(closeCalls, 1);
  });

  it("reports handle cleanup failure after a successful exclusive create", async () => {
    const closeFailure = new Error("exclusive-create handle close failed");
    let writeCalls = 0;
    let closeCalls = 0;
    const adapter = new TestableNodeCompatibleFileSystemAdapter(undefined, {
      operations: {
        open: () =>
          Promise.resolve({
            writeFile: () => {
              writeCalls++;
              return Promise.resolve();
            },
            close: () => {
              closeCalls++;
              return Promise.reject(closeFailure);
            },
          }),
      },
    });

    const error = await assertRejects(
      () => requireExclusiveCreator(adapter)("/reserved.bin", new Uint8Array([1])),
      Error,
    );
    assertEquals(error, closeFailure);
    assertEquals(writeCalls, 1);
    assertEquals(closeCalls, 1);
  });

  it("marks only direct built-in instances as native", () => {
    class DerivedAdapter extends NodeCompatibleFileSystemAdapter {}

    assertEquals(
      isNativeFileSystemAdapter(new NodeCompatibleFileSystemAdapter()),
      true,
    );
    assertEquals(isNativeFileSystemAdapter(new DerivedAdapter()), false);
  });

  it("refuses a subclass that hides its own prototype.constructor", () => {
    class ConstructorDeletingAdapter extends NodeCompatibleFileSystemAdapter {}
    Reflect.deleteProperty(ConstructorDeletingAdapter.prototype, "constructor");

    class ConstructorSpoofingAdapter extends NodeCompatibleFileSystemAdapter {}
    Object.defineProperty(ConstructorSpoofingAdapter.prototype, "constructor", {
      configurable: true,
      value: NodeCompatibleFileSystemAdapter,
    });

    assertEquals(
      isNativeFileSystemAdapter(new ConstructorDeletingAdapter()),
      false,
    );
    assertEquals(
      isNativeFileSystemAdapter(new ConstructorSpoofingAdapter()),
      false,
    );
  });

  it("does not disguise invalid paths as missing", async () => {
    const adapter = new NodeCompatibleFileSystemAdapter();
    await assertRejects(() => adapter.exists("\0"), TypeError);
  });

  it("provides consistent text, byte, metadata, and symlink operations", async () => {
    const root = await makeTempDir({ prefix: "veryfront-node-fs-" });
    try {
      const adapter = new NodeCompatibleFileSystemAdapter();
      assertEquals(isNativeFileSystemAdapter(adapter), true);
      const file = `${root}/file.txt`;
      const largeFile = `${root}/large.bin`;
      const writtenBinaryFile = `${root}/written.bin`;
      const link = `${root}/file-link.txt`;

      await adapter.writeFile(file, "hello");
      const largeBytes = new Uint8Array(70_000);
      for (let index = 0; index < largeBytes.byteLength; index++) {
        largeBytes[index] = index % 251;
      }
      await Deno.writeFile(largeFile, largeBytes);
      const writtenBytes = new Uint8Array([0, 255, 1, 128]);
      await adapter.writeFileBytes(writtenBinaryFile, writtenBytes);
      await Deno.symlink(file, link);

      assertEquals(await adapter.readFile(file), "hello");
      assertEquals([...await adapter.readFileBytes(file)], [104, 101, 108, 108, 111]);
      assertEquals([...await adapter.readFileBytes(writtenBinaryFile)], [...writtenBytes]);
      assertEquals(
        [...await adapter.readFileBytesBounded(file, 3)],
        [104, 101, 108],
      );
      assertEquals(
        [...await adapter.readFileBytesBounded(file, 8)],
        [104, 101, 108, 108, 111],
      );
      await assertRejects(
        () => adapter.readFileBytesBounded(file, 0),
        RangeError,
        "positive safe integer",
      );
      const largePrefix = await adapter.readFileBytesBounded(largeFile, 65_537);
      assertEquals(largePrefix.byteLength, 65_537);
      assertEquals(largePrefix[65_536], largeBytes[65_536]);
      assertEquals(
        [...await adapter.readFileBytesWithinLimit(file, 5)],
        [104, 101, 108, 108, 111],
      );
      await assertRejects(
        () => adapter.readFileBytesWithinLimit(file, 4),
        RangeError,
        "exceeds byte limit of 4 bytes",
      );
      await assertRejects(
        () => adapter.readFileBytesWithinLimit(file, 0),
        RangeError,
        "positive safe integer",
      );
      assertEquals((await adapter.stat(link)).isSymlink, false);
      assertEquals((await adapter.lstat(link)).isSymlink, true);
      assertEquals(await adapter.realPath(link), await Deno.realPath(file));
      assertEquals(await adapter.exists(file), true);
      assertEquals(await adapter.exists(`${root}/missing.txt`), false);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("closes watcher resources when iteration returns", async () => {
    const root = await makeTempDir({ prefix: "veryfront-node-watch-" });
    try {
      const watcher = new NodeCompatibleFileSystemAdapter().watch(root, {
        recursive: false,
      });
      assertExists(watcher.ready);
      await watcher.ready;
      assertExists(watcher.done);
      let done = false;
      void watcher.done.then(() => {
        done = true;
      });
      await Promise.resolve();
      assertEquals(done, false);

      const result = await watcher[Symbol.asyncIterator]().return?.();
      assertEquals(result?.done, true);
      await watcher.done;
      assertEquals(done, true);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("settles watcher shutdown when the caller aborts", async () => {
    const root = await makeTempDir({ prefix: "veryfront-node-watch-abort-" });
    try {
      const controller = new AbortController();
      const watcher = new NodeCompatibleFileSystemAdapter().watch(root, {
        recursive: true,
        signal: controller.signal,
      });
      controller.abort();

      assertExists(watcher.ready);
      await watcher.ready;
      assertExists(watcher.done);
      await watcher.done;
      assertEquals((await watcher[Symbol.asyncIterator]().next()).done, true);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("rejects watcher readiness when the requested root cannot be acquired", async () => {
    const root = await makeTempDir({ prefix: "veryfront-node-watch-missing-" });
    const missingRoot = `${root}/missing`;
    const watcher = new NodeCompatibleFileSystemAdapter().watch(missingRoot, {
      recursive: true,
    });

    try {
      assertExists(watcher.ready);
      await assertRejects(() => watcher.ready!, Error);
    } finally {
      watcher.close();
      await watcher.done?.catch(() => undefined);
      await Deno.remove(root, { recursive: true });
    }
  });

  it("rejects completion with every native watcher teardown failure", async () => {
    const firstFailure = new Error("first close failed");
    const secondFailure = new Error("second close failed");
    let firstCloseCalls = 0;
    let secondCloseCalls = 0;

    class CloseFailingAdapter extends NodeCompatibleFileSystemAdapter {
      protected override setupWatcher(
        _path: string,
        options: Parameters<typeof setupNodeFsWatcher>[1],
      ): Promise<void> {
        options.watchers.push(
          {
            close() {
              firstCloseCalls++;
              throw firstFailure;
            },
          } as unknown as import("node:fs").FSWatcher,
          {
            close() {
              secondCloseCalls++;
              throw secondFailure;
            },
          } as unknown as import("node:fs").FSWatcher,
        );
        return Promise.resolve();
      }
    }

    const watcher = new CloseFailingAdapter().watch("/virtual-watch-root", {
      recursive: false,
    });
    await watcher.ready;
    watcher.close();

    const error = await assertRejects(
      () => watcher.done!,
      AggregateError,
      "did not complete cleanly",
    ) as AggregateError;
    assertEquals(error.errors, [firstFailure, secondFailure]);
    // cleanup attempts teardown immediately and done retries resources that
    // did not close, while retaining the original failures for the caller.
    assertEquals([firstCloseCalls, secondCloseCalls], [2, 2]);
  });

  it("does not finish while a sibling watch root is still being acquired", async () => {
    const acquisitionFailure = new Error("first root failed");
    const siblingSetup = Promise.withResolvers<void>();

    class PartiallyFailingAdapter extends NodeCompatibleFileSystemAdapter {
      protected override setupWatcher(path: string): Promise<void> {
        return path === "/failed-root" ? Promise.reject(acquisitionFailure) : siblingSetup.promise;
      }
    }

    const watcher = new PartiallyFailingAdapter().watch(
      ["/failed-root", "/gated-root"],
      { recursive: false },
    );
    let doneSettled = false;
    const done = watcher.done!.finally(() => {
      doneSettled = true;
    });
    void done.catch(() => undefined);

    await assertRejects(() => watcher.ready!, Error, acquisitionFailure.message);
    await Promise.resolve();
    assertEquals(doneSettled, false);

    siblingSetup.resolve();
    await assertRejects(() => done, Error, acquisitionFailure.message);
    assertEquals(doneSettled, true);
  });
});
