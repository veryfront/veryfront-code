import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runtime } from "#veryfront/platform/adapters/registry.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { join, toFileUrl } from "#veryfront/compat/path";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import type { MDXModule } from "#veryfront/transforms/mdx/types.ts";
import { jsonForInlineScript } from "#veryfront/security/client/html-sanitizer.ts";
import { linkRenderModules } from "#veryfront/transforms/esm/link-render-modules.ts";
import { RenderArtifacts } from "#veryfront/transforms/esm/render-artifacts.ts";
import {
  doLoadModuleESM,
  prepareModuleESM,
} from "#veryfront/transforms/mdx/esm-module-loader/module-writer.ts";

describe("MDX module preparation", () => {
  it("retains the final transformed root for publication after its cache file is deleted", async () => {
    const fs = createFileSystem();
    const dir = await fs.makeTempDir();
    let artifacts: RenderArtifacts | undefined;
    try {
      const prepared = await prepareModuleESM(
        "const MDXLayout = () => null; export const value = 42;",
        {
          adapter: await runtime.get(),
          projectDir: dir,
          projectId: "preparation-test",
          contentSourceId: "release-test",
          esmCacheDir: dir,
          dependencyPinningCacheKey: "off",
        },
      );
      assertEquals(prepared.source, await fs.readTextFile(prepared.filePath));
      assertEquals(
        prepared.source.includes("export { MDXLayout as __vfLayout }"),
        true,
        "capture must include the writer's generated layout export",
      );
      await fs.remove(prepared.filePath);
      const url = toFileUrl(prepared.filePath).href;
      const limits = { maxEntries: 1, maxBytes: 4096 };
      const graph = await linkRenderModules({
        modules: [{ url, source: prepared.source }],
        entrypoints: [url],
      }, limits);
      artifacts = new RenderArtifacts(graph, limits);
      const published = await artifacts.prepare();
      assertEquals(
        await fs.readTextFile(join(published.directory, graph.entrypoints[0]!)),
        prepared.source,
      );
    } finally {
      await artifacts?.release();
      await fs.remove(dir, { recursive: true });
    }
  });

  it("prepares an artifact without evaluating its top-level code", async () => {
    const fs = createFileSystem();
    const dir = await fs.makeTempDir();
    try {
      const prepared = await prepareModuleESM(
        'throw new Error("tenant module evaluated"); export default function Page() {}',
        {
          adapter: await runtime.get(),
          projectDir: dir,
          projectId: "preparation-test",
          contentSourceId: "release-test",
          esmCacheDir: dir,
          dependencyPinningCacheKey: "off",
        },
      );
      assertEquals((await fs.stat(prepared.filePath)).isFile, true);
      await assertRejects(() => import(prepared.importUrl), Error, "tenant module evaluated");
    } finally {
      await fs.remove(dir, { recursive: true });
    }
  });

  it("materializes an artifact even when the host already cached its exports", async () => {
    const fs = createFileSystem();
    const dir = await fs.makeTempDir();
    const moduleCache = new LRUCache<string, MDXModule>();
    try {
      const context = {
        adapter: await runtime.get(),
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
      await fs.remove(first.filePath);
      const second = await prepareModuleESM(code, context);
      assertEquals(second, first);
      assertEquals((await fs.stat(second.filePath)).isFile, true);
      assertEquals(moduleCache.size, 1);
      assertEquals(await doLoadModuleESM(code, context), loaded);
    } finally {
      moduleCache.destroy();
      await fs.remove(dir, { recursive: true });
    }
  });

  it("preserves nested lazy evaluation through preparation and host loading", async () => {
    const fs = createFileSystem();
    const dir = await fs.makeTempDir();
    const moduleCache = new LRUCache<string, MDXModule>();
    const marker = `__vfLazyPreparation${crypto.randomUUID()}`;
    const childPath = join(dir, "child.mjs");
    try {
      await fs.writeTextFile(
        childPath,
        `globalThis[${jsonForInlineScript(marker)}] = "child";
export const load = () => import("./leaf.mjs");`,
      );
      await fs.writeTextFile(
        join(dir, "leaf.mjs"),
        `globalThis[${jsonForInlineScript(marker)}] = "leaf"; export const value = 42;`,
      );
      const context = {
        adapter: await runtime.get(),
        projectDir: dir,
        projectId: "preparation-test",
        contentSourceId: "release-test",
        esmCacheDir: dir,
        moduleCache,
        dependencyPinningCacheKey: "off",
      };
      const code = `export const load = () => import(${
        jsonForInlineScript(toFileUrl(childPath).href)
      });`;
      await prepareModuleESM(code, context);
      assertEquals(
        Reflect.get(globalThis, marker),
        undefined,
        "preparation must not evaluate children",
      );
      const parent = await doLoadModuleESM(code, context);
      assertEquals(Reflect.get(globalThis, marker), undefined, "parent loading must remain lazy");
      const child =
        await (parent.load as () => Promise<{ load: () => Promise<{ value: number }> }>)();
      assertEquals(
        Reflect.get(globalThis, marker),
        "child",
        "the nested child must still be deferred",
      );
      assertEquals((await child.load()).value, 42);
      assertEquals(Reflect.get(globalThis, marker), "leaf");
    } finally {
      Reflect.deleteProperty(globalThis, marker);
      moduleCache.destroy();
      await fs.remove(dir, { recursive: true });
    }
  });
});
