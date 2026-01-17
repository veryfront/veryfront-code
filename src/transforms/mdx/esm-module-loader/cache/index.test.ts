import { assertEquals } from "jsr:@std/assert@1";
import { join } from "jsr:@std/path@1";
import { clearModulePathCache, getModulePathCache, saveModulePathCache } from "./index.ts";

Deno.test({
  name: "MDX module path cache isolates per cache dir",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    clearModulePathCache();

    const cacheDirA = await Deno.makeTempDir({ prefix: "vf-mdx-cache-a-" });
    const cacheDirB = await Deno.makeTempDir({ prefix: "vf-mdx-cache-b-" });

    try {
      await Deno.writeTextFile(
        join(cacheDirA, "_index.json"),
        JSON.stringify({ "_vf_modules/pages/index.js": "/tmp/a.mjs" }),
      );
      await Deno.writeTextFile(
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
      await Deno.remove(cacheDirA, { recursive: true });
      await Deno.remove(cacheDirB, { recursive: true });
      clearModulePathCache();
    }
  },
});
