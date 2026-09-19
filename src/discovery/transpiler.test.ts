import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  authorizeProjectDependencySourceUrl,
  clearTranspileCache,
  createProjectDependencyCdnPlugin,
  createProjectDependencySourceFetcher,
  describeUnresolvableNpmImport,
  discoveryPathForDisplay,
  discoveryPathNames,
  esmCdnModuleSpecifier,
  esmCdnPackageName,
  importModule as importModuleRaw,
  readDependencyPins,
  withDisplayPath,
} from "./transpiler.ts";
import type { FileDiscoveryContext } from "./types.ts";
import { EMBEDDED_NPM_CONSTRAINTS } from "./embedded-npm-packages.generated.ts";
import { isFrameworkProvidedPackage } from "./project-npm-imports.ts";
import { type PluginBuild, stop as stopEsbuild } from "veryfront/extensions/bundler";
import { reset, tryResolve } from "#veryfront/extensions/contracts.ts";
import * as embeddingMod from "#veryfront/embedding/index.ts";
import * as knowledgeMod from "#veryfront/knowledge";

function importModule(file: string, context: FileDiscoveryContext) {
  return importModuleRaw(file, {
    ...context,
    allowHostProjectCodeExecution: true,
  });
}

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

type ResolveCallback = Parameters<PluginBuild["onResolve"]>[1];
type ResolveArgs = Parameters<ResolveCallback>[0];

/**
 * The `onResolve` callbacks a plugin registers, by namespace, captured through
 * a fake build so each resolver decision can be asserted without a bundle.
 */
type LoadCallback = Parameters<PluginBuild["onLoad"]>[1];

function captureResolvers(
  plugin: { setup(build: PluginBuild): void | Promise<void> },
): {
  httpUrl: ResolveCallback;
  bare: ResolveCallback;
  remote: ResolveCallback;
  loaders: Map<string, LoadCallback>;
} {
  const resolvers: Array<{ filter: RegExp; namespace?: string; callback: ResolveCallback }> = [];
  const loaders = new Map<string, LoadCallback>();
  const build = {
    onResolve(options: { filter: RegExp; namespace?: string }, callback: ResolveCallback) {
      resolvers.push({ ...options, callback });
    },
    onLoad(options: { filter: RegExp; namespace?: string }, callback: LoadCallback) {
      loaders.set(options.namespace ?? "file", callback);
    },
  } as unknown as PluginBuild;
  plugin.setup(build);
  const httpUrl = resolvers.find((resolver) => resolver.namespace === "http-url");
  const remote = resolvers.find((resolver) =>
    resolver.namespace === undefined && resolver.filter.test("https://example.com/x.js")
  );
  const bare = resolvers.find((resolver) =>
    resolver.namespace === undefined && resolver !== remote
  );
  assert(httpUrl && bare && remote, "the plugin must register all three resolvers");
  return { httpUrl: httpUrl.callback, bare: bare.callback, remote: remote.callback, loaders };
}

function resolveArgs(overrides: Partial<ResolveArgs>): ResolveArgs {
  return {
    path: "",
    importer: "",
    namespace: "file",
    resolveDir: "/project",
    kind: "import-statement",
    ...overrides,
  };
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
  });

  afterAll(async () => {
    await stopEsbuild();
  });

  describe("importModule with fsAdapter", () => {
    it("rejects untrusted discovery before reading or evaluating project code", async () => {
      const marker = "__vf_untrusted_discovery_marker__";
      delete (globalThis as Record<string, unknown>)[marker];
      let reads = 0;
      const adapter = createMockAdapter({
        "/project/tools/untrusted.ts":
          `globalThis.${marker} = Deno.env.get("VERYFRONT_API_TOKEN"); export default {};`,
      });
      const readFile = adapter.readFile.bind(adapter);
      adapter.readFile = (path) => {
        reads++;
        return readFile(path);
      };

      await assertRejects(
        () =>
          importModuleRaw("file:///project/tools/untrusted.ts", {
            platform: "node",
            fsAdapter: adapter,
            baseDir: "/project",
          }),
        TypeError,
        "explicit trusted-local execution",
      );
      assertEquals(reads, 0);
      assertEquals((globalThis as Record<string, unknown>)[marker], undefined);
    });

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
      const contextFor = (content: string): FileDiscoveryContext => ({
        platform: "node",
        fsAdapter: createMockAdapter({ [path]: content }),
        baseDir: "/project",
      });

      const first = await importModule(
        `file://${path}`,
        contextFor(`export default { version: "release-1" };`),
      ) as { default: { version: string } };
      assertEquals(first.default.version, "release-1");

      const second = await importModule(
        `file://${path}`,
        contextFor(`export default { version: "release-2" };`),
      ) as { default: { version: string } };
      assertEquals(second.default.version, "release-2");

      // Unchanged content is still served from the cache (same module object).
      const third = await importModule(
        `file://${path}`,
        contextFor(`export default { version: "release-2" };`),
      );
      assertEquals(third === second, true);
    });

    it("should isolate identical sources by cache namespace", async () => {
      // Hosted runs address the VFS with baseDir "", so the explicit cache
      // namespace is the only tenant separator: two projects whose entry
      // module has byte-identical source must not share a module instance
      // (and therefore must not share its module-level state).
      const path = "/project/tools/x.ts";
      const source = `export default { value: 1 };`;
      const contextFor = (cacheNamespace: string): FileDiscoveryContext => ({
        platform: "node",
        fsAdapter: createMockAdapter({ [path]: source }),
        baseDir: "",
        cacheNamespace,
      });

      const projectA = await importModule(`file://${path}`, contextFor("project-a"));
      const projectB = await importModule(`file://${path}`, contextFor("project-b"));
      assertEquals(
        projectA === projectB,
        false,
        "different cache namespaces must not share a module instance",
      );

      const projectAAgain = await importModule(`file://${path}`, contextFor("project-a"));
      assertEquals(
        projectAAgain === projectA,
        true,
        "the same cache namespace must reuse the cached module",
      );
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
      const contextFor = (depSource: string): FileDiscoveryContext => ({
        platform: "node",
        fsAdapter: createMockAdapter({
          [entryPath]: entrySource,
          "/project/agents/config.ts": depSource,
        }),
        baseDir: "/project",
      });

      const first = await importModule(
        `file://${entryPath}`,
        contextFor(`export const CONFIG = { model: "gpt-4" };`),
      ) as { default: { model: string } };
      assertEquals(first.default.model, "gpt-4");

      const second = await importModule(
        `file://${entryPath}`,
        contextFor(`export const CONFIG = { model: "gpt-5.5" };`),
      ) as { default: { model: string } };
      assertEquals(second.default.model, "gpt-5.5");

      // Both dependency versions stay cached: reverting to the original
      // dependency contents serves the originally built module object.
      const third = await importModule(
        `file://${entryPath}`,
        contextFor(`export const CONFIG = { model: "gpt-4" };`),
      );
      assertEquals(third === first, true);
    });
  });

  describe("readDependencyPins", () => {
    it("keeps every declaration verbatim, ranges and aliases included", () => {
      // Filtering ranges out here is what discarded `"mammoth": "^1.8.0"` --
      // the shape `npm install` writes by default -- and left the import with
      // nothing to inline. Reducing a declaration to the one version it names
      // is classifyProjectNpmImport's job, not this one's.
      assertEquals(
        readDependencyPins(JSON.stringify({
          dependencies: { unpdf: "1.8.1", mammoth: "^1.8.0", local: "file:../local" },
          devDependencies: { "@scope/pkg": "2.0.0-rc.1", star: "*", blank: "  ", nested: 3 },
        })),
        {
          unpdf: "1.8.1",
          mammoth: "^1.8.0",
          local: "file:../local",
          "@scope/pkg": "2.0.0-rc.1",
          star: "*",
        },
      );
    });

    it("reads optional dependencies, which npm installs like any other", () => {
      assertEquals(
        readDependencyPins(JSON.stringify({
          dependencies: { sharp: "0.34.5", unpdf: "1.8.1" },
          optionalDependencies: { sharp: "0.35.4", canvas: "^3.1.0" },
        })),
        { sharp: "0.35.4", unpdf: "1.8.1", canvas: "^3.1.0" },
      );
    });

    it("reads peer dependencies, below every installed declaration", () => {
      assertEquals(
        readDependencyPins(JSON.stringify({
          peerDependencies: { react: "^18.0.0 || ^19.0.0", "pdf-kit": "2.0.0" },
          devDependencies: { react: "19.2.4" },
        })),
        { react: "19.2.4", "pdf-kit": "2.0.0" },
      );
    });

    it("never lets a declaration replace the pin table's prototype", () => {
      const pins = readDependencyPins('{"dependencies":{"__proto__":"1.0.0","unpdf":"1.8.1"}}');
      assertEquals(pins, { unpdf: "1.8.1" });
      assertEquals(Object.getPrototypeOf(pins), Object.prototype);
    });

    it("returns no pins for malformed package.json", () => {
      assertEquals(readDependencyPins("{ not json"), {});
    });
  });

  describe("esmCdnPackageName", () => {
    // This is what the http-url namespace guard reads. Without it a
    // CDN-inlined project dependency that transitively imports zod,
    // @opentelemetry/* or veryfront pulls a SECOND copy into the discovery
    // bundle, and the schema and element registries compare identities
    // against the framework's own copy.
    it("names the package an esm.sh module path pins", () => {
      assertEquals(esmCdnPackageName(new URL("https://esm.sh/zod@3.25.76/es2022/zod.mjs")), "zod");
      assertEquals(esmCdnPackageName(new URL("https://esm.sh/v135/react@19.2.4/mod.js")), "react");
      assertEquals(
        esmCdnPackageName(new URL("https://esm.sh/@scope/pkg@1.0.0/mod.js")),
        "@scope/pkg",
      );
      assertEquals(esmCdnPackageName(new URL("https://esm.sh/unpdf")), "unpdf");
    });

    it("ignores anything that is not on the CDN", () => {
      assertEquals(esmCdnPackageName(new URL("https://example.com/zod@3.25.76/zod.mjs")), null);
      assertEquals(esmCdnPackageName(new URL("https://esm.sh/")), null);
    });
  });

  describe("esmCdnModuleSpecifier", () => {
    // This is what the http-url guard externalizes in place of the URL. The
    // package name alone is not enough: `react/jsx-runtime` handed back as
    // `react` imports a module with no `jsx` or `jsxs` export, so every JSX
    // element in a CDN-inlined dependency fails the moment the module loads.
    it("keeps the framework subpath a CDN module addresses", () => {
      assertEquals(
        esmCdnModuleSpecifier(new URL("https://esm.sh/react@19.2.4/es2022/jsx-runtime.mjs")),
        "react/jsx-runtime",
      );
      assertEquals(
        esmCdnModuleSpecifier(new URL("https://esm.sh/react@19.2.4/denonext/jsx-dev-runtime.mjs")),
        "react/jsx-dev-runtime",
      );
      assertEquals(
        esmCdnModuleSpecifier(new URL("https://esm.sh/react-dom@19.2.4/es2022/client.mjs")),
        "react-dom/client",
      );
      // A scoped package's subpath survives the extra name segment.
      assertEquals(
        esmCdnModuleSpecifier(
          new URL("https://esm.sh/@opentelemetry/api@1.9.0/es2022/experimental.mjs"),
        ),
        "@opentelemetry/api/experimental",
      );
      // esm.sh puts build options in an `X-<base64>` segment before the target.
      assertEquals(
        esmCdnModuleSpecifier(
          new URL(
            "https://esm.sh/react@19.2.4/X-ZGNzc3R5cGVAMy4yLjMKZXJlYWN0/es2022/jsx-runtime.mjs",
          ),
        ),
        "react/jsx-runtime",
      );
      assertEquals(
        esmCdnModuleSpecifier(
          new URL("https://esm.sh/react@19.2.4/X-ZGNzc3R5cGVAMy4yLjMKZXJlYWN0/es2022/react.mjs"),
        ),
        "react",
      );
      // Build-variant file names (`?dev`, `?bundle`) address the same export.
      assertEquals(
        esmCdnModuleSpecifier(
          new URL(
            "https://esm.sh/react@19.2.4/X-ZGNzc3R5cGVAMy4yLjMKZXJlYWN0/es2022/jsx-dev-runtime.development.mjs",
          ),
        ),
        "react/jsx-dev-runtime",
      );
      assertEquals(
        esmCdnModuleSpecifier(new URL("https://esm.sh/react@19.2.4/es2022/react.development.mjs")),
        "react",
      );
      assertEquals(
        esmCdnModuleSpecifier(new URL("https://esm.sh/react-dom@19.2.4/es2022/client.bundle.mjs")),
        "react-dom/client",
      );
      assertEquals(
        esmCdnModuleSpecifier(
          new URL("https://esm.sh/react-dom@19.2.4/es2022/client.development.bundle.mjs"),
        ),
        "react-dom/client",
      );
      assertEquals(
        esmCdnModuleSpecifier(new URL("https://esm.sh/v135/react@19.2.4/es2022/jsx-runtime.mjs")),
        "react/jsx-runtime",
      );
    });

    it("reads the package root as the bare package name", () => {
      // esm.sh names the root module after the package, so `es2022/zod.mjs`
      // under `zod@3.25.76` is the root and must not become `zod/zod`.
      assertEquals(
        esmCdnModuleSpecifier(new URL("https://esm.sh/zod@3.25.76/es2022/zod.mjs")),
        "zod",
      );
      assertEquals(
        esmCdnModuleSpecifier(new URL("https://esm.sh/@opentelemetry/api@1.9.0/es2022/api.mjs")),
        "@opentelemetry/api",
      );
      assertEquals(
        esmCdnModuleSpecifier(new URL("https://esm.sh/react@19.2.4?target=es2022")),
        "react",
      );
      assertEquals(esmCdnModuleSpecifier(new URL("https://esm.sh/unpdf")), "unpdf");
    });

    it("ignores anything that is not on the CDN", () => {
      assertEquals(
        esmCdnModuleSpecifier(new URL("https://example.com/react@19.2.4/es2022/jsx-runtime.mjs")),
        null,
      );
      assertEquals(esmCdnModuleSpecifier(new URL("https://esm.sh/")), null);
    });
  });

  describe("discoveryPathForDisplay", () => {
    // AGENTS.md's secret and internal-detail safety rules put a user home
    // directory and a machine-specific filesystem layout on the list of things
    // user-facing output must never carry, and a local discovery run resolves
    // its `file://` entry to exactly that.
    it("renders a discovered file relative to the project root", () => {
      assertEquals(
        discoveryPathForDisplay("/srv/projects/acme/tools/extract.ts", "/srv/projects/acme"),
        "tools/extract.ts",
      );
      assertEquals(
        discoveryPathForDisplay("/srv/projects/acme/tools/extract.ts", "/srv/projects/acme/"),
        "tools/extract.ts",
      );
    });

    it("keeps a path that is already relative", () => {
      assertEquals(discoveryPathForDisplay("tools/extract.ts", ""), "tools/extract.ts");
      assertEquals(discoveryPathForDisplay("tools/extract.ts", undefined), "tools/extract.ts");
    });

    it("discloses no machine layout when there is no root to render against", () => {
      assertEquals(discoveryPathForDisplay("/home/someone/work/tools/extract.ts"), "extract.ts");
      assertEquals(
        discoveryPathForDisplay("/home/someone/work/tools/extract.ts", "/srv/other"),
        "extract.ts",
      );
      assertEquals(
        discoveryPathForDisplay("C:\\Users\\someone\\work\\extract.ts", ""),
        "extract.ts",
      );
    });
  });

  describe("withDisplayPath", () => {
    const paths = discoveryPathNames("/app/tools/extract.ts", "/app");

    it("renders the project root relative only at a path boundary", () => {
      assertEquals(
        withDisplayPath('Could not resolve "./x" from "/app/tools" via fsAdapter', paths),
        'Could not resolve "./x" from "tools" via fsAdapter',
      );
      assertEquals(withDisplayPath("read /app/tools/extract.ts", paths), "read tools/extract.ts");
      assertEquals(withDisplayPath("cwd is /app", paths), "cwd is .");
      assertEquals(withDisplayPath("(/app)", paths), "(.)");
    });

    it("renders a file URL under the project root relative", () => {
      assertEquals(
        withDisplayPath('Module not found "file:///app/lib/x.ts"', paths),
        'Module not found "lib/x.ts"',
      );
      assertEquals(withDisplayPath("at file:///app", paths), "at .");
      assertEquals(
        withDisplayPath("at file:///application/x.ts", paths),
        "at file:///application/x.ts",
      );
    });

    it("keeps a filesystem root as the project root", () => {
      const posix = discoveryPathNames("/tools/a.ts", "/");
      assertEquals(posix.display, "tools/a.ts");
      assertEquals(
        withDisplayPath('Could not resolve "/lib/x.ts" from "/tools"', posix),
        'Could not resolve "lib/x.ts" from "tools"',
      );
      assertEquals(withDisplayPath('at "file:///lib/x.ts"', posix), 'at "lib/x.ts"');
      assertEquals(
        withDisplayPath("fetch https://esm.sh/pkg@1.0.0/x.mjs", posix),
        "fetch https://esm.sh/pkg@1.0.0/x.mjs",
      );

      const drive = discoveryPathNames("C:/tools/a.ts", "C:\\");
      assertEquals(drive.display, "tools/a.ts");
      assertEquals(withDisplayPath("read 'C:\\lib\\x.ts'", drive), "read 'lib\\x.ts'");
      assertEquals(withDisplayPath('at "file:///c:/lib/x.ts"', drive), 'at "lib/x.ts"');
    });

    it("redacts a Windows project root in either separator style and any drive case", () => {
      const windows = discoveryPathNames("C:/Users/me/proj/tools/a.ts", "C:\\Users\\me\\proj\\");
      assertEquals(windows.display, "tools/a.ts");
      assertEquals(
        withDisplayPath('Could not resolve "C:/Users/me/proj/lib/x.ts"', windows),
        'Could not resolve "lib/x.ts"',
      );
      assertEquals(
        withDisplayPath("readTextFile 'C:\\Users\\me\\proj\\lib\\x.ts'", windows),
        "readTextFile 'lib\\x.ts'",
      );
      assertEquals(
        withDisplayPath('Module not found "file:///C:/Users/me/proj/lib/x.ts"', windows),
        'Module not found "lib/x.ts"',
      );
      assertEquals(withDisplayPath("at c:/users/me/proj/lib/x.ts", windows), "at lib/x.ts");
      assertEquals(
        withDisplayPath("see C:/Users/me/project/x.ts", windows),
        "see C:/Users/me/project/x.ts",
      );
    });

    it("leaves a host, URL or longer path that merely contains the root", () => {
      for (
        const text of [
          "fetch https://esm.sh/apple@1.0.0 failed",
          "see /application/tools",
          "see /srv/app/tools",
          "see /app-old/tools",
        ]
      ) {
        assertEquals(withDisplayPath(text, paths), text);
      }
    });
  });

  describe("describeUnresolvableNpmImport", () => {
    it("names the package a compiled binary could not resolve", () => {
      assertEquals(
        describeUnresolvableNpmImport(
          new Error("Could not find constraint 'unpdf@1.8.1' in the list of packages"),
        ),
        "unpdf",
      );
    });

    it("names only the package, never the constraint text Deno quotes", () => {
      // A framework import bypasses classification, so its version reaches the
      // loader as written and may carry a token in a valid pre-release suffix.
      assertEquals(
        describeUnresolvableNpmImport(
          new Error("Could not find constraint 'zod@4.3.6-SECRETTOKEN' in the list of packages"),
        ),
        "zod",
      );
      assertEquals(
        describeUnresolvableNpmImport(new Error('Could not resolve "npm:@scope/pkg@1.0.0/sub"')),
        "@scope/pkg",
      );
    });

    it("names a package the local npm resolver rejected", () => {
      assertEquals(
        describeUnresolvableNpmImport(new Error("npm package 'unpdf' does not exist.")),
        "unpdf",
      );
    });

    it("ignores unrelated import failures", () => {
      assertEquals(describeUnresolvableNpmImport(new Error("boom")), null);
    });
  });

  describe("createProjectDependencyCdnPlugin", () => {
    const pins = { "@veryfront-fixture/pdf-text": "1.8.1" };

    it("hands framework packages reached from CDN source back to the runtime", async () => {
      const { httpUrl } = captureResolvers(createProjectDependencyCdnPlugin(pins, () => {}));
      const importer = "https://esm.sh/@veryfront-fixture/pdf-text@1.8.1";

      assertEquals(
        await httpUrl(resolveArgs({
          path: "https://esm.sh/zod@3.25.76/es2022/zod.mjs",
          importer,
          namespace: "http-url",
        })),
        { path: "zod", external: true },
      );
      assertEquals(
        await httpUrl(resolveArgs({
          path: "/react@19.2.4/es2022/jsx-runtime.mjs",
          importer,
          namespace: "http-url",
        })),
        { path: "react/jsx-runtime", external: true },
      );
    });

    it("leaves every other CDN import to the HTTP plugin", async () => {
      const { httpUrl } = captureResolvers(createProjectDependencyCdnPlugin(pins, () => {}));

      // An npm polyfill named after a Node builtin is still an npm package.
      assertEquals(
        await httpUrl(resolveArgs({
          path: "https://esm.sh/buffer@6.0.3/es2022/buffer.mjs",
          importer: "https://esm.sh/@veryfront-fixture/pdf-text@1.8.1",
          namespace: "http-url",
        })),
        undefined,
      );

      assertEquals(
        await httpUrl(resolveArgs({
          path: "/@veryfront-fixture/helper@1.0.0/es2022/helper.mjs",
          importer: "https://esm.sh/@veryfront-fixture/pdf-text@1.8.1",
          namespace: "http-url",
        })),
        undefined,
      );
      assertEquals(
        await httpUrl(resolveArgs({ path: "not a url", importer: "", namespace: "http-url" })),
        undefined,
      );
    });

    it("redirects a declared package to its pinned CDN source", async () => {
      const { bare } = captureResolvers(createProjectDependencyCdnPlugin(pins, () => {}));

      assertEquals(
        await bare(resolveArgs({ path: "@veryfront-fixture/pdf-text" })),
        { path: "https://esm.sh/@veryfront-fixture/pdf-text@1.8.1", namespace: "http-url" },
      );
      assertEquals(
        await bare(resolveArgs({ path: "npm:@veryfront-fixture/pdf-text@1.8.1/dist/core" })),
        {
          path: "https://esm.sh/@veryfront-fixture/pdf-text@1.8.1/dist/core",
          namespace: "http-url",
        },
      );
    });

    it("externalizes an embedded package under a constraint the binary holds", async () => {
      const [name, constraints] = Object.entries(EMBEDDED_NPM_CONSTRAINTS).find(
        ([candidate, versions]) =>
          !isFrameworkProvidedPackage(candidate) && versions.some((v) => /^\d+\.\d+\.\d+$/.test(v)),
      )!;
      const version = constraints.find((v) => /^\d+\.\d+\.\d+$/.test(v))!;
      const { bare } = captureResolvers(
        createProjectDependencyCdnPlugin({ [name]: version }, () => {}),
      );

      assertEquals(await bare(resolveArgs({ path: name })), {
        path: `npm:${name}@${version}`,
        external: true,
      });
    });

    it("reports a missing import without echoing a credential it carries", async () => {
      const missing: Array<{ specifier: string; reason: string }> = [];
      const { bare } = captureResolvers(
        createProjectDependencyCdnPlugin({}, (specifier, reason) => {
          missing.push({ specifier, reason });
        }),
      );

      const result = await bare(
        resolveArgs({ path: "npm:@veryfront-fixture/absent@https://<TOKEN>@example.invalid/x" }),
      );

      assertEquals(missing.length, 1);
      assertEquals(
        missing[0]!.specifier,
        "@veryfront-fixture/absent (with a non-registry version)",
      );
      assert(!JSON.stringify({ result, missing }).includes("<TOKEN>"), "the token must not leak");
    });

    it("defers a dynamic import the declaration contradicts instead of loading it", async () => {
      const { bare } = captureResolvers(
        createProjectDependencyCdnPlugin({ lodash: "1.0.0" }, () => {}),
      );

      const result = await bare(
        resolveArgs({ path: "npm:lodash@3.10.1", kind: "dynamic-import" }),
      );

      assert(result && typeof result === "object" && "namespace" in result);
      assert(result.external !== true, "a contradicted import must not reach the runtime");
    });

    it("leaves a URL the project imports directly to the runtime", async () => {
      const { remote } = captureResolvers(createProjectDependencyCdnPlugin(pins, () => {}));

      for (const path of ["https://deno.land/std/path/mod.ts", "https://esm.sh/zod@3.25.76"]) {
        assertEquals(await remote(resolveArgs({ path })), { path, external: true });
      }
      // A URL inside fetched CDN source stays with the HTTP plugin and the
      // framework guard: esbuild runs a namespace-less resolver everywhere.
      assertEquals(
        await remote(resolveArgs({
          path: "https://esm.sh/zod@3.25.76/es2022/zod.mjs",
          namespace: "http-url",
        })),
        undefined,
      );
    });

    it("never builds a CDN URL from a subpath that leaves its package", async () => {
      const missing: string[] = [];
      const { bare } = captureResolvers(
        createProjectDependencyCdnPlugin({ unpdf: "1.8.1" }, (specifier) => {
          missing.push(specifier);
        }),
      );

      const result = await bare(resolveArgs({ path: "unpdf/../../left-pad@1.3.0" }));

      assert(result && typeof result === "object" && "errors" in result);
      assert(!JSON.stringify(result).includes("esm.sh"), "no CDN URL may be built");
      assertEquals(missing, ["unpdf"]);
    });

    it("pins bare Node builtins and leaves framework packages to the runtime", async () => {
      const { bare } = captureResolvers(createProjectDependencyCdnPlugin(pins, () => {}));

      assertEquals(await bare(resolveArgs({ path: "crypto" })), {
        path: "node:crypto",
        external: true,
      });
      assertEquals(await bare(resolveArgs({ path: "zod" })), undefined);
      assertEquals(
        await bare(resolveArgs({ path: "@veryfront-fixture/pdf-text", namespace: "http-url" })),
        undefined,
      );
    });

    it("fails a static import nothing can serve and defers a dynamic one", async () => {
      const missing: Array<{ specifier: string; reason: string }> = [];
      const { bare, loaders } = captureResolvers(
        createProjectDependencyCdnPlugin({}, (specifier, reason) => {
          missing.push({ specifier, reason });
        }),
      );
      const reason = "this runtime does not carry @veryfront-fixture/absent and the project " +
        "declares no dependency on it";

      // Deferred: bundled as a module that throws when the import is reached,
      // never handed back to the runtime to resolve on its own terms.
      const deferred = await bare(
        resolveArgs({ path: "@veryfront-fixture/absent", kind: "dynamic-import" }),
      );
      assertEquals(missing, []);
      assert(deferred && typeof deferred === "object" && "namespace" in deferred);
      const loader = loaders.get(deferred.namespace!);
      assert(loader, "the deferred failure namespace must have a loader");
      const loaded = await loader({
        path: deferred.path!,
        namespace: deferred.namespace!,
        pluginData: deferred.pluginData,
      });
      const contents = String(loaded && "contents" in loaded ? loaded.contents : "");
      assert(contents.startsWith("throw new Error("), `got ${contents}`);
      assert(contents.includes(reason), "the thrown error must carry the classified reason");

      assertEquals(await bare(resolveArgs({ path: "@veryfront-fixture/absent" })), {
        errors: [{ text: `Cannot resolve "@veryfront-fixture/absent": ${reason}` }],
      });
      assertEquals(missing, [{ specifier: "@veryfront-fixture/absent", reason }]);
    });
  });

  describe("authorizeProjectDependencySourceUrl", () => {
    it("admits only the pinned CDN origin", () => {
      authorizeProjectDependencySourceUrl(new URL("https://esm.sh/unpdf@1.8.1"));
      assertThrows(
        () => authorizeProjectDependencySourceUrl(new URL("https://attacker.example.com/x.js")),
        TypeError,
        "blocked by allow-list",
      );
      assertThrows(
        () => authorizeProjectDependencySourceUrl(new URL("http://169.254.169.254/latest/")),
        TypeError,
        "blocked by allow-list",
      );
    });
  });

  describe("createProjectDependencySourceFetcher", () => {
    const javascript = { "content-type": "application/javascript" };

    it("serves a pinned source from the process cache after its first fetch", async () => {
      const requested: string[] = [];
      const fetchSource = createProjectDependencySourceFetcher((input) => {
        requested.push(String(input));
        return Promise.resolve(new Response("export const a = 1;", { headers: javascript }));
      });

      const first = await fetchSource("https://esm.sh/pkg-a@1.0.0");
      const second = await fetchSource(new URL("https://esm.sh/pkg-a@1.0.0"));

      assertEquals(await first.text(), "export const a = 1;");
      assertEquals(await second.text(), "export const a = 1;");
      assertEquals(second.headers.get("content-type"), "application/javascript");
      assertEquals(requested, ["https://esm.sh/pkg-a@1.0.0"]);
    });

    it("never caches a failed or HTML response", async () => {
      const responses = [
        new Response("Not Found", { status: 404 }),
        new Response("<html>build failed</html>", { headers: { "content-type": "text/html" } }),
        new Response("  <!doctype html>", { headers: javascript }),
        // No content type at all: the source is served as JavaScript.
        new Response(new TextEncoder().encode("export const ok = true;")),
      ];
      let calls = 0;
      const fetchSource = createProjectDependencySourceFetcher(() =>
        Promise.resolve(responses[calls++]!)
      );
      const url = "https://esm.sh/pkg-b@1.0.0";

      const notFound = await fetchSource(url);
      assertEquals(notFound.status, 404);
      await notFound.body?.cancel();
      assertEquals(await (await fetchSource(url)).text(), "<html>build failed</html>");
      assertEquals(await (await fetchSource(url)).text(), "  <!doctype html>");
      const recovered = await fetchSource(url);
      assertEquals(await recovered.text(), "export const ok = true;");
      assertEquals(recovered.headers.get("content-type"), "application/javascript");
      assertEquals(await (await fetchSource(url)).text(), "export const ok = true;");
      assertEquals(calls, 4);
    });

    it("passes a Request through without caching it", async () => {
      let calls = 0;
      const fetchSource = createProjectDependencySourceFetcher(() => {
        calls++;
        return Promise.resolve(new Response("export {}", { headers: javascript }));
      });
      const request = () => new Request("https://esm.sh/pkg-c@1.0.0");

      await (await fetchSource(request())).text();
      await (await fetchSource(request())).text();

      assertEquals(calls, 2);
    });

    it("keeps the cached sources within a byte budget", async () => {
      const requested: string[] = [];
      // 20 UTF-16 code units are budgeted as 40 bytes.
      const body = "x".repeat(20);
      const fetchSource = createProjectDependencySourceFetcher((input) => {
        requested.push(String(input));
        return Promise.resolve(new Response(body, { headers: javascript }));
      }, { maxBytes: 100 });
      const url = (index: number) => `https://esm.sh/budget-${index}@1.0.0`;

      for (let index = 0; index < 3; index++) await (await fetchSource(url(index))).text();
      requested.length = 0;

      // 3 x 40 bytes exceeds 100, so the first source was evicted to fit the third.
      await (await fetchSource(url(2))).text();
      await (await fetchSource(url(1))).text();
      assertEquals(requested, []);
      await (await fetchSource(url(0))).text();
      assertEquals(requested, [url(0)]);
    });

    it("accounts one body once when concurrent misses fill the same key", async () => {
      const requested: string[] = [];
      const body = "z".repeat(20); // budgeted as 40 bytes
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const fetchSource = createProjectDependencySourceFetcher(async (input) => {
        requested.push(String(input));
        await gate;
        return new Response(body, { headers: javascript });
      }, { maxBytes: 100 });
      const url = (name: string) => `https://esm.sh/${name}@1.0.0`;

      const both = Promise.all([fetchSource(url("same")), fetchSource(url("same"))]);
      release();
      for (const response of await both) await response.text();
      await (await fetchSource(url("other"))).text();
      requested.length = 0;

      // 40 + 40 fits in 100. Counting the concurrent fill twice (80 + 40) would
      // have evicted the first source to make room for the second.
      await (await fetchSource(url("same"))).text();
      assertEquals(requested, []);
    });

    it("never caches a source larger than the whole budget", async () => {
      let calls = 0;
      const fetchSource = createProjectDependencySourceFetcher(() => {
        calls++;
        return Promise.resolve(new Response("y".repeat(200), { headers: javascript }));
      }, { maxBytes: 100 });

      await (await fetchSource("https://esm.sh/huge@1.0.0")).text();
      await (await fetchSource("https://esm.sh/huge@1.0.0")).text();

      assertEquals(calls, 2);
    });

    it("evicts the oldest source once the cache is full", async () => {
      const requested: string[] = [];
      const fetchSource = createProjectDependencySourceFetcher((input) => {
        requested.push(String(input));
        return Promise.resolve(new Response("export {}", { headers: javascript }));
      });
      const url = (index: number) => `https://esm.sh/pkg-${index}@1.0.0`;

      for (let index = 0; index <= 256; index++) await (await fetchSource(url(index))).text();
      requested.length = 0;

      await (await fetchSource(url(256))).text();
      assertEquals(requested, [], "the newest source must still be cached");
      await (await fetchSource(url(0))).text();
      assertEquals(requested, [url(0)], "the oldest source must have been evicted");
    });
  });

  describe("importModule on a compiled runtime", () => {
    // esbuild resolves bare specifiers against a real directory, so these
    // fixtures live under an existing repo path the way a deployed project's
    // files do. None of them declares a pin, so no CDN fetch is ever wired up
    // and nothing can leave the process.
    const projectDir = Deno.cwd();
    const toolPath = "src/discovery/__fixtures__/compiled-runtime-tool.ts";

    function compiledContext(files: Record<string, string>): FileDiscoveryContext {
      return {
        platform: "node",
        fsAdapter: createMockAdapter(files, { projectDir }),
        baseDir: projectDir,
        compiledRuntime: true,
      };
    }

    it("treats a project without a package.json as declaring no dependencies", async () => {
      const mod = await importModule(
        `file://${projectDir}/${toolPath}`,
        compiledContext({ [toolPath]: `export default { name: "no-manifest" };` }),
      ) as { default: { name: string } };

      assertEquals(mod.default.name, "no-manifest");
    });

    it("keeps bare Node builtins external instead of failing the file", async () => {
      const mod = await importModule(
        `file://${projectDir}/${toolPath}`,
        compiledContext({
          "package.json": JSON.stringify({ dependencies: {} }),
          [toolPath]: [
            `import { createHash } from "crypto";`,
            `export default { name: "uses-builtins", ok: typeof createHash === "function" };`,
          ].join("\n"),
        }),
      ) as { default: { ok: boolean } };

      assertEquals(mod.default.ok, true);
    });

    it("classifies a static import nothing can serve without the machine path", async () => {
      const error = await assertRejects(
        () =>
          importModule(
            `file://${projectDir}/${toolPath}`,
            compiledContext({
              "package.json": JSON.stringify({ dependencies: {} }),
              [toolPath]: [
                `import { extractText } from "@veryfront-fixture/never-declared";`,
                `export default { name: "extract", text: extractText() };`,
              ].join("\n"),
            }),
          ),
        Error,
        "@veryfront-fixture/never-declared",
      );
      const message = error instanceof Error ? error.message : String(error);
      assertEquals((error as { slug?: string }).slug, "dependency-missing");
      assert(message.includes(toolPath), `the detail must name the file, got ${message}`);
      assert(!message.includes(projectDir), "the detail must not disclose the project path");
    });

    it("never serves a module built for the other runtime mode", async () => {
      const files = { [toolPath]: `export default { name: "either-mode" };` };
      const load = (compiledRuntime: boolean) =>
        importModule(`file://${projectDir}/${toolPath}`, {
          ...compiledContext(files),
          compiledRuntime,
        });

      const compiled = await load(true);
      const uncompiled = await load(false);

      assert(compiled !== uncompiled, "an uncompiled load must not reuse the compiled module");
      assertEquals(await load(true), compiled);
    });

    it("keeps the project root out of a nested bundler diagnostic", async () => {
      const error = await assertRejects(
        () =>
          importModule(
            `file://${projectDir}/${toolPath}`,
            compiledContext({
              [toolPath]: [
                `import { helper } from "./missing-helper.ts";`,
                `export default { name: "nested", helper };`,
              ].join("\n"),
            }),
          ),
        Error,
        "missing-helper.ts",
      );
      const message = error instanceof Error ? error.message : String(error);
      assertEquals((error as { slug?: string }).slug, "compilation-error");
      assert(
        message.includes('from "src/discovery/__fixtures__"'),
        `the importer directory must be project-relative, got ${message}`,
      );
      assert(!message.includes(projectDir), "the detail must not disclose the project path");
    });

    it("classifies a syntax error in project code", async () => {
      const error = await assertRejects(
        () =>
          importModule(
            `file://${projectDir}/${toolPath}`,
            compiledContext({ [toolPath]: `export default { name: "broken", ` }),
          ),
        Error,
        "Failed to transpile",
      );
      assertEquals((error as { slug?: string }).slug, "compilation-error");
    });
  });

  describe("importModule failures", () => {
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
