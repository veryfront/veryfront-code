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
  // throughout the codebase, embedding is only referenced in transpiler.ts.
  // If this import breaks, the compiled binary will fail to load upload handlers.

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
