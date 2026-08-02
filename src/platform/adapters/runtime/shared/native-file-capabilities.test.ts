import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FileSnapshotChangedError } from "../../file-snapshot-error.ts";
import {
  createNodeFileBytesExclusive,
  type NativeSnapshotOperations,
  readNodeFileSnapshotWithinLimit,
  supportsNativeFileSnapshots,
} from "./native-file-capabilities.ts";

function snapshotStat(overrides: Partial<{
  dev: bigint;
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
}> = {}) {
  return {
    dev: overrides.dev ?? 1n,
    ino: overrides.ino ?? 2n,
    size: overrides.size ?? 3n,
    mtimeNs: overrides.mtimeNs ?? 4n,
    ctimeNs: overrides.ctimeNs ?? 5n,
    isFile: () => true,
    isSymbolicLink: () => false,
  };
}

function snapshotHandle(
  stat: ReturnType<typeof snapshotStat>,
  overrides: Partial<{
    stat(): Promise<ReturnType<typeof snapshotStat>>;
    read(
      buffer: Uint8Array,
      offset: number,
      length: number,
      position: number,
    ): Promise<{ bytesRead: number }>;
    writeFile(content: Uint8Array): Promise<void>;
    close(): Promise<void>;
  }> = {},
) {
  return {
    stat: overrides.stat ?? (() => Promise.resolve(stat)),
    read: overrides.read ??
      ((buffer: Uint8Array, offset: number, length: number) => {
        buffer.fill(7, offset, offset + length);
        return Promise.resolve({ bytesRead: length });
      }),
    writeFile: overrides.writeFile ?? (() => Promise.resolve()),
    close: overrides.close ?? (() => Promise.resolve()),
  };
}

function stableOperations(
  stat = snapshotStat(),
  handle = snapshotHandle(stat),
): NativeSnapshotOperations {
  return {
    realpath: (path) => Promise.resolve(path),
    lstat: () => Promise.resolve(stat),
    open: () => Promise.resolve(handle),
  };
}

describe("native filesystem capabilities", () => {
  it("advertises snapshots only where no-follow opens are supported", () => {
    assertEquals(supportsNativeFileSnapshots("posix"), true);
    assertEquals(supportsNativeFileSnapshots("windows"), false);
  });

  it("reads exact and empty snapshots and rejects oversize, links, directories, and escapes", async () => {
    if (Deno.build.os === "windows") return;
    const root = await Deno.makeTempDir({ prefix: "vf-native-snapshot-" });
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

      assertEquals([...await readNodeFileSnapshotWithinLimit(empty, root, 1)], []);
      assertEquals(
        [...await readNodeFileSnapshotWithinLimit(exact, root, 3)],
        [1, 2, 3],
      );
      await assertRejects(
        () => readNodeFileSnapshotWithinLimit(oversized, root, 3),
        RangeError,
      );
      await assertRejects(
        () => readNodeFileSnapshotWithinLimit(directory, root, 3),
        TypeError,
      );
      await assertRejects(
        () => readNodeFileSnapshotWithinLimit(link, root, 3),
        TypeError,
      );
      await assertRejects(
        () => readNodeFileSnapshotWithinLimit(`${root}/../outside.bin`, root, 3),
        TypeError,
      );
      for (const limit of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        await assertRejects(
          () => readNodeFileSnapshotWithinLimit(exact, root, limit),
          RangeError,
        );
      }
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("accepts a canonical candidate beneath a symlinked containment root", async () => {
    if (Deno.build.os === "windows") return;
    const workspace = await Deno.makeTempDir({ prefix: "vf-native-snapshot-root-" });
    const physicalRoot = `${workspace}/physical`;
    const linkedRoot = `${workspace}/linked`;
    try {
      await Deno.mkdir(physicalRoot);
      await Deno.writeFile(`${physicalRoot}/asset.bin`, new Uint8Array([1, 2, 3]));
      await Deno.symlink(physicalRoot, linkedRoot);
      const canonicalCandidate = await Deno.realPath(`${linkedRoot}/asset.bin`);

      assertEquals(
        [...await readNodeFileSnapshotWithinLimit(canonicalCandidate, linkedRoot, 3)],
        [1, 2, 3],
      );
    } finally {
      await Deno.remove(workspace, { recursive: true });
    }
  });

  it("rejects metadata oversize without reading and always closes the handle", async () => {
    const stat = snapshotStat({ size: 4n });
    let reads = 0;
    let closes = 0;
    const handle = snapshotHandle(stat, {
      read: () => {
        reads++;
        return Promise.resolve({ bytesRead: 0 });
      },
      close: () => {
        closes++;
        return Promise.resolve();
      },
    });

    await assertRejects(
      () =>
        readNodeFileSnapshotWithinLimit(
          "/root/file.bin",
          "/root",
          3,
          stableOperations(stat, handle),
        ),
      RangeError,
    );
    assertEquals({ reads, closes }, { reads: 0, closes: 1 });
  });

  it("does not misclassify admitted allocation failure as byte-limit overflow", async () => {
    const stat = snapshotStat({ size: BigInt(Number.MAX_SAFE_INTEGER) });
    const error = await assertRejects(
      () =>
        readNodeFileSnapshotWithinLimit(
          "/root/file.bin",
          "/root",
          Number.MAX_SAFE_INTEGER,
          stableOperations(stat),
        ),
      Error,
      "Unable to allocate",
    );
    assertEquals(error instanceof RangeError, false);
  });

  it("normalizes open and initial handle-stat uncertainty with the original cause", async () => {
    const stat = snapshotStat();
    const openFailure = new Error("removed before open");
    const openOperations: NativeSnapshotOperations = {
      realpath: (path) => Promise.resolve(path),
      lstat: () => Promise.resolve(stat),
      open: () => Promise.reject(openFailure),
    };
    const openError = await assertRejects(
      () =>
        readNodeFileSnapshotWithinLimit(
          "/root/file.bin",
          "/root",
          3,
          openOperations,
        ),
      FileSnapshotChangedError,
    ) as FileSnapshotChangedError & { cause?: unknown };
    assertEquals(openError.cause, openFailure);

    const statFailure = new Error("opened identity unavailable");
    let closes = 0;
    const statHandle = snapshotHandle(stat, {
      stat: () => Promise.reject(statFailure),
      close: () => {
        closes++;
        return Promise.resolve();
      },
    });
    const statError = await assertRejects(
      () =>
        readNodeFileSnapshotWithinLimit(
          "/root/file.bin",
          "/root",
          3,
          stableOperations(stat, statHandle),
        ),
      FileSnapshotChangedError,
    ) as FileSnapshotChangedError & { cause?: unknown };
    assertEquals(statError.cause, statFailure);
    assertEquals(closes, 1);
  });

  it("rejects pathname replacement and opened-file mutation", async () => {
    const before = snapshotStat();
    const replacement = snapshotStat({ ino: 9n });
    let pathnameStats = 0;
    const replacementOperations: NativeSnapshotOperations = {
      realpath: (path) => Promise.resolve(path),
      lstat: () => Promise.resolve(pathnameStats++ === 0 ? before : replacement),
      open: () => Promise.resolve(snapshotHandle(before)),
    };
    await assertRejects(
      () =>
        readNodeFileSnapshotWithinLimit(
          "/root/file.bin",
          "/root",
          3,
          replacementOperations,
        ),
      FileSnapshotChangedError,
    );

    const after = snapshotStat({ mtimeNs: 8n, ctimeNs: 9n });
    let handleStats = 0;
    const mutatedHandle = snapshotHandle(before, {
      stat: () => Promise.resolve(handleStats++ === 0 ? before : after),
    });
    await assertRejects(
      () =>
        readNodeFileSnapshotWithinLimit(
          "/root/file.bin",
          "/root",
          3,
          stableOperations(before, mutatedHandle),
        ),
      FileSnapshotChangedError,
    );
  });

  it("preserves both a snapshot failure and a cleanup failure", async () => {
    const stat = snapshotStat();
    const readFailure = new Error("read failed");
    const closeFailure = new Error("close failed");
    const handle = snapshotHandle(stat, {
      read: () => Promise.reject(readFailure),
      close: () => Promise.reject(closeFailure),
    });
    const error = await assertRejects(
      () =>
        readNodeFileSnapshotWithinLimit(
          "/root/file.bin",
          "/root",
          3,
          stableOperations(stat, handle),
        ),
      AggregateError,
    ) as AggregateError;
    assertEquals(error.errors, [readFailure, closeFailure]);
  });

  it("creates exclusively without truncating collisions", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-native-exclusive-" });
    try {
      const created = `${root}/created.bin`;
      const existing = `${root}/existing.bin`;
      await Deno.writeFile(existing, new Uint8Array([9, 8, 7]));

      await createNodeFileBytesExclusive(created, new Uint8Array([0, 255, 1]));
      assertEquals([...await Deno.readFile(created)], [0, 255, 1]);
      await assertRejects(
        () => createNodeFileBytesExclusive(existing, new Uint8Array([1])),
        Error,
      );
      assertEquals([...await Deno.readFile(existing)], [9, 8, 7]);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("preserves exclusive-create write and cleanup failures without deleting ownership", async () => {
    const writeFailure = new Error("write failed");
    const closeFailure = new Error("close failed");
    let opens = 0;
    const stat = snapshotStat();
    const operations: NativeSnapshotOperations = {
      realpath: (path) => Promise.resolve(path),
      lstat: () => Promise.resolve(stat),
      open: (_path, flags) => {
        assertEquals(flags, "wx");
        opens++;
        return Promise.resolve(snapshotHandle(stat, {
          writeFile: () => Promise.reject(writeFailure),
          close: () => Promise.reject(closeFailure),
        }));
      },
    };
    const error = await assertRejects(
      () => createNodeFileBytesExclusive("/reserved.bin", new Uint8Array([1]), operations),
      AggregateError,
    ) as AggregateError;
    assertEquals(opens, 1);
    assertEquals(error.errors, [writeFailure, closeFailure]);
  });
});
