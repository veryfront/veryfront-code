import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { MemoryCacheBackend } from "#veryfront/cache/backend.ts";
import {
  buildSnippetModuleUrl,
  clearSnippetCache,
  clearSnippetCacheForProject,
  computeSnippetHash,
  getCompiledSnippet,
  getCompiledSnippetAsync,
  getSnippetCacheKey,
  renderSnippet,
  setSnippetCacheBackendFactoryForTesting,
} from "./snippet-renderer.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { computeHash } from "#veryfront/utils";
import { clearReactVersionCache } from "#veryfront/transforms/esm/package-registry.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "#veryfront/release-assets/constants.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    deleteEnv(name);
  } else {
    setEnv(name, value);
  }
}

describe("rendering/snippet-renderer", () => {
  let backend: MemoryCacheBackend;

  beforeEach(async () => {
    backend = new MemoryCacheBackend(100);
    setSnippetCacheBackendFactoryForTesting(() => Promise.resolve(backend));
    await clearSnippetCache();
  });

  afterEach(() => {
    setSnippetCacheBackendFactoryForTesting();
  });

  describe("cache identity", () => {
    const baseOptions = {
      mode: "production" as const,
      projectDir: "/projects/a",
      projectSlug: "project-a",
      filePath: "components/card.snippet.mdx",
      moduleServerUrl: "https://project-a.example",
    };

    it("uses a full SHA-256 digest", async () => {
      const hash = await computeSnippetHash("# Hello", baseOptions);
      assertEquals(/^[a-f0-9]{64}$/.test(hash), true);
    });

    it("isolates mode, project, file, provider, and config", async () => {
      const baseline = await computeSnippetHash("# Hello", baseOptions);
      const variants = await Promise.all([
        computeSnippetHash("# Hello", { ...baseOptions, mode: "development" }),
        computeSnippetHash("# Hello", { ...baseOptions, projectDir: "/projects/b" }),
        computeSnippetHash("# Hello", { ...baseOptions, projectSlug: "project-b" }),
        computeSnippetHash("# Hello", { ...baseOptions, filePath: "components/other.mdx" }),
        computeSnippetHash("# Hello", { ...baseOptions, compilerIdentity: "custom-mdx@2" }),
        computeSnippetHash("# Hello", {
          ...baseOptions,
          config: { dev: { hmr: false } },
        }),
      ]);

      assertEquals(variants.every((variant) => variant !== baseline), true);
    });

    it("canonicalizes config object key order", async () => {
      const left = await computeSnippetHash("# Hello", {
        ...baseOptions,
        config: { dev: { hmr: true, port: 3000 } },
      });
      const right = await computeSnippetHash("# Hello", {
        ...baseOptions,
        config: { dev: { port: 3000, hmr: true } },
      });
      assertEquals(left, right);
    });
  });

  describe("buildSnippetModuleUrl", () => {
    it("binds SSR snippet imports to the captured dependency snapshot", () => {
      assertEquals(
        buildSnippetModuleUrl(
          "https://modules.example",
          "snippet-hash",
          123,
          "on:snapshot-a",
        ),
        "https://modules.example/_vf_modules/_snippets/snippet-hash.js?ssr=true&v=123&pins=on%3Asnapshot-a",
      );
    });

    it("preserves the flag-off URL shape", () => {
      assertEquals(
        buildSnippetModuleUrl(
          "https://modules.example",
          "snippet-hash",
          123,
          "off",
        ),
        "https://modules.example/_vf_modules/_snippets/snippet-hash.js?ssr=true&v=123",
      );
    });
  });

  describe("renderSnippet", () => {
    it("fails before caching when dependency metadata is malformed", async () => {
      const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
      const projectDir = "/malformed-snippet-project";
      const projectSlug = "malformed-snippet";
      const mdxContent = "# This must not be cached";
      const hash = (await computeHash(mdxContent + projectSlug)).slice(0, 16);
      const adapter = createMockAdapter();
      const stat = adapter.fs.stat.bind(adapter.fs);
      adapter.fs.stat = async (path) => ({
        ...await stat(path),
        mtime: new Date(1),
      });
      adapter.fs.files.set(`${projectDir}/package.json`, "{not valid json");

      try {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
        clearReactVersionCache();

        await assertRejects(
          () =>
            renderSnippet(mdxContent, {
              mode: "production",
              projectDir,
              projectSlug,
              projectId: "project-a",
              adapter,
              isLocalProject: false,
            }),
          Error,
          "Dependency pinning snapshot is unavailable: on:unknown",
        );
        assertEquals(getCompiledSnippet(hash), undefined);
      } finally {
        restoreEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
        clearReactVersionCache();
      }
    });
  });

  describe("getCompiledSnippet", () => {
    it("returns undefined for a non-existent scoped hash", () => {
      assertEquals(getCompiledSnippet("nonexistent-hash", "project-a"), undefined);
    });

    it("fails closed when project scope is absent", () => {
      assertEquals(getCompiledSnippet("nonexistent-hash"), undefined);
    });

    it("rejects and removes malformed distributed executable payloads", async () => {
      const hash = "a".repeat(64);
      const key = getSnippetCacheKey("project-a", hash);
      await backend.set(key, JSON.stringify({ code: "malicious()" }), 60);

      assertEquals(await getCompiledSnippetAsync(hash, "project-a"), undefined);
      assertEquals(await backend.get(key), null);
    });
  });

  describe("clearSnippetCache", () => {
    it("clears the authoritative cache and is idempotent", async () => {
      await backend.set(getSnippetCacheKey("project-a", "a".repeat(64)), "payload", 60);
      await clearSnippetCache();
      await clearSnippetCache();
      assertEquals(backend.size, 0);
    });
  });

  describe("clearSnippetCacheForProject", () => {
    it("clears an exact project on a cold pod without local residency", async () => {
      const projectAKey = getSnippetCacheKey("project-a", "a".repeat(64));
      const projectBKey = getSnippetCacheKey("project-b", "b".repeat(64));
      await backend.set(projectAKey, "payload-a", 60);
      await backend.set(projectBKey, "payload-b", 60);

      await clearSnippetCacheForProject("project-a");

      assertEquals(await backend.get(projectAKey), null);
      assertEquals(await backend.get(projectBKey), "payload-b");
    });

    it("propagates authoritative invalidation failures", async () => {
      class FailingBackend extends MemoryCacheBackend {
        override delByPattern(_pattern: string): Promise<number> {
          return Promise.reject(new Error("backend unavailable"));
        }
      }
      setSnippetCacheBackendFactoryForTesting(() => Promise.resolve(new FailingBackend(10)));

      await assertRejects(
        () => clearSnippetCacheForProject("project-a"),
        Error,
        "backend unavailable",
      );
    });

    it("rejects an empty project selector", async () => {
      await assertRejects(
        () => clearSnippetCacheForProject("   "),
        TypeError,
        "projectSlug must be non-empty",
      );
    });
  });

  it("retries distributed cache initialization after a transient failure", async () => {
    let attempts = 0;
    setSnippetCacheBackendFactoryForTesting(() => {
      attempts++;
      return attempts === 1
        ? Promise.reject(new Error("temporary init failure"))
        : Promise.resolve(backend);
    });

    const hash = "c".repeat(64);
    assertEquals(await getCompiledSnippetAsync(hash, "project-a"), undefined);
    assertEquals(await getCompiledSnippetAsync(hash, "project-a"), undefined);
    assertEquals(attempts, 2);
  });
});
