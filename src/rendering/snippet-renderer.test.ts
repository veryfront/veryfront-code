import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { MemoryCacheBackend } from "#veryfront/cache/backend.ts";
import {
  clearSnippetCache,
  clearSnippetCacheForProject,
  computeSnippetHash,
  getCompiledSnippet,
  getCompiledSnippetAsync,
  getSnippetCacheKey,
  setSnippetCacheBackendFactoryForTesting,
} from "./snippet-renderer.ts";

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
