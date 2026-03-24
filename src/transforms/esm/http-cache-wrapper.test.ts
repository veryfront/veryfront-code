import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ApiCacheBackend } from "#veryfront/cache/backend.ts";
import {
  __setDistributedCacheAccessorForTests,
  detokenize,
  initializeHttpModuleDistributedCache,
  tokenize,
} from "./http-cache-wrapper.ts";
import { CACHE_DIR_TOKEN } from "./http-cache-invariants.ts";
import { getCacheBaseDir } from "#veryfront/utils/cache-dir.ts";

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
});
