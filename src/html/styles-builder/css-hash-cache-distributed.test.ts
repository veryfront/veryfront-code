import "#veryfront/schemas/_test-setup.ts";
import { DiskCacheBackend } from "#veryfront/cache/backend.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { clearCSSCache, getCSSByHashAsync } from "./css-hash-cache.ts";
import { hashCSS } from "./css-identity.ts";

describe("styles-builder/css-hash-cache distributed integrity", () => {
  it("rejects distributed CSS whose payload does not match the requested identity", async () => {
    const originalBackend = Deno.env.get("VF_CACHE_BACKEND");
    const originalCacheDir = Deno.env.get("VF_DISK_CACHE_DIR");
    const cacheDir = await Deno.makeTempDir();
    const expectedCSS = ".expected{color:green}";
    const expectedHash = hashCSS(expectedCSS);
    const cacheKey = `v2:${expectedHash}`;
    const diskCache = new DiskCacheBackend(cacheDir, "css");

    Deno.env.set("VF_CACHE_BACKEND", "disk");
    Deno.env.set("VF_DISK_CACHE_DIR", cacheDir);

    try {
      await diskCache.set(
        cacheKey,
        JSON.stringify({ css: expectedCSS, candidates: [], stylesheet: "" }),
        60,
      );
      assertEquals(await getCSSByHashAsync(expectedHash), expectedCSS);

      clearCSSCache();
      await diskCache.set(
        cacheKey,
        JSON.stringify({ css: ".substituted{color:red}", candidates: [], stylesheet: "" }),
        60,
      );
      assertEquals(await getCSSByHashAsync(expectedHash), undefined);
    } finally {
      clearCSSCache();
      if (originalBackend === undefined) Deno.env.delete("VF_CACHE_BACKEND");
      else Deno.env.set("VF_CACHE_BACKEND", originalBackend);
      if (originalCacheDir === undefined) Deno.env.delete("VF_DISK_CACHE_DIR");
      else Deno.env.set("VF_DISK_CACHE_DIR", originalCacheDir);
      await Deno.remove(cacheDir, { recursive: true });
    }
  });
});
