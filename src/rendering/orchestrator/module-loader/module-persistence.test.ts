import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { dirname, join } from "#veryfront/compat/path/index.ts";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import { getModulePathCache } from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";
import { buildMdxEsmPathCacheKey } from "#veryfront/transforms/mdx/esm-module-loader/cache-format.ts";
import { persistTransformedModule } from "./module-persistence.ts";

describe("module-loader/module-persistence", () => {
  it("writes transformed code, registers MDX path-cache, and updates module cache", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-module-persist-project-" });
    const tmpDir = await Deno.makeTempDir({ prefix: "vf-module-persist-out-" });
    const localAdapter = await getLocalAdapter();
    const filePath = join(projectDir, "app/page.tsx");
    const transformedCode = "export const page = 1;";
    const moduleCache = new Map<string, string>();
    const cacheKey = "project:preview:page";

    try {
      await Deno.mkdir(dirname(filePath), { recursive: true });
      await Deno.writeTextFile(filePath, "export const page = 1;");

      const result = await persistTransformedModule({
        filePath,
        projectDir,
        tmpDir,
        transformedCode,
        localAdapter,
        moduleCache,
        cacheKey,
        contentSourceId: "preview-main",
        reactVersion: "19.1.1",
      });

      const expectedHash = hashCodeHex(transformedCode).slice(0, 8);
      assertEquals(result, join(tmpDir, `app/page.${expectedHash}.js`));
      assertEquals(await Deno.readTextFile(result), transformedCode);
      assertEquals(moduleCache.get(cacheKey), result);

      const pathCache = await getModulePathCache(tmpDir);
      const mdxCacheKey = buildMdxEsmPathCacheKey("_vf_modules/app/page.js", "19.1.1");
      assertEquals(pathCache.get(mdxCacheKey), result);
    } finally {
      await Deno.remove(projectDir, { recursive: true }).catch(() => undefined);
      await Deno.remove(tmpDir, { recursive: true }).catch(() => undefined);
    }
  });
});
