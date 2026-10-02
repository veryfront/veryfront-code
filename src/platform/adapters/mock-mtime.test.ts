import "#veryfront/schemas/_test-setup.ts";
import { FakeTime } from "#std/testing/time";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "./mock.ts";

describe("mock file modification times", () => {
  it("keeps unchanged text and binary mtimes stable across advancing clock ticks", async () => {
    using time = new FakeTime(1_000);
    const adapter = createMockAdapter();
    adapter.fs.files.set("/package.json", '{"dependencies":{"react":"19.2.4"}}');
    adapter.fs.byteFiles.set("/data.bin", new Uint8Array([1, 2]));

    for (const path of ["/package.json", "/data.bin"]) {
      const before = await adapter.fs.stat(path);
      time.tick(100);
      const after = await adapter.fs.stat(path);
      assertExists(before.mtime);
      assertEquals(after.mtime?.getTime(), before.mtime.getTime());
    }
  });

  it("changes the mtime on same-size writes within one clock tick", async () => {
    using _time = new FakeTime(1_000);
    const adapter = createMockAdapter();
    await adapter.fs.writeFile("/package.json", "state-a");
    const before = await adapter.fs.stat("/package.json");
    await adapter.fs.writeFile("/package.json", "state-b");
    const after = await adapter.fs.stat("/package.json");
    assertEquals(after.size, before.size);
    assertEquals(after.mtime!.getTime() > before.mtime!.getTime(), true);

    const writeBytes = adapter.fs.writeFileBytes;
    assertExists(writeBytes);
    await writeBytes("/package.json", new TextEncoder().encode("state-c"));
    const binary = await adapter.fs.stat("/package.json");
    assertEquals(binary.mtime!.getTime() > after.mtime!.getTime(), true);
  });

  it("updates mtimes after in-place binary fixture mutation", async () => {
    using time = new FakeTime(1_000);
    const adapter = createMockAdapter();
    const bytes = new Uint8Array([1, 2]);
    adapter.fs.byteFiles.set("/data.bin", bytes);
    const before = await adapter.fs.stat("/data.bin");
    bytes[0] = 3;
    const after = await adapter.fs.stat("/data.bin");
    assertEquals(after.mtime!.getTime() > before.mtime!.getTime(), true);
    time.tick(100);
    assertEquals((await adapter.fs.stat("/data.bin")).mtime, after.mtime);
  });

  it("tracks direct fixture replacement and recreation without changing other files", async () => {
    using _time = new FakeTime(1_000);
    const adapter = createMockAdapter();
    adapter.fs.files.set("/package.json", "state-a");
    adapter.fs.files.set("/other.txt", "unchanged");
    const before = await adapter.fs.stat("/package.json");
    const other = await adapter.fs.stat("/other.txt");
    adapter.fs.files.set("/package.json", "state-b");
    const replaced = await adapter.fs.stat("/package.json");
    assertEquals(replaced.mtime!.getTime() > before.mtime!.getTime(), true);
    adapter.fs.files.clear();
    adapter.fs.files.set("/package.json", "state-b");
    const recreated = await adapter.fs.stat("/package.json");
    assertEquals(recreated.mtime!.getTime() > replaced.mtime!.getTime(), true);
    adapter.fs.files.set("/other.txt", "unchanged");
    const restoredOther = await adapter.fs.stat("/other.txt");
    adapter.fs.files.delete("/package.json");
    adapter.fs.files.set("/package.json", "state-c");
    assertEquals((await adapter.fs.stat("/other.txt")).mtime, restoredOther.mtime);
    assertEquals(restoredOther.mtime!.getTime() > other.mtime!.getTime(), true);
  });
});
