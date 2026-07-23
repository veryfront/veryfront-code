import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { FileSystemAdapter } from "../../base.ts";
import { BunFileSystemAdapter } from "./filesystem-adapter.ts";

describe("BunFileSystemAdapter", () => {
  it("supports canonical symlink inspection for path containment", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "vf-bun-fs-" });
    const targetPath = `${tempDir}/target.txt`;
    const linkPath = `${tempDir}/link.txt`;

    try {
      await Deno.writeTextFile(targetPath, "content");
      await Deno.symlink(targetPath, linkPath);

      const adapter: FileSystemAdapter = new BunFileSystemAdapter();
      const linkInfo = await adapter.lstat!(linkPath);

      assertEquals(linkInfo.isSymlink, true);
      assertEquals(await adapter.realPath!(linkPath), await Deno.realPath(targetPath));
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("does not report invalid paths as missing files", async () => {
    const adapter = new BunFileSystemAdapter();

    await assertRejects(() => adapter.stat("\0"), TypeError);
    await assertRejects(() => adapter.exists("\0"), TypeError);
  });

  it("does not silently accept removal of an absent path", async () => {
    const adapter = new BunFileSystemAdapter();
    await assertRejects(() => adapter.remove("/definitely-missing/veryfront-file"));
  });
});
