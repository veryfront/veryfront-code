import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { stop as stopBundler } from "veryfront/extensions/bundler";
import { runtime } from "#veryfront/platform/adapters/registry.ts";
import { createFileSystem, symlink } from "#veryfront/platform/compat/fs.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { join, toFileUrl } from "#veryfront/compat/path";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import type { MDXModule } from "#veryfront/transforms/mdx/types.ts";
import { jsonForInlineScript } from "#veryfront/security/client/html-sanitizer.ts";
import { linkRenderModules } from "#veryfront/transforms/esm/link-render-modules.ts";
import { RenderArtifacts } from "#veryfront/transforms/esm/render-artifacts.ts";
import {
  doLoadModuleESM,
  prepareModuleESM,
  prepareModuleGraphESM,
} from "#veryfront/transforms/mdx/esm-module-loader/module-writer.ts";
import { runWithCacheDir } from "#veryfront/utils/cache-dir.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { __setDistributedCacheAccessorForTests } from "#veryfront/transforms/esm/http-cache-wrapper.ts";
import { runPipeline } from "#veryfront/transforms/pipeline/index.ts";
import { getModulePathCache } from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";
import {
  createModuleFetcherContext,
  fetchAndCacheModule,
} from "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/index.ts";
import { ModuleSourceCapture } from "#veryfront/transforms/esm/module-source-capture.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { DENO_CONFIG_STUB_CODE } from "#veryfront/transforms/pipeline/stages/ssr-vf-modules/constants.ts";

describe("MDX module preparation", () => {
  afterAll(stopBundler);
  it("preserves directory component defaults without duplicating aliased module state", async () => {
    const fs = createFileSystem();
    const dir = await fs.makeTempDir();
    let artifacts: RenderArtifacts | undefined;
    try {
      await fs.mkdir(join(dir, "Widget"));
      await fs.writeTextFile(
        join(dir, "Widget/index.ts"),
        "export const state = {}; export function Widget() { return state; }",
      );
      const limits = { maxEntries: 8, maxBytes: 16_384 };
      const graph = await prepareModuleGraphESM(
        'import Widget from "/_vf_modules/Widget.js"; ' +
          'import { Widget as Direct, state } from "/_vf_modules/Widget/index.js"; ' +
          "export const same = Widget === Direct && Widget() === state;",
        {
          adapter: await runtime.get(),
          projectDir: dir,
          esmCacheDir: dir,
          projectId: "graph-test",
          dependencyPinningCacheKey: "off",
        },
        limits,
      );
      await fs.remove(dir, { recursive: true });
      artifacts = new RenderArtifacts(graph, limits);
      const prepared = await artifacts.prepare();
      assertEquals((await import(prepared.entrypointUrls[0]!)).same, true);
    } finally {
      await artifacts?.release();
      if (await fs.exists(dir)) await fs.remove(dir, { recursive: true });
    }
  });

  it("preserves query and fragment identities through inferred-default aliases", async () => {
    const fs = createFileSystem();
    const dir = await fs.makeTempDir();
    let artifacts: RenderArtifacts | undefined;
    try {
      await fs.mkdir(join(dir, "Widget"));
      await fs.writeTextFile(
        join(dir, "Widget/index.ts"),
        "export const state = {}; export function Widget() { return state; }",
      );
      await fs.writeTextFile(
        join(dir, "nested.ts"),
        'import A from "./Widget.js?one#first"; import B from "./Widget.js?one#second"; ' +
          "export const a = A(); export const b = B();",
      );
      const limits = { maxEntries: 12, maxBytes: 16_384 };
      const graph = await prepareModuleGraphESM(
        'import A from "/_vf_modules/Widget.js?one#first"; ' +
          'import B from "/_vf_modules/Widget.js?one#second"; ' +
          'import C from "/_vf_modules/Widget.js?two#first"; ' +
          'import { state } from "/_vf_modules/Widget/index.js?one#first"; ' +
          "export const a = A(); export const b = B(); export const c = C(); " +
          'export const same = a === state; export const load = () => import("/_vf_modules/nested.js");',
        {
          adapter: await runtime.get(),
          projectDir: dir,
          esmCacheDir: dir,
          projectId: "graph-test",
          dependencyPinningCacheKey: "off",
        },
        limits,
      );
      artifacts = new RenderArtifacts(graph, limits);
      const prepared = await artifacts.prepare();
      const root = await import(prepared.entrypointUrls[0]!);
      assertEquals(root.same, true);
      assertEquals(root.a === root.b, false, "fragment variants must have separate module state");
      assertEquals(root.a === root.c, false, "query variants must have separate module state");
      const nested = await root.load();
      assertEquals(nested.a === root.a && nested.b === root.b, true);
    } finally {
      await artifacts?.release();
      await fs.remove(dir, { recursive: true });
    }
  });

  it("captures the synthetic configuration used by framework dependencies", async () => {
    const fs = createFileSystem();
    const dir = await fs.makeTempDir();
    const capture = new ModuleSourceCapture({ maxEntries: 2, maxBytes: 1024 * 1024 });
    try {
      const context = createModuleFetcherContext(dir, await runtime.get(), dir, "graph-test", {
        sourceCapture: capture,
        dependencyPinningCacheKey: "off",
      });
      const path = await fetchAndCacheModule(
        "_vf_modules/_veryfront/_deno-config.js",
        context,
        "_vf_modules/_veryfront/utils/version.js",
      );
      assertEquals(capture.take(), [{ url: toFileUrl(path!).href, source: DENO_CONFIG_STUB_CODE }]);
      assertEquals(await fs.exists(path!), false, "synthetic captured modules need no host file");
    } finally {
      capture.discard();
      await fs.remove(dir, { recursive: true });
    }
  });

  it("retains one version of a repeatedly requested source for each preparation", async () => {
    const fs = createFileSystem();
    const dir = await fs.makeTempDir();
    const capture = new ModuleSourceCapture({ maxEntries: 4, maxBytes: 16_384 });
    try {
      await fs.writeTextFile(join(dir, "shared.ts"), 'export const value = "first";');
      const context = createModuleFetcherContext(dir, await runtime.get(), dir, "graph-test", {
        sourceCapture: capture,
        dependencyPinningCacheKey: "off",
      });
      const first = await fetchAndCacheModule("_vf_modules/shared.js", context);
      await fs.writeTextFile(join(dir, "shared.ts"), 'export const value = "second";');
      const repeated = await fetchAndCacheModule("_vf_modules/shared.js", context);
      assertEquals(repeated, first);
      const modules = capture.take();
      assertEquals(modules.length, 1);
      assertEquals(modules[0]!.source.includes("first"), true);
    } finally {
      capture.discard();
      await fs.remove(dir, { recursive: true });
    }
  });

  it("does not grant raw file imports authority because a source was captured elsewhere", async () => {
    const fs = createFileSystem();
    const dir = await fs.makeTempDir();
    try {
      const modulePath = join(dir, "shared.ts");
      await fs.writeTextFile(modulePath, "export const value = 42;");
      const id = await computeHash(JSON.stringify(["file", modulePath]));
      const fileUrl = toFileUrl(join(dir, `captured-${id}.mjs`)).href;
      const adapter = await runtime.get();
      await assertRejects(
        () =>
          prepareModuleGraphESM(
            `import "/_vf_modules/shared.js"; export * from ${jsonForInlineScript(fileUrl)};`,
            {
              adapter,
              projectDir: dir,
              esmCacheDir: dir,
              projectId: "graph-test",
              contentSourceId: "release-test",
              dependencyPinningCacheKey: "off",
            },
            { maxEntries: 4, maxBytes: 16_384 },
          ),
        Error,
        "Unscoped file import",
      );
    } finally {
      await fs.remove(dir, { recursive: true });
    }
  });

  it("captures project sources through a virtual adapter without a native project directory", async () => {
    const fs = createFileSystem();
    const cache = await fs.makeTempDir();
    const adapter = createMockAdapter();
    const projectDir = "/virtual-capture-project";
    adapter.fs.files.set(`${projectDir}/entry.ts`, 'export { value } from "./child.ts";');
    adapter.fs.files.set(`${projectDir}/child.ts`, "export const value = 42;");
    try {
      const graph = await prepareModuleGraphESM('export * from "/_vf_modules/entry.js";', {
        adapter,
        projectDir,
        esmCacheDir: cache,
        projectId: "virtual-project",
        contentSourceId: "release-test",
        dependencyPinningCacheKey: "off",
      }, { maxEntries: 3, maxBytes: 16_384 });
      assertEquals(graph.files.length, 3);
      assertEquals(adapter.fs.files.size, 2, "preparation must not write to the project adapter");
    } finally {
      await fs.remove(cache, { recursive: true });
    }
  });

  it("rejects a project symlink that leaves its source root", async () => {
    const fs = createFileSystem();
    const dir = await fs.makeTempDir();
    const projectDir = join(dir, "project");
    try {
      await fs.mkdir(projectDir);
      await fs.writeTextFile(join(dir, "outside.ts"), "export const value = 42;");
      await symlink(join(dir, "outside.ts"), join(projectDir, "child.ts"));
      await assertRejects(() =>
        prepareModuleGraphESM('export * from "/_vf_modules/child.js";', {
          adapter: undefined,
          projectDir,
          esmCacheDir: join(dir, "cache"),
          projectId: "graph-test",
          contentSourceId: "release-test",
          dependencyPinningCacheKey: "off",
        }, { maxEntries: 4, maxBytes: 16_384 }), Error);
    } finally {
      await fs.remove(dir, { recursive: true });
    }
  });

  it("refuses private framework imports from captured project sources", async () => {
    const fs = createFileSystem();
    const dir = await fs.makeTempDir();
    try {
      await fs.writeTextFile(
        join(dir, "entry.ts"),
        'export * from "#veryfront/security/host-execution-policy.ts";',
      );
      const context = {
        adapter: await runtime.get(),
        projectDir: dir,
        esmCacheDir: join(dir, "cache"),
        projectId: "graph-test",
        contentSourceId: "release-test",
        dependencyPinningCacheKey: "off",
      };
      for (let attempt = 0; attempt < 2; attempt++) {
        await assertRejects(
          () =>
            prepareModuleGraphESM('export * from "/_vf_modules/entry.js";', context, {
              maxEntries: 4,
              maxBytes: 16_384,
            }),
          Error,
          "Missing module",
        );
      }
    } finally {
      await fs.remove(dir, { recursive: true });
    }
  });

  it("caches logical project and framework references without fetching or materializing them", async () => {
    const fs = createFileSystem();
    const dir = await fs.makeTempDir();
    try {
      await withMockFetch(() => {
        throw new Error("Logical compilation must not fetch modules");
      }, async () => {
        const code =
          'export * from "./child.ts"; export { isProjectAgentKind } from "veryfront/agent/identity"; export * from "https://example.invalid/remote.mjs";';
        const options = {
          projectId: "graph-test",
          ssr: true,
          dependencyPinningCacheKey: "off",
          preloadedImportMap: { imports: {} },
        };
        const cold = await runPipeline(code, join(dir, "entry.ts"), dir, options, {
          ssrImports: "references",
        });
        const warm = await runPipeline(code, join(dir, "entry.ts"), dir, options, {
          ssrImports: "references",
        });
        assertEquals(warm.cached, true, "logical compilation must reuse its own source cache");
        assertEquals(warm.code, cold.code);
        assertEquals(cold.code.includes("file://"), false);
        assertEquals(
          cold.code.includes("_vf_modules/_veryfront/agent/identity-contracts.js"),
          true,
        );
        assertEquals(cold.code.includes("https://example.invalid/remote.mjs"), true);
      });
    } finally {
      await fs.remove(dir, { recursive: true });
    }
  });

  it("captures project dependencies and a public framework module on cold and warm caches", async () => {
    const fs = createFileSystem();
    const dir = await fs.makeTempDir();
    const esmCacheDir = join(dir, "cache");
    let artifacts: RenderArtifacts | undefined;
    try {
      await fs.mkdir(join(dir, "lib"), { recursive: true });
      await fs.mkdir(esmCacheDir, { recursive: true });
      await fs.writeTextFile(
        join(dir, "lib/entry.ts"),
        'export const load = () => import("./child.ts"); export { isProjectAgentKind } from "veryfront/agent/identity";',
      );
      await fs.writeTextFile(join(dir, "lib/child.ts"), 'export const value = "original";');
      const context = {
        adapter: await runtime.get(),
        projectDir: dir,
        projectId: "graph-test",
        contentSourceId: "release-test",
        esmCacheDir,
        dependencyPinningCacheKey: "off",
      };
      const limits = { maxEntries: 16, maxBytes: 65_536 };
      const source = 'export * from "/_vf_modules/lib/entry.js";';
      const paths = await getModulePathCache(esmCacheDir);
      const before = [...paths];
      const cold = await prepareModuleGraphESM(source, context, limits);
      const warm = await prepareModuleGraphESM(source, context, limits);
      assertEquals(warm, cold);
      assertEquals(
        cold.files.length,
        4,
        "root, entry, child, and public framework source must be captured",
      );
      assertEquals(
        [...paths],
        before,
        "captured modules must not enter the legacy executable-path cache",
      );
      await fs.remove(dir, { recursive: true });
      artifacts = new RenderArtifacts(cold, limits);
      assertEquals((await artifacts.prepare()).fileCount, 4);
    } finally {
      await artifacts?.release();
      if (await fs.exists(dir)) await fs.remove(dir, { recursive: true });
    }
  });

  it("rejects an uncaptured JSX import without reading its source", async () => {
    const fs = createFileSystem();
    const dir = await fs.makeTempDir();
    const adapter = await runtime.get();
    const childPath = join(dir, "child.jsx");
    await fs.writeTextFile(childPath, "export default function Child() { return <div />; }");
    const readFile = adapter.fs.readFile.bind(adapter.fs);
    const readDescriptor = Object.getOwnPropertyDescriptor(adapter.fs, "readFile");
    let childReads = 0;
    Object.defineProperty(adapter.fs, "readFile", {
      configurable: true,
      value: (path: string) => {
        if (path === childPath) childReads++;
        return readFile(path);
      },
    });
    try {
      await assertRejects(
        () =>
          prepareModuleGraphESM(
            `export { default } from ${jsonForInlineScript(toFileUrl(childPath).href)};`,
            {
              adapter,
              projectDir: dir,
              projectId: "graph-test",
              contentSourceId: "release-test",
              esmCacheDir: dir,
              dependencyPinningCacheKey: "off",
            },
            { maxEntries: 2, maxBytes: 4096 },
          ),
        Error,
        "Unscoped file import",
      );
      assertEquals(childReads, 0, "graph capture must not invoke the legacy JSX file reader");
    } finally {
      if (readDescriptor) Object.defineProperty(adapter.fs, "readFile", readDescriptor);
      else Reflect.deleteProperty(adapter.fs, "readFile");
      await fs.remove(dir, { recursive: true });
    }
  });

  it("does not recover dependencies discovered inside inert file URL text", async () => {
    const fs = createFileSystem();
    const dir = await fs.makeTempDir();
    let recoveryLookups = 0;
    __setDistributedCacheAccessorForTests(() => {
      recoveryLookups++;
      return Promise.resolve(null);
    });
    try {
      const unrelated = join(dir, "veryfront-mdx-esm", "unrelated.mjs");
      await fs.mkdir(join(dir, "veryfront-mdx-esm"), { recursive: true });
      const missingBundle = toFileUrl(join(dir, "veryfront-http-bundle", "http-abc123.mjs")).href;
      await fs.writeTextFile(unrelated, `import ${jsonForInlineScript(missingBundle)};`);
      const graph = await prepareModuleGraphESM(
        `export const label = ${jsonForInlineScript(toFileUrl(unrelated).href)};`,
        {
          adapter: await runtime.get(),
          projectDir: dir,
          projectId: "graph-test",
          contentSourceId: "release-test",
          esmCacheDir: dir,
          dependencyPinningCacheKey: "off",
        },
        { maxEntries: 1, maxBytes: 4096 },
      );
      assertEquals(graph.files.length, 1);
      assertEquals(
        recoveryLookups,
        0,
        "inert text must not trigger an uncaptured file walk or HTTP recovery",
      );
    } finally {
      __setDistributedCacheAccessorForTests(null);
      await fs.remove(dir, { recursive: true });
    }
  });

  it("prepares a closed graph from the final root and HTTP dependencies on cold and warm caches", async () => {
    const fs = createFileSystem();
    const dir = await fs.makeTempDir();
    const cacheDir = join(dir, "cache");
    let fetches = 0;
    let artifacts: RenderArtifacts | undefined;
    __setDistributedCacheAccessorForTests(() => Promise.resolve(null));
    try {
      await runWithCacheDir(cacheDir, () =>
        withMockFetch(async (input) => {
          fetches++;
          const source = new URL(String(input)).pathname === "/child.mjs"
            ? 'export const load = () => import("./leaf.mjs");'
            : "export const value = 42;";
          return new Response(source);
        }, async () => {
          const context = {
            adapter: await runtime.get(),
            projectDir: dir,
            projectId: "graph-test",
            contentSourceId: "release-test",
            dependencyPinningCacheKey: "off",
          };
          const code = 'export const load = () => import("https://example.invalid/child.mjs");';
          const limits = { maxEntries: 3, maxBytes: 16_384 };
          const cold = await prepareModuleGraphESM(code, context, limits);
          const warm = await prepareModuleGraphESM(code, context, limits);
          assertEquals(warm, cold, "cache hits must preserve the complete captured graph");
          assertEquals(cold.files.length, 3);
          assertEquals(fetches, 2, "warm preparation must not refetch the HTTP graph");
          await assertRejects(
            () => prepareModuleGraphESM(code, context, { ...limits, maxEntries: 2 }),
            Error,
            "entry budget",
          );
          await fs.remove(cacheDir, { recursive: true });
          artifacts = new RenderArtifacts(cold, limits);
          assertEquals((await artifacts.prepare()).fileCount, 3);
        }));
    } finally {
      await artifacts?.release();
      __setDistributedCacheAccessorForTests(null);
      await fs.remove(dir, { recursive: true });
    }
  });

  it("rejects an uncaptured file dependency instead of publishing a partial graph", async () => {
    const fs = createFileSystem();
    const dir = await fs.makeTempDir();
    try {
      const childPath = join(dir, "child.mjs");
      await fs.writeTextFile(childPath, "export const value = 42;");
      await assertRejects(
        () =>
          prepareModuleGraphESM(
            `export * from ${jsonForInlineScript(toFileUrl(childPath).href)};`,
            {
              adapter: undefined,
              projectDir: dir,
              projectId: "graph-test",
              contentSourceId: "release-test",
              esmCacheDir: dir,
              dependencyPinningCacheKey: "off",
            },
            { maxEntries: 3, maxBytes: 16_384 },
          ),
        Error,
        "Unscoped file import",
      );
    } finally {
      await fs.remove(dir, { recursive: true });
    }
  });

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
