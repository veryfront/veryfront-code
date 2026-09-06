import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { denoAdapter } from "#veryfront/platform/adapters/deno.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import type { MDXModule } from "#veryfront/transforms/mdx/types.ts";
import {
  doLoadModuleESM,
  prepareModuleESM,
} from "#veryfront/transforms/mdx/esm-module-loader/module-writer.ts";

describe("MDX module preparation", () => {
  it("prepares an artifact without evaluating its top-level code", async () => {
    const dir = await Deno.makeTempDir();
    const moduleCache = new LRUCache<string, MDXModule>();
    try {
      const prepared = await prepareModuleESM(
        'throw new Error("tenant module evaluated"); export default function Page() {}',
        {
          adapter: denoAdapter,
          projectDir: dir,
          projectId: "preparation-test",
          contentSourceId: "release-test",
          esmCacheDir: dir,
          dependencyPinningCacheKey: "off",
        },
      );
      assertEquals((await Deno.stat(prepared.filePath)).isFile, true);
      assertEquals(moduleCache.size, 0);
      await assertRejects(() => import(prepared.importUrl), Error, "tenant module evaluated");
    } finally {
      moduleCache.destroy();
      await Deno.remove(dir, { recursive: true });
    }
  });

  it("materializes an artifact even when the host already cached its exports", async () => {
    const dir = await Deno.makeTempDir();
    const moduleCache = new LRUCache<string, MDXModule>();
    try {
      const context = {
        adapter: denoAdapter,
        projectDir: dir,
        projectId: "preparation-test",
        contentSourceId: "release-test",
        esmCacheDir: dir,
        moduleCache,
        dependencyPinningCacheKey: "off",
      };
      const code = "export const title = 'snapshot'; export default function Page() {}";
      const loaded = await doLoadModuleESM(code, context);
      const first = await prepareModuleESM(code, context);
      await Deno.remove(first.filePath);
      const second = await prepareModuleESM(code, context);
      assertEquals(second, first);
      assertEquals((await Deno.stat(second.filePath)).isFile, true);
      assertEquals(moduleCache.size, 1);
      assertEquals(await doLoadModuleESM(code, context), loaded);
    } finally {
      moduleCache.destroy();
      await Deno.remove(dir, { recursive: true });
    }
  });
});
