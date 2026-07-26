import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunFileSystemAdapter } from "./filesystem-adapter.ts";
import { getBunRuntime } from "./types.ts";

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe("BunFileSystemAdapter native integration", () => {
  it("reads, writes, and watches through the real Bun runtime", async () => {
    if (!getBunRuntime()) return;
    const root = await mkdtemp(join(tmpdir(), "veryfront-bun-fs-"));
    const adapter = new BunFileSystemAdapter();
    let watcher: ReturnType<BunFileSystemAdapter["watch"]> | undefined;

    try {
      const file = join(root, "file.txt");
      await adapter.writeFile(file, "hello");
      assertEquals(await adapter.readFile(file), "hello");
      assertEquals((await adapter.readFileBytes(file)).length, 5);

      watcher = adapter.watch(root, { recursive: false });
      const eventPromise = watcher[Symbol.asyncIterator]().next();
      assertExists(watcher.ready);
      await watcher.ready;
      await adapter.writeFile(file, "updated");
      const event = await Promise.race([
        eventPromise,
        delay(3_000).then(() => {
          throw new Error("Bun filesystem watcher integration timed out");
        }),
      ]);
      assertEquals(event.done, false);
      assertEquals(
        event.value?.paths.some((path: string) => path.endsWith("file.txt")),
        true,
      );

      watcher.close();
      assertExists(watcher.done);
      await watcher.done;
    } finally {
      watcher?.close();
      await watcher?.done;
      await rm(root, { recursive: true, force: true });
    }
  });
});
