import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { clearTranspileCache, importModule } from "./transpiler.ts";
import type { FileDiscoveryContext } from "./types.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import { reset, tryResolve } from "#veryfront/extensions/contracts.ts";
import * as embeddingMod from "#veryfront/embedding/index.ts";
import * as knowledgeMod from "#veryfront/knowledge";
import * as pathHelper from "#veryfront/compat/path";

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
  });

  afterAll(async () => {
    await stopEsbuild();
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

    it("rejects oversized dependencies before reading their contents", async () => {
      const entryPath = "/project/agents/assistant.ts";
      const dependencyPath = "/project/agents/oversized.ts";
      const adapter = createMockAdapter({
        [entryPath]: 'import { value } from "./oversized.ts"; export default { value };',
        [dependencyPath]: "x".repeat(2 * 1_024 * 1_024 + 1),
      });
      const originalReadFile = adapter.readFile.bind(adapter);
      let dependencyReads = 0;
      adapter.readFile = (path: string) => {
        if (path === dependencyPath) dependencyReads++;
        return originalReadFile(path);
      };

      await assertRejects(
        () =>
          importModule(`file://${entryPath}`, {
            platform: "node",
            fsAdapter: adapter,
            baseDir: "/project",
          }),
        Error,
        "Discovery module compilation failed",
      );
      assertEquals(dependencyReads, 0);
    });

    it("rejects bundled dependencies outside the project root", async () => {
      const files: Record<string, string> = {
        "/project/agents/assistant.ts": [
          'import { secret } from "../../outside/secret.ts";',
          "export default { secret };",
        ].join("\n"),
        "/outside/secret.ts": 'export const secret = "private";',
      };
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: createMockAdapter(files),
        baseDir: "/project",
      };

      await assertRejects(
        () => importModule("file:///project/agents/assistant.ts", context),
        Error,
        "Discovery module compilation failed",
      );
    });

    it("rejects dependency escapes before probing the adapter", async () => {
      const files: Record<string, string> = {
        "/project/agents/assistant.ts": [
          'import { secret } from "../../outside/secret.ts";',
          "export default { secret };",
        ].join("\n"),
        "/outside/secret.ts": 'export const secret = "private";',
      };
      const adapter = createMockAdapter(files);
      const originalExists = adapter.exists.bind(adapter);
      const probedPaths: string[] = [];
      adapter.exists = (path: string) => {
        probedPaths.push(path);
        return originalExists(path);
      };
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: adapter,
        baseDir: "/project",
      };

      await assertRejects(
        () => importModule("file:///project/agents/assistant.ts", context),
        Error,
        "Discovery module compilation failed",
      );
      assertEquals(probedPaths.some((path) => path.startsWith("/outside/")), false);
    });

    it("rejects absolute host imports from adapter-backed modules", async () => {
      const hostDir = await Deno.makeTempDir();
      try {
        const hostFile = `${hostDir}/secret.ts`;
        await Deno.writeTextFile(hostFile, 'export const secret = "private";');
        const files: Record<string, string> = {
          "/project/agents/assistant.ts": [
            `import { secret } from ${JSON.stringify(hostFile)};`,
            "export default { secret };",
          ].join("\n"),
        };
        const context: FileDiscoveryContext = {
          platform: "node",
          fsAdapter: createMockAdapter(files),
          baseDir: "/project",
        };

        await assertRejects(
          () => importModule("file:///project/agents/assistant.ts", context),
          Error,
          "Discovery module compilation failed",
        );
      } finally {
        await Deno.remove(hostDir, { recursive: true });
      }
    });

    it("rejects local filesystem dependencies outside the project root", async () => {
      const root = await Deno.makeTempDir();
      const projectDir = `${root}/project`;
      try {
        await Deno.mkdir(`${projectDir}/agents`, { recursive: true });
        await Deno.mkdir(`${root}/outside`, { recursive: true });
        await Deno.writeTextFile(
          `${projectDir}/agents/assistant.ts`,
          [
            'import { secret } from "../../outside/secret.ts";',
            "export default { secret };",
          ].join("\n"),
        );
        await Deno.writeTextFile(`${root}/outside/secret.ts`, 'export const secret = "private";');

        await assertRejects(
          () =>
            importModule(pathHelper.toFileUrl(`${projectDir}/agents/assistant.ts`).href, {
              platform: "deno",
              baseDir: projectDir,
            }),
          Error,
          "Discovery module compilation failed",
        );
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });

    it("invalidates a local module when a bundled dependency changes", async () => {
      const root = await Deno.makeTempDir();
      try {
        await Deno.mkdir(`${root}/agents`, { recursive: true });
        const entry = `${root}/agents/assistant.ts`;
        const dependency = `${root}/agents/config.ts`;
        await Deno.writeTextFile(
          entry,
          'import { value } from "./config.ts"; export default { value };',
        );
        await Deno.writeTextFile(dependency, "export const value = 1;");
        const context: FileDiscoveryContext = { platform: "deno", baseDir: root };

        const first = await importModule(pathHelper.toFileUrl(entry).href, context) as {
          default: { value: number };
        };
        await Deno.writeTextFile(dependency, "export const value = 2;");
        const second = await importModule(pathHelper.toFileUrl(entry).href, context) as {
          default: { value: number };
        };

        assertEquals(first.default.value, 1);
        assertEquals(second.default.value, 2);
      } finally {
        await Deno.remove(root, { recursive: true });
      }
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

    it("rejects hosted virtual imports that traverse above the project root", async () => {
      const escapedPath = pathHelper.resolve(Deno.cwd(), "tools", "../../outside/secret.ts");
      const files: Record<string, string> = {
        "tools/escape.ts": [
          'import { secret } from "../../outside/secret.ts";',
          "export default { secret };",
        ].join("\n"),
        [escapedPath]: 'export const secret = "private";',
      };
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: createMockAdapter(files, { projectDir: Deno.cwd() }),
        baseDir: "",
      };

      await assertRejects(
        () => importModule("file://tools/escape.ts", context),
        Error,
        "Discovery module compilation failed",
      );
    });

    it("should not serve a stale cached module when content changes at the same path", async () => {
      // The shared hosted runtime serves many projects and releases from one
      // process; the same relative path recurs across them. A path-only cache
      // key kept serving the previous release's module after a deploy.
      const path = "/project/agents/assistant.ts";
      const files = { [path]: `export default { version: "release-1" };` };
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

    it("does not reuse initialized modules across hosted project contexts", async () => {
      const globalRecord = globalThis as typeof globalThis & { __discoveryTenant?: string };
      const path = "tools/tenant.ts";
      const source = "export default { tenant: globalThis.__discoveryTenant };";
      const adapter = createMockAdapter({ [path]: source });

      try {
        globalRecord.__discoveryTenant = "tenant-a";
        const first = await importModule(`file://${path}`, {
          platform: "node",
          fsAdapter: adapter,
          baseDir: "",
        }) as { default: { tenant: string } };

        globalRecord.__discoveryTenant = "tenant-b";
        const second = await importModule(`file://${path}`, {
          platform: "node",
          fsAdapter: adapter,
          baseDir: "",
        }) as { default: { tenant: string } };

        assertEquals(first.default.tenant, "tenant-a");
        assertEquals(second.default.tenant, "tenant-b");
      } finally {
        delete globalRecord.__discoveryTenant;
      }
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
      const files = {
        [entryPath]: entrySource,
        "/project/agents/config.ts": `export const CONFIG = { model: "gpt-4" };`,
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

      files["/project/agents/config.ts"] = `export const CONFIG = { model: "gpt-5.5" };`;
      const second = await importModule(
        `file://${entryPath}`,
        context,
      ) as { default: { model: string } };
      assertEquals(second.default.model, "gpt-5.5");

      // Both dependency versions stay cached: reverting to the original
      // dependency contents serves the originally built module object.
      files["/project/agents/config.ts"] = `export const CONFIG = { model: "gpt-4" };`;
      const third = await importModule(
        `file://${entryPath}`,
        context,
      );
      assertEquals(third === first, true);
    });

    it("should throw when file is not found via fsAdapter", async () => {
      const adapter = createMockAdapter({});
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: adapter,
        baseDir: "/project",
      };

      const error = await assertRejects(
        () => importModule("file:///project/agents/missing.ts", context),
        Error,
        "Failed to read file",
      );
      assertEquals(error.message.includes("/project/agents/missing.ts"), false);
      assertEquals(error.message.includes("File not found"), false);
    });

    it("rejects oversized discovery source before compilation", async () => {
      const path = "/project/tools/oversized.ts";
      let readCount = 0;
      const adapter = createMockAdapter({
        [path]: "x".repeat(2 * 1_024 * 1_024 + 1),
      });
      const originalReadFile = adapter.readFile.bind(adapter);
      adapter.readFile = (filePath: string) => {
        readCount++;
        return originalReadFile(filePath);
      };
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: adapter,
        baseDir: "/project",
      };

      const error = await assertRejects(
        () => importModule(`file://${path}`, context),
        Error,
        "source exceeds the size limit",
      );
      assertEquals(error.message.includes(path), false);
      assertEquals(readCount, 0);
    });
  });
});
