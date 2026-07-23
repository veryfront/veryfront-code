import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ApiCacheBackend } from "#veryfront/cache/backend.ts";
import {
  __setDistributedCacheAccessorForTests,
  detokenize,
  httpBundleCache,
  initializeHttpModuleDistributedCache,
  tokenize,
} from "./http-cache-wrapper.ts";
import { CACHE_DIR_TOKEN } from "./http-cache-invariants.ts";
import { getCacheBaseDir } from "#veryfront/utils/cache-dir.ts";
import type { CacheBackend } from "#veryfront/cache/types.ts";
import { fingerprintImportMap } from "./http-cache-helpers.ts";
import { gzipSync } from "node:zlib";
import { MAX_HTTP_MODULE_RESPONSE_BYTES } from "#veryfront/transforms/shared/http-module-response.ts";

class RecordingCacheBackend implements CacheBackend {
  readonly type = "memory" as const;
  readonly entries = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.entries.get(key) ?? null);
  }

  set(key: string, value: string): Promise<void> {
    this.entries.set(key, value);
    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }
}

describe("transforms/esm/http-cache-wrapper", () => {
  it("rejects gzip cache values that expand beyond the module size limit", async () => {
    const backend = new RecordingCacheBackend();
    __setDistributedCacheAccessorForTests(async () => backend);

    try {
      await httpBundleCache.setCode(
        "gzip-bomb",
        "export {};" as never,
        "https://modules.example.test/gzip-bomb.js",
      );
      const codeKey = [...backend.entries.keys()].find((key) => key.endsWith(":code:gzip-bomb"));
      assertExists(codeKey);

      const compressed = gzipSync(new Uint8Array(MAX_HTTP_MODULE_RESPONSE_BYTES + 2));
      const encoded = btoa(String.fromCharCode(...compressed));
      backend.entries.set(codeKey, `gz:${encoded}`);

      const result = await httpBundleCache.getCodeByHash("gzip-bomb");
      assertEquals(result.code, null);
      assertEquals(result.failReason, "content_too_large");
    } finally {
      __setDistributedCacheAccessorForTests(null);
    }
  });

  describe("initializeHttpModuleDistributedCache", () => {
    it("returns false when no distributed cache is available", async () => {
      __setDistributedCacheAccessorForTests(async () => null);

      try {
        assertEquals(await initializeHttpModuleDistributedCache(), false);
      } finally {
        __setDistributedCacheAccessorForTests(null);
      }
    });

    it("returns true when a distributed cache backend is available", async () => {
      __setDistributedCacheAccessorForTests(
        async () => new ApiCacheBackend({ apiBaseUrl: "http://veryfront-api:80" }),
      );

      try {
        assertEquals(await initializeHttpModuleDistributedCache(), true);
      } finally {
        __setDistributedCacheAccessorForTests(null);
      }
    });
  });

  describe("tokenize / detokenize roundtrip", () => {
    it("roundtrips local cache paths through tokenize and detokenize", () => {
      const cacheDir = getCacheBaseDir().replace(/\/$/, "");
      const code = `import foo from "file://${cacheDir}/veryfront-http-bundle/http-123.mjs";`;
      const tokenized = tokenize(code as never);
      const tokenizedStr = tokenized as unknown as string;

      assertEquals(tokenizedStr.includes(CACHE_DIR_TOKEN), true);
      assertEquals(tokenizedStr.includes(cacheDir), false);

      const detokenized = detokenize(tokenized);
      const detokenizedStr = detokenized as unknown as string;

      assertEquals(detokenizedStr.includes(cacheDir), true);
      assertEquals(detokenizedStr.includes(CACHE_DIR_TOKEN), false);
    });

    it("roundtrips mdx-esm cache paths", () => {
      const cacheDir = getCacheBaseDir().replace(/\/$/, "");
      const code = `import foo from "file://${cacheDir}/veryfront-mdx-esm/proj/src.mjs";`;
      const tokenized = tokenize(code as never);
      const tokenizedStr = tokenized as unknown as string;

      assertEquals(tokenizedStr.includes(CACHE_DIR_TOKEN), true);

      const detokenized = detokenize(tokenized);
      assertEquals((detokenized as unknown as string).includes(cacheDir), true);
    });
  });

  describe("tokenize", () => {
    it("tokenizes paths from other environments (aggressive mode)", () => {
      const code =
        `import foo from "file:///other-machine/.cache/veryfront-http-bundle/http-456.mjs";`;
      const tokenized = tokenize(code as never);
      const tokenizedStr = tokenized as unknown as string;

      assertEquals(tokenizedStr.includes(CACHE_DIR_TOKEN), true);
      assertEquals(tokenizedStr.includes("/other-machine/"), false);
    });

    it("leaves code without cache paths unchanged", () => {
      const code = `const x = 1;`;
      const tokenized = tokenize(code as never);
      assertEquals(tokenized as unknown as string, code);
    });
  });

  describe("detokenize", () => {
    it("replaces tokens with local cache directory", () => {
      const cacheDir = getCacheBaseDir().replace(/\/$/, "");
      const code =
        `import foo from "file://${CACHE_DIR_TOKEN}/veryfront-http-bundle/http-123.mjs";`;
      const detokenized = detokenize(code);
      const result = detokenized as unknown as string;

      assertEquals(result.includes(cacheDir), true);
      assertEquals(result.includes(CACHE_DIR_TOKEN), false);
    });

    it("leaves code without tokens unchanged", () => {
      const code = `const x = 1;`;
      const detokenized = detokenize(code);
      assertEquals(detokenized as unknown as string, code);
    });
  });

  describe("identity metadata", () => {
    it("stores one shared import map and references it from each bundle identity", async () => {
      const backend = new RecordingCacheBackend();
      __setDistributedCacheAccessorForTests(async () => backend);
      const importMap = {
        imports: { pkg: "https://modules.example.com/pkg.js" },
        scopes: { "/app/": { scoped: "https://modules.example.com/scoped.js" } },
      };
      const importMapFingerprint = await fingerprintImportMap(importMap);

      try {
        for (
          const [hash, url] of [
            ["bundle-a", "https://modules.example.com/a.js"],
            ["bundle-b", "https://modules.example.com/b.js"],
          ] as const
        ) {
          await httpBundleCache.setCode(hash, "export {};" as never, url, 60, {
            url,
            importMap,
            importMapFingerprint,
          });
        }

        const identityValues = [...backend.entries]
          .filter(([key]) => key.includes(":identity:"))
          .map(([, value]) => JSON.parse(value) as Record<string, unknown>);
        assertEquals(identityValues.length, 2);
        assertEquals(identityValues.every((value) => value.importMap === undefined), true);
        assertEquals(
          identityValues.every((value) => value.importMapFingerprint === importMapFingerprint),
          true,
        );

        const importMapEntries = [...backend.entries]
          .filter(([key]) => key.includes(":import-map:"));
        assertEquals(importMapEntries.length, 1);
        assertEquals(JSON.parse(importMapEntries[0]![1]), importMap);
        assertEquals(await httpBundleCache.getIdentityMetadata("bundle-a"), {
          url: "https://modules.example.com/a.js",
          reactVersion: undefined,
          importMap,
          importMapFingerprint,
        });
      } finally {
        __setDistributedCacheAccessorForTests(null);
      }
    });

    it("continues to read legacy inline import-map identity metadata", async () => {
      const backend = new RecordingCacheBackend();
      __setDistributedCacheAccessorForTests(async () => backend);
      const importMap = { imports: { legacy: "https://modules.example.com/legacy.js" } };

      try {
        await httpBundleCache.setCode(
          "legacy-bundle",
          "export {};" as never,
          "https://modules.example.com/legacy.js",
          60,
          {
            url: "https://modules.example.com/legacy.js",
            importMap,
          },
        );
        const identityKey = [...backend.entries.keys()].find((key) =>
          key.endsWith(":identity:legacy-bundle")
        );
        assertExists(identityKey);
        backend.entries.set(
          identityKey,
          JSON.stringify({
            url: "https://modules.example.com/legacy.js",
            reactVersion: "19.0.0",
            importMap,
          }),
        );

        assertEquals(await httpBundleCache.getIdentityMetadata("legacy-bundle"), {
          url: "https://modules.example.com/legacy.js",
          reactVersion: "19.0.0",
          importMap: { imports: importMap.imports, scopes: undefined },
        });
      } finally {
        __setDistributedCacheAccessorForTests(null);
      }
    });
  });
});
