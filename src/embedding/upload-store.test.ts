import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { exists, readTextFile, withTempDir } from "#veryfront/testing/deno-compat.ts";
import { join } from "#veryfront/compat/path";
import { uploadStore } from "./upload-store.ts";

describe("uploadStore", () => {
  it("returns empty uploads when storage file does not exist", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const store = uploadStore({
        model: "local/test-model",
        storagePath,
      });

      const uploads = await store.listUploads();
      assertEquals(uploads, []);
    });
  });

  it("persists ingest with atomic temp+rename workflow", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const store = uploadStore({
        model: "local/test-model",
        storagePath,
      });

      const id = await store.ingest("Doc", "Hello world", {
        source: "upload:test.txt",
        type: "txt",
      });
      assert(id.length > 0);

      const uploads = await store.listUploads();
      assertEquals(uploads.length, 1);
      assertEquals(uploads[0]?.id, id);

      const parsed = JSON.parse(await readTextFile(storagePath)) as {
        uploads: unknown[];
        chunks: unknown[];
      };
      assertEquals(Array.isArray(parsed.uploads), true);
      assertEquals(Array.isArray(parsed.chunks), true);
      assertEquals(await exists(storagePath + ".tmp"), false);
    });
  });
});
