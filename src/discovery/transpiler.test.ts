import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { clearTranspileCache, importModule } from "./transpiler.ts";
import type { FileDiscoveryContext } from "./types.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import type { Bundler } from "#veryfront/extensions/bundler/bundler.ts";
import { ensureDefaultBundlerContracts } from "#veryfront/extensions/bundler/defaults.ts";
import { register, reset, tryResolve } from "#veryfront/extensions/contracts.ts";
import * as embeddingMod from "#veryfront/embedding/index.ts";
import * as knowledgeMod from "#veryfront/knowledge";
import { toFileUrl } from "#veryfront/compat/path";
import { runWithCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
import { ensureBuiltinSchemaValidator } from "#veryfront/extensions/builtin-schema-validator.ts";

/**
 * Creates a mock FileSystemAdapter backed by an in-memory file map.
 *
 * When `projectDir` is given, absolute paths under it are converted back to
 * project-relative keys, mirroring the real veryfront adapter's
 * PathNormalizer (hosted runs address the VFS with relative paths while the
 * transpiler resolves imports against the process cwd).
 */
function createMockAdapter(
  files: Record<string, string>,
  options: { projectDir?: string } = {},
): FileSystemAdapter {
  const normalize = (path: string): string => {
    const { projectDir } = options;
    if (projectDir && path.startsWith(projectDir)) {
      return path.slice(projectDir.length).replace(/^\/+/, "");
    }
    return path;
  };
  return {
    async readFile(path: string): Promise<string> {
      const content = files[normalize(path)];
      if (content === undefined) throw new Error(`File not found: ${path}`);
      return content;
    },
    async exists(path: string): Promise<boolean> {
      return normalize(path) in files;
    },
    async *readDir(path: string) {
      const prefix = path.endsWith("/") ? path : `${path}/`;
      const seen = new Set<string>();
      for (const key of Object.keys(files)) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const name = rest.split("/")[0]!;
        if (seen.has(name)) continue;
        seen.add(name);
        const isFile = !rest.includes("/");
        yield { name, isFile, isDirectory: !isFile, isSymlink: false };
      }
    },
    async stat(path: string) {
      const isFile = path in files;
      return {
        size: isFile ? files[path]!.length : 0,
        isFile,
        isDirectory: !isFile,
        isSymlink: false,
        mtime: new Date(),
      };
    },
    async writeFile() {},
    async mkdir() {},
    async remove() {},
    async makeTempDir() {
      return "/tmp/mock";
    },
    watch() {
      return null as never;
    },
  } satisfies FileSystemAdapter;
}

describe("embedding module static import", () => {
  // The embedding module must be statically imported so deno compile includes
  // it in the binary. Unlike agent/tool/platform which are statically imported
  // throughout the codebase, embedding is registered by the discovery runtime
  // bootstrap. If this import breaks, the compiled binary cannot load upload handlers.

  it("exports createUploadHandler", () => {
    assertEquals(typeof embeddingMod.createUploadHandler, "function");
  });

  it("exports ragStore", () => {
    assertEquals(typeof embeddingMod.ragStore, "function");
  });

  it("exports embedding", () => {
    assertEquals(typeof embeddingMod.embedding, "function");
  });

  it("exports vectorStore", () => {
    assertEquals(typeof embeddingMod.vectorStore, "function");
  });

  it("exports chunk", () => {
    assertEquals(typeof embeddingMod.chunk, "function");
  });

  it("exports loadUpload", () => {
    assertEquals(typeof embeddingMod.loadUpload, "function");
  });
});

describe("knowledge module static import", () => {
  it("exports projectKnowledge", () => {
    assertEquals(typeof knowledgeMod.projectKnowledge, "function");
  });
});

// esbuild starts a child process that lives across tests, so we disable sanitizers
describe("discovery/transpiler", { sanitizeOps: false, sanitizeResources: false }, () => {
  afterEach(() => {
    clearTranspileCache();
    ensureBuiltinSchemaValidator();
  });

  afterAll(async () => {
    await stopEsbuild();
  });

  describe("importModule with native files", () => {
    it("decodes canonical file URLs exactly once during import", async () => {
      const parent = await Deno.makeTempDir();
      const dir = `${parent}/discovery %20 path`;
      const file = `${dir}/encoded module.ts`;
      try {
        await Deno.mkdir(dir);
        await Deno.writeTextFile(file, `export default { loaded: true };`);

        const mod = await importModule(toFileUrl(file).href, {
          platform: "node",
        }) as { default: { loaded: boolean } };

        assertEquals(mod.default.loaded, true);
      } finally {
        await Deno.remove(parent, { recursive: true });
      }
    });

    it("invalidates a native bundle when a relative dependency changes", async () => {
      const dir = await Deno.makeTempDir();
      const entry = `${dir}/entry.ts`;
      const dependency = `${dir}/dependency.ts`;
      try {
        await Deno.writeTextFile(
          entry,
          'import { value } from "./dependency.ts"; export default { value };',
        );
        await Deno.writeTextFile(dependency, "export const value = 1;");

        const first = await importModule(toFileUrl(entry).href, {
          platform: "node",
        }) as { default: { value: number } };
        assertEquals(first.default.value, 1);

        await Deno.writeTextFile(dependency, "export const value = 2;");
        const second = await importModule(toFileUrl(entry).href, {
          platform: "node",
        }) as { default: { value: number } };
        assertEquals(second.default.value, 2);
      } finally {
        await Deno.remove(dir, { recursive: true });
      }
    });

    it("invalidates native extensionless resolution when a higher-priority file appears", async () => {
      const dir = await Deno.makeTempDir();
      const entry = `${dir}/entry.ts`;
      const lowerPriorityDependency = `${dir}/config.tsx`;
      const higherPriorityDependency = `${dir}/config.ts`;
      try {
        await Deno.writeTextFile(
          entry,
          'import { value } from "./config"; export default { value };',
        );
        await Deno.writeTextFile(lowerPriorityDependency, 'export const value = "tsx";');

        const first = await importModule(toFileUrl(entry).href, {
          platform: "node",
        }) as { default: { value: string } };
        assertEquals(first.default.value, "tsx");

        await Deno.writeTextFile(higherPriorityDependency, 'export const value = "ts";');
        const second = await importModule(toFileUrl(entry).href, {
          platform: "node",
        }) as { default: { value: string } };
        const cachedSecond = await importModule(toFileUrl(entry).href, {
          platform: "node",
        });

        assertEquals(second.default.value, "ts");
        assertEquals(cachedSecond === second, true);
      } finally {
        await Deno.remove(dir, { recursive: true });
      }
    });

    it("does not cache native builds when a bundler omits dependency metadata", async () => {
      await ensureDefaultBundlerContracts();
      const originalBundler = tryResolve<Bundler>("Bundler");
      if (!originalBundler) throw new Error("Expected the default bundler to be registered");

      const bundlerWithoutMetafile: Bundler = {
        async bundle(options) {
          const result = { ...await originalBundler.bundle(options) };
          delete result.metafile;
          return result;
        },
        transform(options) {
          return originalBundler.transform(options);
        },
      };

      const dir = await Deno.makeTempDir();
      const entry = `${dir}/entry.ts`;
      try {
        register("Bundler", bundlerWithoutMetafile);
        await Deno.writeTextFile(entry, "export default { value: 1 };");

        const first = await importModule(toFileUrl(entry).href, {
          platform: "node",
        });
        const second = await importModule(toFileUrl(entry).href, {
          platform: "node",
        });

        assertEquals(first === second, false);
      } finally {
        register("Bundler", originalBundler);
        await Deno.remove(dir, { recursive: true });
      }
    });

    it("rejects a successful bundler result without JavaScript output", async () => {
      await ensureDefaultBundlerContracts();
      const originalBundler = tryResolve<Bundler>("Bundler");
      if (!originalBundler) throw new Error("Expected the default bundler to be registered");

      const outputlessBundler: Bundler = {
        async bundle(options) {
          return {
            ...await originalBundler.bundle(options),
            outputFiles: [],
          };
        },
        transform(options) {
          return originalBundler.transform(options);
        },
      };

      const dir = await Deno.makeTempDir();
      const entry = `${dir}/entry.ts`;
      try {
        register("Bundler", outputlessBundler);
        await Deno.writeTextFile(entry, "export default { value: 1 };");

        await assertRejects(
          () => importModule(toFileUrl(entry).href, { platform: "node" }),
          Error,
          "Bundler produced no JavaScript output",
        );
      } finally {
        register("Bundler", originalBundler);
        await Deno.remove(dir, { recursive: true });
      }
    });
  });

  describe("importModule with fsAdapter", () => {
    it("should transpile a simple module via fsAdapter", async () => {
      const files: Record<string, string> = {
        "/project/agents/assistant.ts": `export default { name: "test-agent" };`,
      };

      const adapter = createMockAdapter(files);
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: adapter,
        baseDir: "/project",
      };

      const mod = await importModule(
        "file:///project/agents/assistant.ts",
        context,
      ) as { default: { name: string } };

      assertEquals(mod.default.name, "test-agent");
    });

    it("lazily registers the installed default bundler before discovery transpilation", async () => {
      reset();
      assertEquals(tryResolve("Bundler"), undefined);
      assertEquals(tryResolve("ModuleLexer"), undefined);

      const files: Record<string, string> = {
        "/project/schedules/daily.ts":
          `export default { id: "daily", schedule: "0 8 * * *", target: "noop" };`,
      };

      const adapter = createMockAdapter(files);
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: adapter,
        baseDir: "/project",
      };

      const mod = await importModule(
        "file:///project/schedules/daily.ts",
        context,
      ) as { default: { id: string } };

      assertEquals(mod.default.id, "daily");
      assertEquals(typeof tryResolve<{ bundle?: unknown }>("Bundler")?.bundle, "function");
      assertEquals(typeof tryResolve<{ parse?: unknown }>("ModuleLexer")?.parse, "function");
    });

    it("should resolve relative imports via fsAdapter plugin", async () => {
      const files: Record<string, string> = {
        "/project/agents/assistant.ts": [
          `import { CONFIG } from "./config";`,
          `export default { name: "assistant", model: CONFIG.model };`,
        ].join("\n"),
        "/project/agents/config.ts": [
          `export const CONFIG = { model: "gpt-4" };`,
        ].join("\n"),
      };

      const adapter = createMockAdapter(files);
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: adapter,
        baseDir: "/project",
      };

      const mod = await importModule(
        "file:///project/agents/assistant.ts",
        context,
      ) as { default: { name: string; model: string } };

      assertEquals(mod.default.name, "assistant");
      assertEquals(mod.default.model, "gpt-4");
    });

    it("should resolve deep relative imports across directories", async () => {
      const files: Record<string, string> = {
        "/project/agents/assistant.ts": [
          `import { helper } from "./utils/helper";`,
          `export default { value: helper() };`,
        ].join("\n"),
        "/project/agents/utils/helper.ts": [
          `export function helper() { return 42; }`,
        ].join("\n"),
      };

      const adapter = createMockAdapter(files);
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: adapter,
        baseDir: "/project",
      };

      const mod = await importModule(
        "file:///project/agents/assistant.ts",
        context,
      ) as { default: { value: number } };

      assertEquals(mod.default.value, 42);
    });

    it("should resolve parent-directory imports on hosted runs with relative baseDir", async () => {
      // Hosted (cloud) discovery uses baseDir "" and addresses the VFS with
      // project-relative paths like "tools/foo.ts". Regression test for the
      // esbuild stdin sourcefile doubling the directory prefix
      // ("tools/tools/foo.ts"), which anchored ../ imports one directory too
      // deep and made discovery skip every tool/agent.
      const files: Record<string, string> = {
        "tools/read-baseline.ts": [
          `import { helper } from "../lib/util";`,
          `export default { value: helper() };`,
        ].join("\n"),
        "lib/util.ts": `export function helper() { return "baseline"; }`,
      };

      const adapter = createMockAdapter(files, { projectDir: Deno.cwd() });
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: adapter,
        baseDir: "",
      };

      const mod = await importModule(
        "file://tools/read-baseline.ts",
        context,
      ) as { default: { value: string } };

      assertEquals(mod.default.value, "baseline");
    });

    it("should not serve a stale cached module when content changes at the same path", async () => {
      // The shared hosted runtime serves many projects and releases from one
      // process; the same relative path recurs across them. A path-only cache
      // key kept serving the previous release's module after a deploy.
      const path = "/project/agents/assistant.ts";
      const files = {
        [path]: `export default { version: "release-1" };`,
      };
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: createMockAdapter(files),
        baseDir: "/project",
      };

      const first = await importModule(
        `file://${path}`,
        context,
      ) as { default: { version: string } };
      assertEquals(first.default.version, "release-1");

      files[path] = `export default { version: "release-2" };`;
      const second = await importModule(
        `file://${path}`,
        context,
      ) as { default: { version: string } };
      assertEquals(second.default.version, "release-2");

      // Unchanged content is still served from the cache (same module object).
      const third = await importModule(
        `file://${path}`,
        context,
      );
      assertEquals(third === second, true);
    });

    it("should not serve a stale cached module when a bundled dependency changes", async () => {
      // esbuild inlines relative imports into the bundle, so an unchanged
      // entry file does not mean an unchanged module: a release that only
      // edits lib/ code (or another project sharing the same entry source)
      // must not be served the previously bundled dependency contents.
      const entryPath = "/project/agents/assistant.ts";
      const entrySource = [
        `import { CONFIG } from "./config";`,
        `export default { model: CONFIG.model };`,
      ].join("\n");
      const dependencyPath = "/project/agents/config.ts";
      const files = {
        [entryPath]: entrySource,
        [dependencyPath]: `export const CONFIG = { model: "gpt-4" };`,
      };
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: createMockAdapter(files),
        baseDir: "/project",
      };

      const first = await importModule(
        `file://${entryPath}`,
        context,
      ) as { default: { model: string } };
      assertEquals(first.default.model, "gpt-4");

      files[dependencyPath] = `export const CONFIG = { model: "gpt-5.5" };`;
      const second = await importModule(
        `file://${entryPath}`,
        context,
      ) as { default: { model: string } };
      assertEquals(second.default.model, "gpt-5.5");

      // Both dependency versions stay cached: reverting to the original
      // dependency contents serves the originally built module object.
      files[dependencyPath] = `export const CONFIG = { model: "gpt-4" };`;
      const third = await importModule(
        `file://${entryPath}`,
        context,
      );
      assertEquals(third === first, true);
    });

    it("invalidates extensionless resolution without a source-snapshot namespace", async () => {
      const entryPath = "/project/agents/assistant.ts";
      const lowerPriorityDependency = "/project/agents/config.tsx";
      const higherPriorityDependency = "/project/agents/config.ts";
      const files: Record<string, string> = {
        [entryPath]: [
          'import { model } from "./config";',
          "export default { model };",
        ].join("\n"),
        [lowerPriorityDependency]: 'export const model = "tsx";',
      };
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: createMockAdapter(files),
        baseDir: "/project",
        cacheNamespace: "project:preview:main",
      };

      const first = await importModule(`file://${entryPath}`, context) as {
        default: { model: string };
      };
      assertEquals(first.default.model, "tsx");

      files[higherPriorityDependency] = 'export const model = "ts";';
      const second = await importModule(`file://${entryPath}`, context) as {
        default: { model: string };
      };
      const cachedSecond = await importModule(`file://${entryPath}`, context);

      assertEquals(second.default.model, "ts");
      assertEquals(cachedSecond === second, true);
    });

    it("deduplicates concurrent imports from the same source adapter", async () => {
      const path = "/project/agents/assistant.ts";
      const adapter = createMockAdapter({
        [path]: `export default { version: "concurrent" };`,
      });
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: adapter,
        baseDir: "/project",
      };

      const [first, second, third] = await Promise.all([
        importModule(`file://${path}`, context),
        importModule(`file://${path}`, context),
        importModule(`file://${path}`, context),
      ]);

      assertEquals(first === second, true);
      assertEquals(second === third, true);
    });

    it("does not share evaluated module objects across source adapters", async () => {
      const path = "/project/agents/assistant.ts";
      const source = `export default { version: "same-source" };`;
      const contextFor = (fsAdapter: FileSystemAdapter): FileDiscoveryContext => ({
        platform: "node",
        fsAdapter,
        baseDir: "/project",
      });

      const first = await importModule(
        `file://${path}`,
        contextFor(createMockAdapter({ [path]: source })),
      );
      const second = await importModule(
        `file://${path}`,
        contextFor(createMockAdapter({ [path]: source })),
      );

      assertEquals(first === second, false);
    });

    it("does not resurrect a cache entry cleared during dependency validation", async () => {
      const entryPath = "/project/agents/assistant.ts";
      const dependencyPath = "/project/agents/config.ts";
      const files = {
        [entryPath]: [
          'import { model } from "./config.ts";',
          "export default { model };",
        ].join("\n"),
        [dependencyPath]: 'export const model = "gpt-5";',
      };
      const baseAdapter = createMockAdapter(files);
      const validationStarted = Promise.withResolvers<void>();
      const releaseValidation = Promise.withResolvers<void>();
      let delayDependencyRead = false;
      let dependencyReadDelayed = false;
      const adapter: FileSystemAdapter = {
        ...baseAdapter,
        async readFile(path) {
          if (
            delayDependencyRead &&
            !dependencyReadDelayed &&
            path === dependencyPath
          ) {
            dependencyReadDelayed = true;
            validationStarted.resolve();
            await releaseValidation.promise;
          }
          return await baseAdapter.readFile(path);
        },
      };
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: adapter,
        baseDir: "/project",
      };

      const first = await importModule(`file://${entryPath}`, context);
      delayDependencyRead = true;
      const pending = importModule(`file://${entryPath}`, context);
      await validationStarted.promise;
      clearTranspileCache();
      releaseValidation.resolve();

      const refreshed = await pending;
      const cachedRefresh = await importModule(`file://${entryPath}`, context);

      assertEquals(refreshed === first, false);
      assertEquals(cachedRefresh === refreshed, true);
    });

    it("does not share evaluated module objects across registry scopes", async () => {
      const path = "/project/agents/assistant.ts";
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: createMockAdapter({
          [path]: `export default { version: "same-source" };`,
        }),
        baseDir: "/project",
      };

      const first = await runWithCacheKeyContext(
        { projectId: "project-a", mode: "preview", versionId: "main" },
        () => importModule(`file://${path}`, context),
      );
      const second = await runWithCacheKeyContext(
        { projectId: "project-b", mode: "preview", versionId: "main" },
        () => importModule(`file://${path}`, context),
      );

      assertEquals(first === second, false);
    });

    it("should throw when file is not found via fsAdapter", async () => {
      const adapter = createMockAdapter({});
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: adapter,
        baseDir: "/project",
      };

      await assertRejects(
        () => importModule("file:///project/agents/missing.ts", context),
        Error,
        "Failed to read file",
      );
    });
  });
});
