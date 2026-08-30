import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ApiCacheBackend } from "#veryfront/cache/backend.ts";
import {
  __setDistributedCacheAccessorForTests,
  __setDistributedCacheFallbackForTests,
  detokenize,
  httpBundleCache,
  initializeHttpModuleDistributedCache,
  tokenize,
} from "./http-cache-wrapper.ts";
import { CACHE_DIR_TOKEN } from "./http-cache-invariants.ts";
import { getCacheBaseDir } from "#veryfront/utils/cache-dir.ts";
import { VERSION } from "#veryfront/utils/version.ts";
import type { CacheBackend } from "#veryfront/cache/types.ts";
import { fingerprintImportMap } from "./http-cache-helpers.ts";

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

    it("uses the offline fallback unless a test injects an explicit backend", async () => {
      const restore = __setDistributedCacheFallbackForTests(() => Promise.resolve(null));
      try {
        __setDistributedCacheAccessorForTests(null);
        assertEquals(await initializeHttpModuleDistributedCache(), false);

        __setDistributedCacheAccessorForTests(() => Promise.resolve(new RecordingCacheBackend()));
        assertEquals(await initializeHttpModuleDistributedCache(), true);

        __setDistributedCacheAccessorForTests(null);
        assertEquals(await initializeHttpModuleDistributedCache(), false);
      } finally {
        __setDistributedCacheAccessorForTests(null);
        restore();
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
            serverExternalPackages: ["knex"],
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
        assertEquals(
          identityValues.every((value) =>
            JSON.stringify(value.serverExternalPackages) === JSON.stringify(["knex"])
          ),
          true,
        );

        const importMapEntries = [...backend.entries]
          .filter(([key]) => key.includes(":import-map:"));
        assertEquals(importMapEntries.length, 1);
        assertEquals(JSON.parse(importMapEntries[0]![1]), importMap);
        assertEquals(await httpBundleCache.getIdentityMetadata("bundle-a"), {
          url: "https://modules.example.com/a.js",
          reactVersion: undefined,
          serverExternalPackages: ["knex"],
          importMap,
          importMapFingerprint,
        });
      } finally {
        __setDistributedCacheAccessorForTests(null);
      }
    });

    it("rejects an identity whose shared import map no longer matches its fingerprint", async () => {
      const backend = new RecordingCacheBackend();
      __setDistributedCacheAccessorForTests(async () => backend);
      const importMap = { imports: { pkg: "https://modules.example.com/pkg.js" } };
      const importMapFingerprint = await fingerprintImportMap(importMap);

      try {
        await httpBundleCache.setCode(
          "bundle-a",
          "export {};" as never,
          "https://modules.example.com/a.js",
          60,
          {
            url: "https://modules.example.com/a.js",
            importMap,
            importMapFingerprint,
          },
        );
        const importMapKey = [...backend.entries.keys()].find((key) =>
          key.includes(":import-map:")
        );
        assertExists(importMapKey);

        backend.entries.set(
          importMapKey,
          JSON.stringify({ imports: { pkg: "https://modules.example.com/other.js" } }),
        );
        assertEquals(
          await httpBundleCache.getIdentityMetadata("bundle-a"),
          null,
          "an import-map blob that no longer hashes to its key must not reproduce a bundle",
        );

        backend.entries.delete(importMapKey);
        assertEquals(
          await httpBundleCache.getIdentityMetadata("bundle-a"),
          null,
          "a missing shared import map must not yield partial identity metadata",
        );
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

  describe("setCode", () => {
    it("tokenizes local cache paths before they reach the shared cache", async () => {
      const backend = new RecordingCacheBackend();
      __setDistributedCacheAccessorForTests(async () => backend);
      const cacheDir = getCacheBaseDir().replace(/\/$/, "");

      try {
        await httpBundleCache.setCode(
          "bundle-tokenized",
          `import foo from "file://${cacheDir}/veryfront-http-bundle/http-1.mjs";` as never,
          "https://modules.example.com/a.js",
          60,
        );

        const stored = backend.entries.get(`${VERSION}:code:bundle-tokenized`);
        assertExists(stored);
        assertEquals(
          stored.includes(CACHE_DIR_TOKEN),
          true,
          "stored code must carry the portable cache-dir token",
        );
        assertEquals(
          stored.includes(cacheDir),
          false,
          "machine-local absolute cache paths must never reach the shared cache",
        );
      } finally {
        __setDistributedCacheAccessorForTests(null);
      }
    });
  });

  describe("getCodeByHash", () => {
    it("detokenizes cached code before it leaves the gateway", async () => {
      const backend = new RecordingCacheBackend();
      __setDistributedCacheAccessorForTests(async () => backend);
      const cacheDir = getCacheBaseDir().replace(/\/$/, "");
      backend.entries.set(
        `${VERSION}:code:aaa`,
        `import foo from "file://${CACHE_DIR_TOKEN}/veryfront-http-bundle/http-1.mjs";`,
      );

      try {
        const result = await httpBundleCache.getCodeByHash("aaa");
        assertExists(result.code);
        const code = result.code as unknown as string;
        assertEquals(
          code,
          `import foo from "file://${cacheDir}/veryfront-http-bundle/http-1.mjs";`,
          "cached code is rewritten to this machine's cache directory",
        );
        assertEquals(
          code.includes(CACHE_DIR_TOKEN),
          false,
          "code must be detokenized before it leaves the gateway",
        );
      } finally {
        __setDistributedCacheAccessorForTests(null);
      }
    });

    it("refuses cached HTML error pages instead of serving them as JavaScript", async () => {
      const backend = new RecordingCacheBackend();
      __setDistributedCacheAccessorForTests(async () => backend);
      backend.entries.set(
        `${VERSION}:code:bbb`,
        "<!DOCTYPE html><html><title>ESM</title></html>",
      );

      try {
        const result = await httpBundleCache.getCodeByHash("bbb");
        assertEquals(result.code, null, "an HTML error page must never be returned as code");
        assertEquals(
          result.failReason,
          "html_content",
          "an HTML error page is reported as html_content",
        );
      } finally {
        __setDistributedCacheAccessorForTests(null);
      }
    });

    it("refuses cached content whose gzip payload cannot be decoded", async () => {
      const backend = new RecordingCacheBackend();
      __setDistributedCacheAccessorForTests(async () => backend);
      backend.entries.set(`${VERSION}:code:ccc`, "gz:!!!not-base64!!!");

      try {
        const result = await httpBundleCache.getCodeByHash("ccc");
        assertEquals(result.code, null, "undecodable gzip content must not be returned as code");
        assertEquals(
          result.failReason,
          "gzip_decode_failed",
          "undecodable gzip content is reported as gzip_decode_failed",
        );
      } finally {
        __setDistributedCacheAccessorForTests(null);
      }
    });

    it("reports an unseeded hash as not found", async () => {
      const backend = new RecordingCacheBackend();
      __setDistributedCacheAccessorForTests(async () => backend);

      try {
        const result = await httpBundleCache.getCodeByHash("ddd");
        assertEquals(result.code, null, "an absent bundle has no code");
        assertEquals(result.failReason, "not_found", "an absent bundle is reported as not_found");
      } finally {
        __setDistributedCacheAccessorForTests(null);
      }
    });
  });
});
