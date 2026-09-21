import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  authorizeProjectDependencySourceUrl,
  cdnSourceDecision,
  clearTranspileCache,
  createProjectDependencyCdnPlugin,
  createProjectDependencySourceFetcher,
  deferredDependencyDetail,
  describeUnresolvableNpmImport,
  discoveryPathForDisplay,
  discoveryPathNames,
  esmCdnModuleSpecifier,
  esmCdnPackageName,
  importModule as importModuleRaw,
  lockedVersionsByName,
  npmrcRedirectsPackage,
  npmrcRegistryFor,
  publiclySourcedPackages,
  readDependencyPins,
  readLockedDependencies,
  readProjectRegistrySources,
  withDisplayPath,
} from "./transpiler.ts";
import type { ProjectRegistrySources } from "./transpiler.ts";
import type { FileDiscoveryContext } from "./types.ts";
import { DEPENDENCY_MISSING, VeryfrontError } from "#veryfront/errors";
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

    it("resolves a dev declaration over an optional one, as npm does", () => {
      // @npmcli/arborist loads peers, then production, then optional, and the
      // root project's dev dependencies LAST, each edge replacing the one
      // before it. Reading optional last instead checked the lockfile's dev
      // version against the optional range and reported the installed
      // dependency as missing.
      assertEquals(
        readDependencyPins(JSON.stringify({
          optionalDependencies: { sharp: "^0.34.0" },
          devDependencies: { sharp: "0.35.4" },
        })),
        { sharp: "0.35.4" },
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

    it("names the base package of a peer-qualified build", () => {
      // esm.sh appends the peers it built against. Reading the LAST `@` made
      // the name `react-dom@18.3.1_react`, which this guard did not recognise
      // as the framework's -- so the bundle carried a second ReactDOM and
      // every Hook call in the inlined dependency ran against the wrong copy.
      assertEquals(
        esmCdnPackageName(
          new URL("https://esm.sh/react-dom@18.3.1_react@18.3.1/es2022/client.mjs"),
        ),
        "react-dom",
      );
      assertEquals(
        esmCdnModuleSpecifier(
          new URL("https://esm.sh/react-dom@18.3.1_react@18.3.1/es2022/client.mjs"),
        ),
        "react-dom/client",
      );
      assertEquals(
        esmCdnPackageName(new URL("https://esm.sh/@scope/pkg@1.0.0_react@18.3.1/mod.js")),
        "@scope/pkg",
      );
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
      // A native UNC path is absolute too, server and share included.
      assertEquals(
        discoveryPathForDisplay("\\\\Server\\Share\\Project\\tools\\extract.ts"),
        "extract.ts",
      );
      assertEquals(
        discoveryPathForDisplay("\\\\Server\\Share\\Project\\tools\\extract.ts", "/srv/other"),
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
      // Not the root, so it is named by its file like any foreign path.
      assertEquals(withDisplayPath("at file:///application/x.ts", paths), "at x.ts");
    });

    it("redacts a Windows UNC project root whatever its casing", () => {
      const unc = discoveryPathNames(
        "//Server/Share/Project/tools/a.ts",
        "\\\\Server\\Share\\Project",
      );
      assertEquals(unc.display, "tools/a.ts");
      assertEquals(
        withDisplayPath('Could not resolve "//server/share/project/lib/x.ts"', unc),
        'Could not resolve "lib/x.ts"',
      );
      assertEquals(
        withDisplayPath("read '\\\\Server\\Share\\Project\\lib\\x.ts'", unc),
        "read 'lib\\x.ts'",
      );
      // A UNC file URL puts the server in the authority, with no extra slash.
      assertEquals(
        withDisplayPath('Module not found "file://server/share/project/lib/x.ts"', unc),
        'Module not found "lib/x.ts"',
      );
      // A share that merely starts with the root's name is not rendered
      // relative to it: like any foreign path it is named by its file, with no
      // mangled fragment (`ing/x.ts`) from cutting the root out of the middle.
      assertEquals(withDisplayPath('at "file://server/share/projecting/x.ts"', unc), 'at "x.ts"');
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
      // A sibling directory is not the root: it is named by its file alone
      // (as any foreign absolute path is), never rendered relative to the root.
      assertEquals(withDisplayPath("see C:/Users/me/project/x.ts", windows), "see x.ts");
    });

    it("names an absolute path outside the project root by its file alone", () => {
      // esbuild can quote a path under another directory entirely; the machine
      // layout there is no more publishable than the project's own.
      assertEquals(
        withDisplayPath('Could not resolve "/home/someone/work/lib/x.ts"', paths),
        'Could not resolve "x.ts"',
      );
      assertEquals(
        withDisplayPath('at "file:///Users/me/tmp/y.ts"', paths),
        'at "y.ts"',
      );
      assertEquals(withDisplayPath("read 'C:\\Users\\me\\z.ts'", paths), "read 'z.ts'");
      assertEquals(
        withDisplayPath("at //server/share/other/w.ts", paths),
        "at w.ts",
      );
      // URLs and relative paths are untouched.
      assertEquals(
        withDisplayPath("fetch https://esm.sh/pkg@1.0.0/x.mjs", paths),
        "fetch https://esm.sh/pkg@1.0.0/x.mjs",
      );
      assertEquals(withDisplayPath("in tools/a.ts", paths), "in tools/a.ts");
    });

    it("names a foreign native UNC path by its file", () => {
      assertEquals(
        withDisplayPath(String.raw`read "\\server\share\Users\name\file.ts"`, paths),
        'read "file.ts"',
      );
      assertEquals(
        withDisplayPath(String.raw`at \\server\share\Users\name\file.ts`, paths),
        "at file.ts",
      );
    });

    it("names a foreign UNC file URL and a quoted path with an apostrophe by its file", () => {
      // A UNC file URL puts the share in the authority, and a legal file name
      // may contain the other quote character.
      assertEquals(
        withDisplayPath('at "file://server/share/private/file.ts"', paths),
        'at "file.ts"',
      );
      assertEquals(
        withDisplayPath("at file://server/share/private/file.ts", paths),
        "at file.ts",
      );
      assertEquals(
        withDisplayPath(`Could not resolve "/home/O'Brien/private/file.ts"`, paths),
        'Could not resolve "file.ts"',
      );
      assertEquals(
        withDisplayPath(`read '/home/say "hi"/file.ts'`, paths),
        "read 'file.ts'",
      );
    });

    it("names a quoted path containing an escaped delimiter by its file", () => {
      assertEquals(
        withDisplayPath(String.raw`Could not resolve "/home/O\"Brien/private/file.ts"`, paths),
        'Could not resolve "file.ts"',
      );
    });

    it("names a quoted absolute path with spaces by its file", () => {
      // A home directory can carry a person's name, and a quoted path runs to
      // its closing delimiter rather than to the first space.
      assertEquals(
        withDisplayPath('Could not resolve "/home/Other User/private/file.ts"', paths),
        'Could not resolve "file.ts"',
      );
      assertEquals(
        withDisplayPath("readTextFile 'C:\\Users\\Other User\\file.ts'", paths),
        "readTextFile 'file.ts'",
      );
      assertEquals(
        withDisplayPath('at "file:///home/Other User/x.ts"', paths),
        'at "x.ts"',
      );
    });

    it("leaves a host or URL that merely contains the root", () => {
      assertEquals(
        withDisplayPath("fetch https://esm.sh/apple@1.0.0 failed", paths),
        "fetch https://esm.sh/apple@1.0.0 failed",
      );
    });

    it("never renders a path that merely starts with the root relative to it", () => {
      // Each of these is a foreign absolute path, so it is named by its file;
      // what must never happen is the root being cut out of the middle of a
      // longer name, which would leave a mangled fragment such as `ication/`.
      for (const text of ["/application/tools/x.ts", "/srv/app/tools/x.ts", "/app-old/x.ts"]) {
        assertEquals(withDisplayPath(`see ${text}`, paths), "see x.ts", text);
      }
    });
  });

  describe("readLockedDependencies", () => {
    it("reads an npm 5 or 6 lockfile's hierarchical dependency tree", () => {
      // A `lockfileVersion: 1` file keys its entries under `dependencies`, not
      // `packages`. Reading only the latter returned an empty table, so every
      // declared dependency of such a project was refused as unresolved while
      // usable provenance sat in the file.
      const locked = readLockedDependencies(JSON.stringify({
        lockfileVersion: 1,
        dependencies: {
          unpdf: {
            version: "1.8.1",
            resolved: "https://registry.npmjs.org/unpdf/-/unpdf-1.8.1.tgz",
            requires: { ms: "^2.1.3" },
            dependencies: {
              ms: {
                version: "2.0.0",
                resolved: "https://registry.npmjs.org/ms/-/ms-2.0.0.tgz",
              },
            },
          },
        },
      }));
      assertEquals(locked["node_modules/unpdf"], {
        version: "1.8.1",
        resolved: "https://registry.npmjs.org/unpdf/-/unpdf-1.8.1.tgz",
        link: false,
        installed: null,
        dependencies: { ms: "^2.1.3" },
      });
      assertEquals(locked["node_modules/unpdf/node_modules/ms"]?.version, "2.0.0");
    });

    it("ignores anything that is not a package install", () => {
      // The root project and a workspace member's own path are declarations,
      // not installs, and an entry with no version resolves nothing.
      const locked = readLockedDependencies(JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": { name: "root", version: "1.0.0" },
          "packages/app": { version: "1.0.0" },
          "node_modules/unversioned": { resolved: "https://registry.npmjs.org/x/-/x-1.tgz" },
          "node_modules/unpdf": { version: "1.8.1" },
        },
      }));
      assertEquals(Object.keys(locked), ["node_modules/unpdf"]);

      // A lockfile is project text: in the v1 tree the package NAME becomes
      // the table's key, so `__proto__` there would replace its prototype
      // instead of adding an entry.
      const v1 = readLockedDependencies(JSON.stringify({
        lockfileVersion: 1,
        dependencies: { __proto__: { version: "9.9.9" }, unpdf: 3, ms: { version: "2.1.3" } },
      }));
      assertEquals(Object.keys(v1), ["node_modules/ms"]);
      assertEquals(Object.getPrototypeOf(v1), Object.prototype);

      // Neither format survives text that is not a lockfile.
      assertEquals(readLockedDependencies("{ not json"), {});
      assertEquals(readLockedDependencies(JSON.stringify({ lockfileVersion: 3 })), {});
    });

    it("keeps an entry npm wrote without a resolved URL", () => {
      // `omit-lockfile-registry-resolved` drops the URL deliberately; whether
      // that entry is the public package is then the .npmrc's to say.
      const locked = readLockedDependencies(JSON.stringify({
        lockfileVersion: 3,
        packages: { "node_modules/unpdf": { version: "1.8.1", integrity: "sha512-x" } },
      }));
      assertEquals(locked["node_modules/unpdf"], {
        version: "1.8.1",
        resolved: null,
        link: false,
        installed: null,
        dependencies: {},
      });
    });
  });

  describe("npmrcRedirectsPackage", () => {
    it("reads a registry setting with an inline comment, as npm does", () => {
      assertEquals(
        npmrcRedirectsPackage("registry=https://npm.internal.example/ # company mirror", "pkg"),
        true,
      );
      assertEquals(
        npmrcRedirectsPackage("@scope:registry=https://npm.internal.example/ ; mirror", "@scope/p"),
        true,
      );
      assertEquals(
        npmrcRedirectsPackage("registry=https://registry.npmjs.org/ # the public one", "pkg"),
        false,
      );
      // npm takes the last value of each key, and a scoped registry wins.
      assertEquals(
        npmrcRedirectsPackage(
          "registry=https://npm.internal.example/\n@scope:registry=https://registry.npmjs.org/",
          "@scope/p",
        ),
        false,
      );
      assertEquals(
        npmrcRedirectsPackage(
          "registry=https://npm.internal.example/\nregistry=https://registry.npmjs.org/",
          "pkg",
        ),
        false,
      );
      assertEquals(
        npmrcRedirectsPackage(
          "@scope:registry=https://registry.npmjs.org/\n@scope:registry=https://npm.internal.example/",
          "@scope/p",
        ),
        true,
      );
      // npm's INI parser strips a matching pair of quotes.
      assertEquals(
        npmrcRedirectsPackage('registry="https://registry.npmjs.org/"', "pkg"),
        false,
      );
      assertEquals(
        npmrcRedirectsPackage("registry='https://npm.internal.example/'", "pkg"),
        true,
      );
      // A comment line, and a scope that is not this package's, say nothing.
      assertEquals(npmrcRedirectsPackage("# registry=https://npm.internal.example/", "pkg"), false);
      assertEquals(
        npmrcRedirectsPackage("@other:registry=https://npm.internal.example/", "@scope/p"),
        false,
      );
    });
  });

  describe("readProjectRegistrySources", () => {
    const PROJECT = "/tmp/project";

    /** The sources a project with these files would be read as having. */
    function sourcesFor(files: Record<string, string>, baseDir = PROJECT) {
      return readProjectRegistrySources({
        platform: "node",
        fsAdapter: createMockAdapter(files, { projectDir: PROJECT }),
        baseDir,
      });
    }

    /**
     * The lockfile a project with this dependency holds. `members` are the
     * workspace paths npm writes one entry each for, which is how a root's
     * lockfile says which projects it installs.
     */
    const publicLock = (name: string, version: string, members: readonly string[] = []) =>
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          [`node_modules/${name}`]: {
            version,
            resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,
          },
          ...Object.fromEntries(
            members.map((member) => [member, { name: member, version: "1.0.0" }]),
          ),
        },
      });

    it("reads the lockfile and .npmrc beside the project", async () => {
      const sources = await sourcesFor({
        "package-lock.json": publicLock("unpdf", "1.8.1"),
        ".npmrc": "registry=https://registry.npmjs.org/\n",
      });
      assertEquals(sources.memberPath, "");
      assertEquals(sources.memberNpmrc, "");
      assertEquals(sources.unverifiableClient, null);
      assertEquals(sources.locked["node_modules/unpdf"]?.version, "1.8.1");
    });

    it("names the client whose lockfile owns the project", async () => {
      const sources = await sourcesFor({ "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" });
      assertEquals(sources.unverifiableClient, "pnpm");
      assertEquals(sources.locked, {});
    });

    it("prefers a shrinkwrap, which npm reads instead of the package lock", async () => {
      const sources = await sourcesFor({
        "package-lock.json": publicLock("unpdf", "1.8.1"),
        "npm-shrinkwrap.json": publicLock("unpdf", "2.0.0"),
      });
      assertEquals(sources.locked["node_modules/unpdf"]?.version, "2.0.0");

      // And reads one that stands alone.
      const alone = await sourcesFor({ "npm-shrinkwrap.json": publicLock("unpdf", "2.0.0") });
      assertEquals(alone.locked["node_modules/unpdf"]?.version, "2.0.0");
    });

    it("climbs to the workspace root that declares the project a member", async () => {
      const member = `${PROJECT}/packages/app`;
      const files = {
        "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
        "package-lock.json": publicLock("unpdf", "1.8.1", ["packages/app"]),
        "packages/app/package.json": "{}",
      };
      const sources = await sourcesFor(files, member);
      assertEquals(sources.memberPath, "packages/app");
      assertEquals(sources.locked["node_modules/unpdf"]?.version, "1.8.1");
    });

    it("needs the root's own lockfile to list the member", async () => {
      // npm writes one `packages` entry per member it installs, so a root
      // whose lockfile does not list this project does not speak for it --
      // whatever its workspace patterns appear to say.
      const member = `${PROJECT}/packages/app`;
      const sources = await sourcesFor({
        "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
        "package-lock.json": publicLock("unpdf", "1.8.1", ["packages/other"]),
        "packages/app/package.json": "{}",
      }, member);
      assertEquals(sources.memberPath, "");
      assertEquals(sources.locked, {});
    });

    it("stops at a project merely nested under another", async () => {
      const nested = `${PROJECT}/vendor/nested`;
      const sources = await sourcesFor({
        "package.json": JSON.stringify({ name: "outer" }),
        "package-lock.json": publicLock("unpdf", "1.8.1"),
        "vendor/nested/package.json": "{}",
      }, nested);
      assertEquals(sources.locked, {});
      assertEquals(sources.memberPath, "");
    });

    it("lets the workspace root's lockfile outrank a leftover in the member", async () => {
      // Every client keeps one lockfile at the root, so a lock beside a member
      // is a leftover from before it joined and may not decide provenance.
      const member = `${PROJECT}/packages/app`;
      const sources = await sourcesFor({
        "package.json": JSON.stringify({ workspaces: ["packages/**"] }),
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
        "packages/app/package.json": "{}",
        "packages/app/package-lock.json": publicLock("unpdf", "1.8.1"),
      }, member);
      assertEquals(sources.unverifiableClient, "pnpm");
      assertEquals(sources.locked, {});
    });

    it("keeps a member's own .npmrc apart from the one npm applies", async () => {
      const member = `${PROJECT}/packages/app`;
      const sources = await sourcesFor({
        "package.json": JSON.stringify({ workspaces: ["./packages/*/"] }),
        ".npmrc": "registry=https://npm.internal.example/\n",
        "package-lock.json": publicLock("unpdf", "1.8.1", ["packages/app"]),
        "packages/app/package.json": "{}",
        "packages/app/.npmrc": "registry=https://registry.npmjs.org/\n",
      }, member);
      assertEquals(npmrcRegistryFor(sources.npmrc, "pkg"), "https://npm.internal.example/");
      assertEquals(npmrcRegistryFor(sources.memberNpmrc, "pkg"), "https://registry.npmjs.org/");
    });

    it("matches the workspace patterns npm's own globs accept", async () => {
      const member = `${PROJECT}/apps/store-web`;
      const declaring = async (workspaces: unknown, at = member) =>
        (await sourcesFor({
          "package.json": JSON.stringify({ workspaces }),
          "package-lock.json": publicLock("unpdf", "1.8.1", [
            "apps/store-web",
            "apps/.hidden",
            ".apps/web",
            "apps/02",
            "apps/2",
            "node_modules/vendored",
          ]),
          "apps/store-web/package.json": "{}",
          "apps/.hidden/package.json": "{}",
          ".apps/web/package.json": "{}",
          "apps/02/package.json": "{}",
          "apps/2/package.json": "{}",
        }, at)).memberPath;

      // A `*` stands for part of ONE segment; `**` spans any number of them,
      // backtracking when a later segment has to line up.
      assertEquals(await declaring(["apps/*-web"]), "apps/store-web");
      assertEquals(await declaring(["**/store-web"]), "apps/store-web");
      assertEquals(await declaring(["**"]), "apps/store-web");
      assertEquals(await declaring(["apps/store-web"]), "apps/store-web");
      // A negation removes what the positive patterns matched, and a pattern
      // that is not a string, or is empty once normalized, names nothing.
      assertEquals(await declaring(["apps/*", "!apps/store-web"]), "");
      assertEquals(await declaring([42, "./", "apps/*"]), "apps/store-web");
      assertEquals(await declaring([42, "./"]), "");
      // A pattern with more segments than the member, or fewer, matches none.
      assertEquals(await declaring(["apps/*/pkg"]), "");
      assertEquals(await declaring(["apps"]), "");
      assertEquals(await declaring(["apps/store-x*"]), "");
      // minimatch's other syntax counts too: braces, classes and `?`.
      assertEquals(await declaring(["apps/{store-web,other}"]), "apps/store-web");
      assertEquals(await declaring(["{apps,libs}/{store,other}-web"]), "apps/store-web");
      assertEquals(await declaring(["apps/[sx]tore-web"]), "apps/store-web");
      assertEquals(await declaring(["apps/[!x]tore-web"]), "apps/store-web");
      assertEquals(await declaring(["apps/[x-z]tore-web"]), "");
      // POSIX classes, including negated and mixed with literal members. An
      // unnamed one is not a class at all: minimatch reads `[[:bogus:]]` as
      // the members `[:bogus` and a literal `]` after them.
      assertEquals(await declaring(["apps/[[:alpha:]]tore-web"]), "apps/store-web");
      assertEquals(await declaring(["apps/[[:digit:]]tore-web"]), "");
      assertEquals(await declaring(["apps/[![:digit:]]tore-web"]), "apps/store-web");
      assertEquals(await declaring(["apps/[[:alpha:]_]tore-web"]), "apps/store-web");
      assertEquals(await declaring(["apps/[[:bogus:]]tore-web"]), "");
      // Only a class that is NOTHING BUT the dot reaches a leading one.
      assertEquals(await declaring(["apps/[.a]hidden"], `${PROJECT}/apps/.hidden`), "");
      assertEquals(
        await declaring(["apps/[[:punct:]]hidden"], `${PROJECT}/apps/.hidden`),
        "",
      );
      assertEquals(await declaring(["apps/?tore-web"]), "apps/store-web");
      assertEquals(await declaring(["apps/??ore-web"]), "apps/store-web");
      assertEquals(await declaring(["apps/?ore-web"]), "");
      // An even number of leading `!` is a literal, not a negation.
      assertEquals(await declaring(["!!apps/store-web"]), "apps/store-web");
      // Of two ADJACENT matching negations npm's own splice loop removes only
      // the first, so the second still excludes the member. Reproducing that
      // is the point: this decides what npm considers a member.
      assertEquals(await declaring(["**", "!apps/**", "!apps/store-web", "apps/store-web"]), "");
      // npm rewrites a backslash to a separator before globbing.
      assertEquals(await declaring(["apps\\*"]), "apps/store-web");
      // A later positive pattern CANCELS an earlier negation that covers it,
      // which is how npm reads an override written after an exclusion.
      assertEquals(
        await declaring(["**", "!apps/**", "apps/store-web"]),
        "apps/store-web",
      );
      // The negation still stands when nothing written after it overrides.
      assertEquals(await declaring(["**", "!apps/**", "libs/other"]), "");
      // A trailing `**` may stand for nothing: npm appends a separator to
      // every pattern before globbing, so it matches the directory itself.
      // A trailing `*` inside a segment may match nothing left of the name.
      assertEquals(await declaring(["apps/store-web/**"]), "apps/store-web");
      assertEquals(await declaring(["apps/store-web*"]), "apps/store-web");
      // minimatch's extglobs: one alternative, zero or one, zero or more, one
      // or more, and anything that is none of them.
      assertEquals(await declaring(["apps/@(store-web|other)"]), "apps/store-web");
      assertEquals(await declaring(["apps/?(store-web)"]), "apps/store-web");
      assertEquals(await declaring(["apps/*(store-web)"]), "apps/store-web");
      assertEquals(await declaring(["apps/+(store-web)"]), "apps/store-web");
      assertEquals(await declaring(["apps/!(other)"]), "apps/store-web");
      assertEquals(await declaring(["apps/!(store-web)"]), "");
      assertEquals(await declaring(["apps/@(a|b)"]), "");
      // A mark with no group after it is the wildcard it has always been.
      assertEquals(await declaring(["apps/*"]), "apps/store-web");
      // A `!` group refuses what its alternatives plus the TAIL would match,
      // which is how minimatch reads it: `a!(pp|xx)*` excludes `app`.
      assertEquals(await declaring(["apps/s!(tore-web)*"]), "");
      assertEquals(await declaring(["apps/s!(hop)*"]), "apps/store-web");
      // Brace ranges, numeric and alphabetic.
      assertEquals(await declaring(["apps/{store-web,a}"]), "apps/store-web");
      assertEquals(await declaring(["{a..z}pps/store-web"]), "apps/store-web");
      assertEquals(await declaring(["apps{1..3}/store-web"]), "");
      // A zero-padded endpoint keeps its width on every value, and a
      // sequence expands even when it names a single one.
      assertEquals(
        await declaring(["apps/{01..03}"], `${PROJECT}/apps/02`),
        "apps/02",
      );
      assertEquals(await declaring(["apps/{01..03}"], `${PROJECT}/apps/2`), "");
      assertEquals(
        await declaring(["apps/{2..2}"], `${PROJECT}/apps/2`),
        "apps/2",
      );
      // A comma list still needs a comma: `{a}` is the literal text.
      assertEquals(await declaring(["apps/{2}"], `${PROJECT}/apps/2`), "");
      // A declaration with a pattern too large to expand is unreadable, and
      // an exclusion this could not expand may be the one covering the
      // member, so nothing in it is trusted.
      const wide = `{${Array.from({ length: 65 }, (_, index) => `x${index}`).join(",")}}`;
      // A numeric or alphabetic SEQUENCE wider than the cap is the same
      // overflow: stopping at 64 would leave an exclusion covering fewer
      // members than npm's does.
      assertEquals(await declaring(["apps/*", "!apps/{1..100}"]), "");
      assertEquals(await declaring(["apps/*"]), "apps/store-web");
      assertEquals(await declaring(["apps/*", `!apps/${wide}`]), "");
      assertEquals(await declaring([`apps/${wide}`, "apps/*"]), "");
      // `..` walks back, and a pattern that walks out of the root names none.
      assertEquals(await declaring(["libs/../apps/*"]), "apps/store-web");
      assertEquals(await declaring(["../apps/*"]), "");
      // minimatch does not let a wildcard match a leading dot, and neither
      // does this: an ancestor npm would not call a workspace owner must not
      // supply the project's provenance.
      assertEquals(await declaring(["apps/*"], `${PROJECT}/apps/.hidden`), "");
      assertEquals(await declaring(["apps/**"], `${PROJECT}/apps/.hidden`), "");
      assertEquals(await declaring(["**"], `${PROJECT}/apps/.hidden`), "");
      assertEquals(await declaring(["apps/?hidden"], `${PROJECT}/apps/.hidden`), "");
      assertEquals(await declaring(["**/web"], `${PROJECT}/.apps/web`), "");
      // Named explicitly, it is a member like any other.
      assertEquals(
        await declaring(["apps/.hidden"], `${PROJECT}/apps/.hidden`),
        "apps/.hidden",
      );
      assertEquals(await declaring(["apps/.*"], `${PROJECT}/apps/.hidden`), "apps/.hidden");
      assertEquals(
        await declaring(["apps/[.]hidden"], `${PROJECT}/apps/.hidden`),
        "apps/.hidden",
      );
      // `workspaces` that is neither a list nor `{ packages }` declares none.
      assertEquals(await declaring({ nope: ["apps/*"] }), "");
    });

    it("never reads a directory under node_modules as a workspace member", async () => {
      const vendored = `${PROJECT}/node_modules/vendored`;
      const sources = await sourcesFor({
        "package.json": JSON.stringify({ workspaces: ["**"] }),
        "package-lock.json": publicLock("unpdf", "1.8.1"),
        "node_modules/vendored/package.json": "{}",
      }, vendored);
      // The lockfile lists no member under node_modules either.
      assertEquals(sources.memberPath, "");
      assertEquals(sources.locked, {});
    });

    it("reads no evidence at all from a project that ships none", async () => {
      const sources = await sourcesFor({ "package.json": "{}" });
      assertEquals(sources.locked, {});
      assertEquals(sources.npmrc, "");
      assertEquals(sources.unverifiableClient, null);
    });

    it("searches no ancestors when the project root is the base itself", async () => {
      // A hosted run addresses its VFS with a relative base, which IS the
      // project root and has no ancestors to climb.
      const sources = await readProjectRegistrySources({
        platform: "node",
        fsAdapter: createMockAdapter({ "package-lock.json": publicLock("unpdf", "1.8.1") }),
        baseDir: "",
      });
      assertEquals(sources.memberPath, "");
      assertEquals(sources.locked["node_modules/unpdf"]?.version, "1.8.1");
    });
  });

  describe("cdnSourceDecision", () => {
    const PUBLIC = "https://registry.npmjs.org";

    /** A lockfile entry resolved from the public registry. */
    function entry(
      version: string,
      dependencies: Record<string, string> = {},
      resolved: string | null = `${PUBLIC}/pkg/-/pkg-${version}.tgz`,
    ) {
      return {
        version,
        resolved,
        link: false,
        installed: null as string | null,
        dependencies,
      };
    }

    /** The sources a project with this lockfile and .npmrc would be read as. */
    function sources(
      locked: ProjectRegistrySources["locked"],
      { npmrc = "", memberNpmrc = "", memberPath = "" } = {},
    ): ProjectRegistrySources {
      return { locked, npmrc, memberNpmrc, memberPath, unverifiableClient: null };
    }

    it("serves the version the lockfile resolved", () => {
      const decision = cdnSourceDecision(
        sources({ "node_modules/unpdf": entry("1.9.0") }),
        "^1.8.0",
        "unpdf",
        "1.8.0",
        null,
      );
      assertEquals(decision, { version: "1.9.0", dependencyPins: [] });
    });

    it("refuses what the project's own sources do not vouch for", () => {
      const cases: [string, ProjectRegistrySources, string][] = [
        [
          "another client owns the lockfile",
          { ...sources({}), unverifiableClient: "pnpm" },
          "pnpm lockfile owns its dependencies",
        ],
        [
          "the .npmrc redirects the package",
          sources({ "node_modules/unpdf": entry("1.9.0") }, {
            npmrc: "registry=https://npm.internal.example/",
          }),
          ".npmrc installs unpdf from another registry",
        ],
        [
          "a member .npmrc redirects it, which may veto but never vouch",
          sources({ "node_modules/unpdf": entry("1.9.0") }, {
            memberNpmrc: "registry=https://npm.internal.example/",
          }),
          ".npmrc installs unpdf from another registry",
        ],
        ["the lockfile does not carry it", sources({}), "does not resolve unpdf"],
        [
          "the lockfile resolves it elsewhere",
          sources({
            "node_modules/unpdf": entry("1.9.0", {}, "https://npm.internal.example/unpdf.tgz"),
          }),
          "resolves unpdf from another registry",
        ],
        [
          "the entry is a link to a workspace package",
          sources({
            "node_modules/unpdf": { ...entry("1.9.0", {}, "packages/unpdf"), link: true },
          }),
          "resolves unpdf from another registry",
        ],
        [
          "the locked version is one the declaration excludes",
          sources({ "node_modules/unpdf": entry("2.0.0") }),
          "a version of unpdf that the project",
        ],
      ];
      for (const [name, given, reason] of cases) {
        const decision = cdnSourceDecision(given, "^1.8.0", "unpdf", "1.8.0", null);
        assert("refusal" in decision, `${name}: expected a refusal`);
        assertEquals(decision.refusal.includes(reason), true, `${name}: ${decision.refusal}`);
      }
    });

    it("reads provenance from the .npmrc when the entry carries no URL", () => {
      const omitted = sources({ "node_modules/unpdf": entry("1.9.0", {}, null) }, {
        npmrc: "omit-lockfile-registry-resolved=true\nregistry=https://registry.npmjs.org/",
      });
      assertEquals(cdnSourceDecision(omitted, "^1.8.0", "unpdf", "1.8.0", null), {
        version: "1.9.0",
        dependencyPins: [],
      });

      // Without the setting the absence is not deliberate, so it vouches for
      // nothing; a registry-relative value needs the same explicit registry.
      const bare = sources({ "node_modules/unpdf": entry("1.9.0", {}, null) }, {
        npmrc: "registry=https://registry.npmjs.org/",
      });
      assert("refusal" in cdnSourceDecision(bare, "^1.8.0", "unpdf", "1.8.0", null));
      const relative = sources({
        "node_modules/unpdf": entry("1.9.0", {}, "registry.npmjs.org/unpdf/-/unpdf-1.9.0.tgz"),
      }, { npmrc: 'registry="https://registry.npmjs.org/"' });
      assertEquals(cdnSourceDecision(relative, "^1.8.0", "unpdf", "1.8.0", null), {
        version: "1.9.0",
        dependencyPins: [],
      });
    });

    it("pins the transitive graph the project locked", () => {
      const given = sources({
        "node_modules/unpdf": entry("1.9.0", { glyphs: "^2.0.0", ms: "^2.1.0" }),
        "node_modules/glyphs": entry("2.3.4", { ms: "^2.1.0" }),
        "node_modules/ms": entry("2.1.3"),
      });
      assertEquals(cdnSourceDecision(given, "^1.8.0", "unpdf", "1.8.0", null), {
        version: "1.9.0",
        dependencyPins: ["glyphs@2.3.4", "ms@2.1.3"],
      });
    });

    it("resolves each edge from the installer's own node_modules outward", () => {
      const given = sources({
        "node_modules/unpdf": entry("1.9.0", { ms: "^2.1.0" }),
        // The nested copy is the one unpdf reaches; the hoisted one is not.
        "node_modules/unpdf/node_modules/ms": entry("2.1.3"),
        "node_modules/ms": entry("1.0.0"),
      });
      assertEquals(cdnSourceDecision(given, "^1.8.0", "unpdf", "1.8.0", null), {
        version: "1.9.0",
        dependencyPins: ["ms@2.1.3"],
      });
    });

    it("refuses a dependency installed under another package's name", () => {
      // npm records the real package for an alias (`"shim": "npm:real@1"`),
      // and the CDN resolves a dependency by NAME, so a pin would send it
      // after the public `shim` rather than what the project installed.
      const locked = readLockedDependencies(JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "node_modules/unpdf": {
            version: "1.9.0",
            resolved: `${PUBLIC}/unpdf/-/unpdf-1.9.0.tgz`,
            dependencies: { shim: "npm:real@1" },
          },
          "node_modules/shim": {
            name: "real",
            version: "1.0.0",
            resolved: `${PUBLIC}/real/-/real-1.0.0.tgz`,
          },
        },
      }));
      const decision = cdnSourceDecision(sources(locked), "^1.8.0", "unpdf", "1.8.0", null);
      assert("refusal" in decision);
      assertEquals(
        decision.refusal.includes("under another package's name"),
        true,
        decision.refusal,
      );
    });

    it("refuses a name the lockfile nests at two versions", () => {
      // esm.sh resolves one version per name for a build, so a graph that
      // nests two of them cannot be pinned. Dropping the name instead left
      // the CDN free to choose, which is the same gap in a quieter form.
      const given = sources({
        "node_modules/unpdf": entry("1.9.0", { glyphs: "^2.0.0", ms: "^2.1.0" }),
        "node_modules/glyphs": entry("2.3.4", { ms: "^1.0.0" }),
        "node_modules/glyphs/node_modules/ms": entry("1.0.0"),
        "node_modules/ms": entry("2.1.3"),
      });
      const decision = cdnSourceDecision(given, "^1.8.0", "unpdf", "1.8.0", null);
      assert("refusal" in decision);
      assertEquals(
        decision.refusal.includes("two versions of ms under unpdf"),
        true,
        decision.refusal,
      );
    });

    it("ignores a peer the package itself marks optional", () => {
      // `peerDependenciesMeta` is the package's own statement that the peer
      // may be absent, so an install without it is still complete.
      const locked = readLockedDependencies(JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "node_modules/unpdf": {
            version: "1.9.0",
            resolved: `${PUBLIC}/unpdf/-/unpdf-1.9.0.tgz`,
            peerDependencies: { fsevents: "^2.3.0" },
            peerDependenciesMeta: { fsevents: { optional: true } },
          },
        },
      }));
      assertEquals(cdnSourceDecision(sources(locked), "^1.8.0", "unpdf", "1.8.0", null), {
        version: "1.9.0",
        dependencyPins: [],
      });
      // A peer the package does NOT mark optional is an edge like any other.
      const required = readLockedDependencies(JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "node_modules/unpdf": {
            version: "1.9.0",
            resolved: `${PUBLIC}/unpdf/-/unpdf-1.9.0.tgz`,
            peerDependencies: { fsevents: "^2.3.0" },
          },
        },
      }));
      assert("refusal" in cdnSourceDecision(sources(required), "^1.8.0", "unpdf", "1.8.0", null));
    });

    it("refuses an edge the lockfile does not resolve", () => {
      // An optional dependency skipped on this platform reaches here too, and
      // the answer is the same: the CDN would resolve that range itself,
      // against the public registry, so the build is not the project's own.
      const given = sources({
        "node_modules/unpdf": entry("1.9.0", { fsevents: "^2.3.0" }),
      });
      const decision = cdnSourceDecision(given, "^1.8.0", "unpdf", "1.8.0", null);
      assert("refusal" in decision);
      assertEquals(
        decision.refusal.includes("does not resolve fsevents, which unpdf depends on"),
        true,
        decision.refusal,
      );
    });

    it("refuses when a transitive dependency is resolved privately", () => {
      const given = sources({
        "node_modules/unpdf": entry("1.9.0", { glyphs: "^2.0.0" }),
        "node_modules/glyphs": entry("2.3.4", {}, "https://npm.internal.example/glyphs.tgz"),
      });
      const decision = cdnSourceDecision(given, "^1.8.0", "unpdf", "1.8.0", null);
      assert("refusal" in decision);
      assertEquals(
        decision.refusal.includes("the project resolves glyphs, which unpdf depends on"),
        true,
        decision.refusal,
      );
    });

    it("reads a member's own copy before the one hoisted to the root", () => {
      const given = sources({
        "node_modules/unpdf": entry("1.0.0"),
        "packages/app/node_modules/unpdf": entry("1.9.0"),
      }, { memberPath: "packages/app" });
      assertEquals(cdnSourceDecision(given, "^1.8.0", "unpdf", "1.8.0", null), {
        version: "1.9.0",
        dependencyPins: [],
      });

      // With no member-specific copy, the hoisted one answers.
      const hoisted = sources({ "node_modules/unpdf": entry("1.9.0") }, {
        memberPath: "packages/app",
      });
      assertEquals(cdnSourceDecision(hoisted, "^1.8.0", "unpdf", "1.8.0", null), {
        version: "1.9.0",
        dependencyPins: [],
      });
    });

    it("refuses a source that is no registry install at all", () => {
      const given = sources({
        "node_modules/unpdf": entry("1.9.0", {}, "git+ssh://git@github.test/o/unpdf.git#abc"),
      });
      const decision = cdnSourceDecision(given, "^1.8.0", "unpdf", "1.8.0", null);
      assert("refusal" in decision);
    });

    it("refuses a dependency graph too large to pin", () => {
      const dependencies: Record<string, string> = {};
      const locked: Record<string, ReturnType<typeof entry>> = {};
      for (let index = 0; index < 520; index++) {
        dependencies[`dep${index}`] = "^1.0.0";
        locked[`node_modules/dep${index}`] = entry("1.0.0");
      }
      locked["node_modules/unpdf"] = entry("1.9.0", dependencies);
      const decision = cdnSourceDecision(sources(locked), "^1.8.0", "unpdf", "1.8.0", null);
      assert("refusal" in decision);
      assertEquals(decision.refusal.includes("too many to pin"), true, decision.refusal);
    });

    it("refuses an import range the lockfile's version does not satisfy", () => {
      const given = sources({ "node_modules/unpdf": entry("1.9.0") });
      const decision = cdnSourceDecision(given, "^1.8.0", "unpdf", "1.8.0", "~1.8.0");
      assert("refusal" in decision);
    });
  });

  describe("publiclySourcedPackages and lockedVersionsByName", () => {
    const sources: ProjectRegistrySources = {
      locked: {
        "node_modules/unpdf": {
          version: "1.9.0",
          resolved: "https://registry.npmjs.org/unpdf/-/unpdf-1.9.0.tgz",
          link: false,
          installed: null,
          dependencies: {},
        },
        "node_modules/private": {
          version: "2.0.0",
          resolved: "https://npm.internal.example/private.tgz",
          link: false,
          installed: null,
          dependencies: {},
        },
      },
      npmrc: "",
      memberNpmrc: "",
      memberPath: "",
      unverifiableClient: null,
    };

    it("vouches only for the declarations the lockfile resolves publicly", () => {
      const pins = { unpdf: "^1.8.0", private: "^2.0.0", absent: "1.0.0" };
      assertEquals([...publiclySourcedPackages(sources, pins)], ["unpdf"]);
      assertEquals(lockedVersionsByName(sources, pins), { unpdf: "1.9.0", private: "2.0.0" });
    });

    it("withholds a package the .npmrc sends elsewhere", () => {
      const redirected = { ...sources, npmrc: "registry=https://npm.internal.example/" };
      assertEquals([...publiclySourcedPackages(redirected, { unpdf: "^1.8.0" })], []);
    });

    it("withholds a package whose transitive versions the binary does not carry", () => {
      // Reusing the embedded copy hands the project the FRAMEWORK's
      // transitive graph. A public override to another public version passes
      // the provenance walk and still differs, so the binary has to carry the
      // very versions the project locked.
      const embedded = { packages: { glyphs: ["2.3.4"] }, constraints: {} };
      const withTransitive: ProjectRegistrySources = {
        ...sources,
        locked: {
          "node_modules/unpdf": {
            version: "1.9.0",
            resolved: "https://registry.npmjs.org/unpdf/-/unpdf-1.9.0.tgz",
            link: false,
            installed: null,
            dependencies: { glyphs: "^2.0.0" },
          },
          "node_modules/glyphs": {
            version: "2.3.4",
            resolved: "https://registry.npmjs.org/glyphs/-/glyphs-2.3.4.tgz",
            link: false,
            installed: null,
            dependencies: {},
          },
        },
      };
      assertEquals(
        [...publiclySourcedPackages(withTransitive, { unpdf: "^1.8.0" }, embedded)],
        ["unpdf"],
      );
      // The project overrode it to another public version the binary does not
      // carry, so the two graphs are not interchangeable.
      const overridden: ProjectRegistrySources = {
        ...withTransitive,
        locked: {
          ...withTransitive.locked,
          "node_modules/glyphs": {
            ...withTransitive.locked["node_modules/glyphs"]!,
            version: "2.4.0",
          },
        },
      };
      assertEquals([...publiclySourcedPackages(overridden, { unpdf: "^1.8.0" }, embedded)], []);
      // Two frozen versions leave which one the embedded copy reaches
      // undecidable, so neither is claimed.
      assertEquals(
        [...publiclySourcedPackages(withTransitive, { unpdf: "^1.8.0" }, {
          packages: { glyphs: ["2.3.4", "2.4.0"] },
          constraints: {},
        })],
        [],
      );
    });

    it("withholds a package whose own dependencies are not vouched for", () => {
      // The embedded artifact carries the FRAMEWORK's transitive graph, so a
      // private fork anywhere underneath the package would be replaced by the
      // public copy the binary froze.
      const withPrivateTransitive: ProjectRegistrySources = {
        ...sources,
        locked: {
          "node_modules/unpdf": {
            version: "1.9.0",
            resolved: "https://registry.npmjs.org/unpdf/-/unpdf-1.9.0.tgz",
            link: false,
            installed: null,
            dependencies: { glyphs: "^2.0.0" },
          },
          "node_modules/glyphs": {
            version: "2.3.4",
            resolved: "https://npm.internal.example/glyphs.tgz",
            link: false,
            installed: null,
            dependencies: {},
          },
        },
      };
      assertEquals([...publiclySourcedPackages(withPrivateTransitive, { unpdf: "^1.8.0" })], []);
    });

    it("vouches for nothing when another client owns the lockfile", () => {
      assertEquals(
        [...publiclySourcedPackages({ ...sources, unverifiableClient: "pnpm" }, {
          unpdf: "^1.8.0",
        })],
        [],
      );
    });
  });

  describe("npmrcRegistryFor", () => {
    it("names the registry npm would install a package from", () => {
      assertEquals(npmrcRegistryFor("", "pkg"), undefined);
      assertEquals(
        npmrcRegistryFor("registry=https://registry.npmjs.org", "pkg"),
        "https://registry.npmjs.org/",
      );
      // A key written on its own is INI's `true`; a section header, and a
      // line that assigns to nothing, name no key this reads.
      assertEquals(npmrcRegistryFor("[scope]\nprefer-offline\n=orphan\n", "pkg"), undefined);
      // A backslash escapes the comment character that follows it.
      assertEquals(
        npmrcRegistryFor(String.raw`registry=https://example.test/a\#b`, "pkg"),
        String.raw`https://example.test/a\#b/`,
      );
    });
  });

  describe("deferredDependencyDetail", () => {
    it("recognises both forms the bundled module can throw", () => {
      const typed = DEPENDENCY_MISSING.create({
        detail: 'Cannot load "pkg": nothing serves it',
        context: { veryfrontDeferredDependency: true },
      });
      assertEquals(deferredDependencyDetail(typed), 'Cannot load "pkg": nothing serves it');
      assertEquals(
        deferredDependencyDetail(
          new Error('[veryfront:missing-npm-dependency] Cannot load "pkg": nothing serves it'),
        ),
        'Cannot load "pkg": nothing serves it',
      );
      // An unrelated failure, and an unrelated typed error, are not this one.
      assertEquals(deferredDependencyDetail(new Error("boom")), null);
      assertEquals(deferredDependencyDetail(DEPENDENCY_MISSING.create({ detail: "other" })), null);
      assertEquals(deferredDependencyDetail("not an error"), null);
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
      const missing: string[] = [];
      const { httpUrl } = captureResolvers(
        createProjectDependencyCdnPlugin(pins, (specifier) => missing.push(specifier)),
      );
      const importer = "https://esm.sh/@veryfront-fixture/pdf-text@1.8.1";

      // The binary records `zod` at `*` and 4.3.6, not at this version.
      // Keeping the bare specifier discarded the version the CDN source asked
      // for -- `rewriteForDeno` turns `zod` into `npm:zod`, which that
      // constraint resolves to zod 4 -- so the mismatch is reported instead.
      const mismatch = await httpUrl(resolveArgs({
        path: "https://esm.sh/zod@3.25.76/es2022/zod.mjs",
        importer,
        namespace: "http-url",
      })) as { errors?: { text: string }[] };
      assert(mismatch.errors?.[0], "a framework version mismatch must fail the build");
      assertStringIncludes(mismatch.errors[0].text, "zod@3.25.76");
      assertEquals(missing, ["zod@3.25.76"]);
      // Re-emitted under the constraint the binary records for that version,
      // subpath included; see the framework-constraint test below.
      assertEquals(
        await httpUrl(resolveArgs({
          path: "/react@19.2.4/es2022/jsx-runtime.mjs",
          importer,
          namespace: "http-url",
        })),
        { path: "npm:react@19.2.4/jsx-runtime", external: true },
      );
    });

    it("externalizes a framework CDN import under a constraint the binary holds", async () => {
      // A compiled binary resolves `npm:` by constraint. `react-dom` is
      // recorded only at exact versions, so an unversioned `npm:react-dom`
      // would not resolve there even though the package is embedded.
      const { httpUrl } = captureResolvers(createProjectDependencyCdnPlugin(pins, () => {}));
      const importer = "https://esm.sh/@veryfront-fixture/pdf-text@1.8.1";
      const recorded = (EMBEDDED_NPM_CONSTRAINTS as Record<string, readonly string[]>)["react-dom"];
      const version = recorded?.find((candidate) => /^\d+\.\d+\.\d+$/.test(candidate));
      assert(version, "the framework's own lock records react-dom at an exact version");

      assertEquals(
        await httpUrl(resolveArgs({
          path: `https://esm.sh/react-dom@${version}/es2022/client.mjs`,
          importer,
          namespace: "http-url",
        })),
        { path: `npm:react-dom@${version}/client`, external: true },
      );
      // A version the binary does not record is NOT rewritten to one it does,
      // and NOT stripped to a bare specifier either: handing the inlined
      // dependency another major of the package it asked for is the identity
      // failure this guard exists to stop, so it is reported.
      const mismatch = await httpUrl(resolveArgs({
        path: "https://esm.sh/react-dom@0.0.1/es2022/client.mjs",
        importer,
        namespace: "http-url",
      })) as { errors?: { text: string }[] };
      assert(mismatch.errors?.[0], "a framework version mismatch must fail the build");
      assertStringIncludes(mismatch.errors[0].text, "react-dom@0.0.1");
      // A CDN URL that names NO version still takes whatever the binary has.
      const bare = await httpUrl(resolveArgs({
        path: "https://esm.sh/react-dom/es2022/client.mjs",
        importer,
        namespace: "http-url",
      })) as { path: string; external: boolean };
      assertEquals(bare.external, true);
      assert(
        recorded!.includes(bare.path.slice("npm:react-dom@".length, -"/client".length)),
        `expected a recorded react-dom constraint, got ${bare.path}`,
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
      // The embedded artifact is the framework's copy, so the declaration has
      // to be vouched for by the project's lockfile before it is reused.
      const { bare } = captureResolvers(
        createProjectDependencyCdnPlugin(
          { [name]: version },
          () => {},
          undefined,
          { [name]: version },
          new Set([name]),
        ),
      );

      assertEquals(await bare(resolveArgs({ path: name })), {
        path: `npm:${name}@${version}`,
        external: true,
      });

      // Without that evidence it is not reused.
      const { bare: unvouched } = captureResolvers(
        createProjectDependencyCdnPlugin({ [name]: version }, () => {}),
      );
      const decision = await unvouched(resolveArgs({ path: name }));
      assertEquals((decision as { external?: boolean }).external, undefined);
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
      assertEquals(missing, ["unpdf/..."]);
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
      assert(contents.includes(reason), "the thrown error must carry the classified reason");
      // Reached at call time, the bundled module fails with the repository's
      // typed error rather than a bare Error carrying an internal marker, so a
      // handler awaiting the lazy import can match it like any other.
      const thrown = assertThrows(() => {
        new Function(contents)();
      });
      assert(
        thrown instanceof VeryfrontError && thrown.slug === "dependency-missing",
        `got ${thrown}`,
      );
      assert(String((thrown as Error).message).includes(reason));

      // A lazy `require()`, and a `require.resolve()` probe, are deferred the
      // same way.
      for (const kind of ["require-call", "require-resolve"] as const) {
        const required = await bare(
          resolveArgs({ path: "@veryfront-fixture/absent", kind }),
        );
        assertEquals(missing, [], kind);
        assert(required && typeof required === "object" && "namespace" in required, kind);
        assertEquals(required.namespace, deferred.namespace, kind);
      }

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
