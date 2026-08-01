import assert from "node:assert/strict";
import { constants } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { NodeFileSystemAdapter } from "../../src/platform/adapters/runtime/node/filesystem-adapter.ts";

test("minimum Node verifies handle-bound snapshots and exclusive creates", async () => {
  const root = await mkdtemp(join(tmpdir(), "veryfront-node-snapshot-"));
  try {
    const adapter = new NodeFileSystemAdapter();
    assert.equal(Object.hasOwn(adapter, "createFileBytesExclusive"), true);
    const createExclusive = adapter.createFileBytesExclusive;
    assert.equal(typeof createExclusive, "function");
    if (!createExclusive) throw new Error("Exclusive create capability is unavailable");

    const created = join(root, "created.bin");
    const existing = join(root, "existing.bin");
    const directory = join(root, "directory");
    await writeFile(existing, new Uint8Array([9, 8, 7]));
    await mkdir(directory);
    await createExclusive(created, new Uint8Array([0, 255, 1]));
    assert.deepEqual([...await readFile(created)], [0, 255, 1]);
    await assert.rejects(
      createExclusive(existing, new Uint8Array([1])),
    );
    assert.deepEqual([...await readFile(existing)], [9, 8, 7]);
    await assert.rejects(
      createExclusive(directory, new Uint8Array([1])),
    );

    if (typeof constants.O_NOFOLLOW !== "number" || constants.O_NOFOLLOW === 0) {
      assert.equal(Object.hasOwn(adapter, "readFileSnapshotWithinLimit"), false);
      assert.equal(adapter.readFileSnapshotWithinLimit, undefined);
      return;
    }

    assert.equal(Object.hasOwn(adapter, "readFileSnapshotWithinLimit"), true);
    const readSnapshot = adapter.readFileSnapshotWithinLimit;
    assert.equal(typeof readSnapshot, "function");
    if (!readSnapshot) throw new Error("Snapshot capability is unavailable");
    const empty = join(root, "empty.bin");
    const exact = join(root, "exact.bin");
    const oversized = join(root, "oversized.bin");
    const link = join(root, "link.bin");
    await writeFile(empty, new Uint8Array());
    await writeFile(exact, new Uint8Array([1, 2, 3]));
    await writeFile(oversized, new Uint8Array([1, 2, 3, 4]));
    await symlink(exact, link);

    assert.deepEqual(
      [...await readSnapshot(empty, root, 1)],
      [],
    );
    assert.deepEqual(
      [...await readSnapshot(exact, root, 3)],
      [1, 2, 3],
    );
    await assert.rejects(
      readSnapshot(oversized, root, 3),
      RangeError,
    );
    for (const limit of [0, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(
        readSnapshot(exact, root, limit),
        RangeError,
      );
    }
    await assert.rejects(
      readSnapshot(directory, root, 3),
      TypeError,
    );
    await assert.rejects(
      readSnapshot(link, root, 3),
      TypeError,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
