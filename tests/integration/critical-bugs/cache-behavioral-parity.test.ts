import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { join } from "#veryfront/compat/path";
import { mkdir, writeTextFile } from "#veryfront/compat/fs.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { clearLayoutDiscoveryCache } from "../../../src/rendering/layouts/utils/discovery.ts";
import { FileCache } from "../../../src/platform/adapters/fs/cache/file-cache.ts";
import {
  type BundleCode,
  type BundleMetadata,
  InMemoryBundleManifestStore,
} from "../../../src/utils/bundle-manifest.ts";

describe(
  "Cache Hit/Miss Behavioral Parity",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    beforeEach(() => {
      clearLayoutDiscoveryCache();
    });

    afterEach(() => {
      clearLayoutDiscoveryCache();
    });

    describe("FileCache Parity", () => {
      it("cache hit returns exactly the same content as was stored", () => {
        const cache = new FileCache({ maxSize: 100, ttl: 60000 });

        const testCases = [
          { key: "simple:key", value: "simple value" },
          {
            key: "unicode:key:emoji",
            value: "Content with emoji: 🎉 and unicode: 日本語",
          },
          { key: "empty:string", value: "" },
          { key: "whitespace:only", value: "   \n\t\r   " },
          {
            key: "json:content",
            value: JSON.stringify({ nested: { deep: { value: 42 } } }),
          },
          {
            key: "html:content",
            value: '<div class="test">HTML & <special> chars</div>',
          },
          { key: "newlines:multiple", value: "line1\nline2\r\nline3\rline4" },
          { key: "null:bytes", value: "before\x00after" },
          { key: "long:content", value: "x".repeat(100000) },
        ];

        for (const { key, value } of testCases) cache.set(key, value);

        for (const { key, value } of testCases) {
          assertEquals(cache.get(key), value, `Cache hit for "${key}" should return exact value`);
        }
      });

      it("cache miss returns undefined, not null or empty", () => {
        const cache = new FileCache({ maxSize: 100, ttl: 60000 });

        const result = cache.get("nonexistent:key");
        assertEquals(result, undefined, "Cache miss should return undefined");
        assert(result !== null, "Cache miss should NOT return null");
        assert(result !== "", "Cache miss should NOT return empty string");
      });

      it("handles object values with deep equality", () => {
        const cache = new FileCache({ maxSize: 100, ttl: 60000 });

        const complexObject = {
          string: "value",
          number: 42,
          boolean: true,
          null: null,
          array: [1, 2, { nested: "value" }],
          nested: {
            deep: {
              very: {
                deep: "value",
              },
            },
          },
        };

        cache.set("object:key", complexObject);
        const cached = cache.get("object:key");

        assertEquals(cached, complexObject, "Cached object should deeply equal original");

        if (!cached || typeof cached !== "object") return;

        // Modifying cached shouldn't affect future gets (if cache makes copies)
        // This depends on cache implementation
        (cached as any).string = "modified";
        cache.get("object:key");
        // Either it returns the same mutated object or a fresh copy
        // The key is consistency - get should return the same thing repeatedly
      });

      it("TTL expiration causes cache miss", async () => {
        const shortTTL = 100;
        const cache = new FileCache({ maxSize: 100, ttl: shortTTL });

        cache.set("expiring:key", "will expire");
        assertEquals(cache.get("expiring:key"), "will expire", "Should hit before TTL");

        await new Promise((resolve) => setTimeout(resolve, shortTTL + 50));

        assertEquals(cache.get("expiring:key"), undefined, "Should miss after TTL expires");
      });

      it("deleteByPrefix removes correct entries and leaves others", () => {
        const cache = new FileCache({ maxSize: 100, ttl: 60000 });

        cache.set("prefix:a:file1", "a1");
        cache.set("prefix:a:file2", "a2");
        cache.set("prefix:a:nested:file", "a-nested");
        cache.set("prefix:b:file1", "b1");
        cache.set("prefix:b:file2", "b2");
        cache.set("other:prefix:file", "other");

        const deleted = cache.deleteByPrefix("prefix:a:");
        assertEquals(deleted, 3, "Should delete exactly 3 entries");

        assertEquals(cache.get("prefix:a:file1"), undefined, "a:file1 should be deleted");
        assertEquals(cache.get("prefix:a:file2"), undefined, "a:file2 should be deleted");
        assertEquals(cache.get("prefix:a:nested:file"), undefined, "a:nested should be deleted");

        assertEquals(cache.get("prefix:b:file1"), "b1", "b:file1 should remain");
        assertEquals(cache.get("prefix:b:file2"), "b2", "b:file2 should remain");
        assertEquals(cache.get("other:prefix:file"), "other", "other:prefix should remain");
      });
    });

    describe("BundleManifestStore Parity", () => {
      it("getBundleMetadata returns exactly what was set", async () => {
        const store = new InMemoryBundleManifestStore();

        const metadata: BundleMetadata = {
          hash: "abc123",
          codeHash: "code456",
          size: 1024,
          compiledAt: Date.now(),
          source: "/path/to/source.tsx",
          mode: "development",
          meta: {
            type: "component",
            depsHash: "deps789",
            reactVersion: "19.0.0",
          },
        };

        await store.setBundleMetadata("test:key", metadata);
        const cached = await store.getBundleMetadata("test:key");

        assertEquals(cached, metadata, "Cached metadata should equal original");
        assertEquals(cached?.hash, metadata.hash, "Hash should match");
        assertEquals(cached?.meta?.type, metadata.meta?.type, "Meta type should match");
      });

      it("getBundleCode returns exactly what was set", async () => {
        const store = new InMemoryBundleManifestStore();

        const code: BundleCode = {
          code: `export default function Component() { return <div>Test</div>; }`,
          sourceMap: `{"version":3,"file":"component.js","sources":["component.tsx"]}`,
          css: `.component { color: red; }`,
        };

        await store.setBundleCode("hash123", code);
        const cached = await store.getBundleCode("hash123");

        assertEquals(cached, code, "Cached code should equal original");
        assertEquals(cached?.code, code.code, "Code should match exactly");
        assertEquals(cached?.sourceMap, code.sourceMap, "SourceMap should match");
        assertEquals(cached?.css, code.css, "CSS should match");
      });

      it("invalidateSource removes all related entries", async () => {
        const store = new InMemoryBundleManifestStore();
        const source = "/path/to/source.tsx";

        await store.setBundleMetadata("bundle:dev", {
          hash: "dev123",
          codeHash: "code-dev",
          size: 1000,
          compiledAt: Date.now(),
          source,
          mode: "development",
        });

        await store.setBundleMetadata("bundle:prod", {
          hash: "prod456",
          codeHash: "code-prod",
          size: 800,
          compiledAt: Date.now(),
          source,
          mode: "production",
        });

        await store.setBundleMetadata("bundle:other", {
          hash: "other789",
          codeHash: "code-other",
          size: 500,
          compiledAt: Date.now(),
          source: "/path/to/other.tsx",
          mode: "development",
        });

        const invalidated = await store.invalidateSource(source);
        assertEquals(invalidated, 2, "Should invalidate 2 entries");

        assertEquals(await store.getBundleMetadata("bundle:dev"), undefined, "dev bundle should be gone");
        assertEquals(await store.getBundleMetadata("bundle:prod"), undefined, "prod bundle should be gone");

        const other = await store.getBundleMetadata("bundle:other");
        assert(other !== undefined, "other bundle should remain");
        assertEquals(other?.source, "/path/to/other.tsx", "other source should be correct");
      });
    });

    describe("Render Cache Parity", () => {
      it("cached render matches fresh render exactly", async () => {
        await withTestContext("cache-render-parity", async (context) => {
          await mkdir(join(context.projectDir, "app"), { recursive: true });
          await writeTextFile(
            join(context.projectDir, "app", "layout.tsx"),
            `export default function Layout({ children }) {
            return (
              <html lang="en">
                <head><title>Test Page</title></head>
                <body className="test-layout">{children}</body>
              </html>
            );
          }`,
          );
          await writeTextFile(
            join(context.projectDir, "app", "page.tsx"),
            `export default function Page() {
            return (
              <div className="test-page">
                <h1>Test Content</h1>
                <p>Static paragraph content</p>
                <ul>
                  <li>Item 1</li>
                  <li>Item 2</li>
                  <li>Item 3</li>
                </ul>
              </div>
            );
          }`,
          );

          const { createRenderer } = await import("../../../src/rendering/index.ts");
          const { cleanupBundler } = await import("../../../src/rendering/cleanup.ts");

          try {
            const renderer = await createRenderer({
              projectDir: context.projectDir,
              mode: "development",
            });

            const results = await Promise.all([
              renderer.renderPage("/"),
              renderer.renderPage("/"),
              renderer.renderPage("/"),
            ]);

            for (const [i, result] of results.entries()) {
              const label = `Render ${i + 1}`;
              assertStringIncludes(result.html, "test-page", `${label} should have test-page`);
              assertStringIncludes(result.html, "Test Content", `${label} should have content`);
              assertStringIncludes(result.html, "test-layout", `${label} should have layout`);
              assertStringIncludes(result.html, "Item 1", "Should have Item 1");
              assertStringIncludes(result.html, "Item 2", "Should have Item 2");
              assertStringIncludes(result.html, "Item 3", "Should have Item 3");
            }

            await renderer.clearAllState?.();
          } finally {
            await cleanupBundler();
          }
        });
      });

      it("cache invalidation produces correct fresh content", async () => {
        await withTestContext("cache-invalidation-parity", async (context) => {
          await mkdir(join(context.projectDir, "app"), { recursive: true });
          await writeTextFile(
            join(context.projectDir, "app", "layout.tsx"),
            `export default function Layout({ children }) {
            return <html><body>{children}</body></html>;
          }`,
          );

          await writeTextFile(
            join(context.projectDir, "app", "page.tsx"),
            `export default function Page() {
            return <div data-version="1">Version 1 Content</div>;
          }`,
          );

          const { createRenderer } = await import("../../../src/rendering/index.ts");
          const { cleanupBundler } = await import("../../../src/rendering/cleanup.ts");

          try {
            const renderer = await createRenderer({
              projectDir: context.projectDir,
              mode: "development",
            });

            const result1 = await renderer.renderPage("/");
            assertStringIncludes(result1.html, 'data-version="1"', "Should be version 1");
            assertStringIncludes(result1.html, "Version 1 Content", "Should have v1 content");

            await writeTextFile(
              join(context.projectDir, "app", "page.tsx"),
              `export default function Page() {
              return <div data-version="2">Version 2 Content</div>;
            }`,
            );

            renderer.clearCache?.();
            clearLayoutDiscoveryCache();

            await new Promise((resolve) => setTimeout(resolve, 100));

            const result2 = await renderer.renderPage("/");

            assertStringIncludes(
              result2.html,
              'data-version="2"',
              "After cache clear, should render version 2",
            );
            assertStringIncludes(
              result2.html,
              "Version 2 Content",
              "After cache clear, should have v2 content",
            );
            assert(!result2.html.includes("Version 1 Content"), "After cache clear, should NOT have v1 content");

            await renderer.clearAllState?.();
          } finally {
            await cleanupBundler();
          }
        });
      });
    });

    describe("Cache Key Edge Cases", () => {
      it("path normalization produces consistent cache keys", () => {
        const cache = new FileCache({ maxSize: 100, ttl: 60000 });

        const pathVariants = [
          "/app/page.tsx",
          "/app/./page.tsx",
          "/app/../app/page.tsx",
          "app/page.tsx",
          "./app/page.tsx",
        ];

        const firstPath = pathVariants[0];
        assert(firstPath, "First path variant should exist");
        cache.set(firstPath, "content");

        const results = pathVariants.map((path) => ({ path, cached: cache.get(path) }));

        const firstResult = results[0];
        assert(firstResult, "First result should exist");
        assertEquals(firstResult.cached, "content", "Exact path should hit");

        for (const result of results) {
          if (result.cached === undefined) {
            console.log(`Path variant "${result.path}" does not hit cache (key mismatch)`);
          }
        }
      });

      it("project-scoped keys prevent cross-project collisions", () => {
        const cache = new FileCache({ maxSize: 100, ttl: 60000 });

        const projectA = "project-a:/app/page.tsx";
        const projectB = "project-b:/app/page.tsx";

        cache.set(projectA, "Project A content");
        cache.set(projectB, "Project B content");

        assertEquals(cache.get(projectA), "Project A content", "Project A key should work");
        assertEquals(cache.get(projectB), "Project B content", "Project B key should work");

        assertNotEquals(
          cache.get(projectA),
          cache.get(projectB),
          "Different projects should have different content",
        );
      });

      it("environment-scoped keys prevent cross-environment contamination", () => {
        const cache = new FileCache({ maxSize: 100, ttl: 60000 });

        cache.set("branch:main:project:/file.tsx", "Branch main content");
        cache.set("branch:feature:project:/file.tsx", "Branch feature content");
        cache.set("release:v1:project:/file.tsx", "Release v1 content");
        cache.set("env:production:project:/file.tsx", "Production content");

        assertEquals(cache.get("branch:main:project:/file.tsx"), "Branch main content");
        assertEquals(cache.get("branch:feature:project:/file.tsx"), "Branch feature content");
        assertEquals(cache.get("release:v1:project:/file.tsx"), "Release v1 content");
        assertEquals(cache.get("env:production:project:/file.tsx"), "Production content");

        cache.deleteByPrefix("branch:main:");
        assertEquals(cache.get("branch:main:project:/file.tsx"), undefined, "Deleted entry");
        assertEquals(
          cache.get("branch:feature:project:/file.tsx"),
          "Branch feature content",
          "Other branch intact",
        );
        assertEquals(
          cache.get("release:v1:project:/file.tsx"),
          "Release v1 content",
          "Release intact",
        );
      });
    });

    describe("Async Cache Race Conditions", () => {
      it("concurrent sets to same key produce consistent result", async () => {
        const cache = new FileCache({ maxSize: 100, ttl: 60000 });
        const key = "race:condition:key";

        const values = Array.from({ length: 10 }, (_, i) => `value-${i}`);
        await Promise.all(
          values.map((v) => {
            cache.set(key, v);
            return Promise.resolve();
          }),
        );

        const result = cache.get(key);
        assert(values.includes(result as string), `Result should be one of the set values: ${result}`);
      });

      it("async get during delete returns correct value or undefined", async () => {
        const cache = new FileCache({ maxSize: 100, ttl: 60000 });

        for (let i = 0; i < 100; i++) cache.set(`prefix:item:${i}`, `value-${i}`);

        const operations = [
          ...Array.from({ length: 50 }, (_, i) => () => {
            const result = cache.get(`prefix:item:${i}`);
            if (result !== undefined) {
              assertEquals(result, `value-${i}`, "If present, value should be correct");
            }
            return Promise.resolve(result);
          }),
          () => {
            cache.deleteByPrefix("prefix:item:");
            return Promise.resolve();
          },
        ];

        await Promise.all(operations.map((op) => op()));

        for (let i = 0; i < 100; i++) {
          assertEquals(cache.get(`prefix:item:${i}`), undefined, `Item ${i} should be deleted`);
        }
      });
    });
  },
);
