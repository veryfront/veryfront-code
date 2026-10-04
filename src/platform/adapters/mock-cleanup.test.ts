import "#veryfront/schemas/_test-setup.ts";
import { FakeTime } from "#std/testing/time";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "./mock.ts";

describe("mock binary snapshot cleanup", () => {
  it("releases snapshots on direct deletion and recreation", async () => {
    using _time = new FakeTime(1_000);
    const adapter = createMockAdapter();
    for (let index = 0; index < 10; index++) {
      const path = `/fixture-${index}.bin`;
      const bytes = new Uint8Array([index, 2]);
      adapter.fs.byteFiles.set(path, bytes);
      const before = await adapter.fs.stat(path);
      assertEquals(adapter.fs.retainedBinarySnapshotCount, 1);
      assertEquals(adapter.fs.byteFiles.delete(path), true);
      assertEquals(adapter.fs.retainedBinarySnapshotCount, 0);
      assertEquals(adapter.fs.byteFiles.delete(path), false);
      await assertRejects(() => adapter.fs.stat(path));
      adapter.fs.byteFiles.set(path, bytes);
      const recreated = await adapter.fs.stat(path);
      assertEquals(recreated.mtime!.getTime() > before.mtime!.getTime(), true);
      bytes[0] = 20;
      const mutated = await adapter.fs.stat(path);
      assertEquals(mutated.mtime!.getTime() > recreated.mtime!.getTime(), true);
      assertEquals((await adapter.fs.stat(path)).mtime, mutated.mtime);
      adapter.fs.byteFiles.delete(path);
    }
    assertEquals(adapter.fs.retainedBinarySnapshotCount, 0);
  });

  it("releases all cleared snapshots while preserving shared text mtimes", async () => {
    using time = new FakeTime(1_000);
    const adapter = createMockAdapter();
    adapter.fs.files.set("/shared", "text");
    adapter.fs.byteFiles.set("/shared", new Uint8Array([1]));
    adapter.fs.byteFiles.set("/binary", new Uint8Array([2]));
    const before = await adapter.fs.stat("/shared");
    assertEquals(adapter.fs.retainedBinarySnapshotCount, 2);
    adapter.fs.byteFiles.clear();
    assertEquals(adapter.fs.retainedBinarySnapshotCount, 0);
    time.tick(100);
    assertEquals((await adapter.fs.stat("/shared")).mtime, before.mtime);
    adapter.fs.byteFiles.clear();
    assertEquals((await adapter.fs.stat("/shared")).mtime, before.mtime);
  });

  for (const operation of ["delete", "clear"] as const) {
    it(`preserves binary snapshots when text fixtures ${operation}`, async () => {
      using time = new FakeTime(1_000);
      const adapter = createMockAdapter();
      adapter.fs.files.set("/shared", "text");
      const bytes = new Uint8Array([1]);
      adapter.fs.byteFiles.set("/shared", bytes);
      const before = await adapter.fs.stat("/shared");
      if (operation === "delete") adapter.fs.files.delete("/shared");
      else adapter.fs.files.clear();
      assertEquals(adapter.fs.retainedBinarySnapshotCount, 1);
      time.tick(100);
      assertEquals((await adapter.fs.stat("/shared")).mtime, before.mtime);
      bytes[0] = 2;
      const after = await adapter.fs.stat("/shared");
      assertEquals(after.mtime!.getTime() > before.mtime!.getTime(), true);
      assertEquals((await adapter.fs.stat("/shared")).mtime, after.mtime);
    });
  }

  it("drops a deleted binary snapshot without discarding live text metadata", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/shared", "text");
    adapter.fs.byteFiles.set("/shared", new Uint8Array([1]));
    const before = await adapter.fs.stat("/shared");
    adapter.fs.byteFiles.delete("/shared");
    assertEquals(adapter.fs.retainedBinarySnapshotCount, 0);
    assertEquals((await adapter.fs.stat("/shared")).mtime, before.mtime);
  });

  it("releases snapshots on file and recursive removal without touching siblings", async () => {
    const adapter = createMockAdapter();
    for (const path of ["/tree/a", "/tree/nested/b", "/tree-sibling/c", "/single"]) {
      adapter.fs.byteFiles.set(path, new Uint8Array([1, 2]));
    }
    adapter.fs.files.set("/tree/a", "text");
    const sibling = await adapter.fs.stat("/tree-sibling/c");
    assertEquals(adapter.fs.retainedBinarySnapshotCount, 3);
    await adapter.fs.remove("/single");
    assertEquals(adapter.fs.retainedBinarySnapshotCount, 2);
    await adapter.fs.remove("/tree", { recursive: true });
    assertEquals(adapter.fs.retainedBinarySnapshotCount, 1);
    assertEquals([...adapter.fs.byteFiles.keys()], ["/tree-sibling/c"]);
    assertEquals((await adapter.fs.stat("/tree-sibling/c")).mtime, sibling.mtime);
    await assertRejects(() => adapter.fs.stat("/tree/a"));
    await assertRejects(() => adapter.fs.stat("/tree/nested/b"));
  });
});
