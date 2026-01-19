import { assertEquals } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { join } from "@veryfront/compat/path";
import { clearModulePathCache, getModulePathCache, saveModulePathCache } from "./index.ts";
import { makeTempDir } from "@veryfront/testing/deno-compat";
import { remove, writeTextFile } from "@veryfront/compat/fs.ts";

describe("MDX module path cache", () => {
  it("isolates per cache dir", async () => {
    clearModulePathCache();

    const cacheDirA = await makeTempDir({ prefix: "vf-mdx-cache-a-" });
    const cacheDirB = await makeTempDir({ prefix: "vf-mdx-cache-b-" });

    try {
      await writeTextFile(
        join(cacheDirA, "_index.json"),
        JSON.stringify({ "_vf_modules/pages/index.js": "/tmp/a.mjs" }),
      );
      await writeTextFile(
        join(cacheDirB, "_index.json"),
        JSON.stringify({ "_vf_modules/pages/index.js": "/tmp/b.mjs" }),
      );

      const cacheA = await getModulePathCache(cacheDirA);
      const cacheB = await getModulePathCache(cacheDirB);

      assertEquals(cacheA.get("_vf_modules/pages/index.js"), "/tmp/a.mjs");
      assertEquals(cacheB.get("_vf_modules/pages/index.js"), "/tmp/b.mjs");

      cacheA.set("_vf_modules/pages/about.js", "/tmp/a-about.mjs");
      await saveModulePathCache(cacheDirA);

      assertEquals(cacheB.get("_vf_modules/pages/about.js"), undefined);
    } finally {
      await remove(cacheDirA, { recursive: true });
      await remove(cacheDirB, { recursive: true });
      clearModulePathCache();
    }
  });
});
