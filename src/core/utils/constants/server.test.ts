import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assert, assertExists } from "std/assert/mod.ts";
import {
  DEFAULT_DASHBOARD_PORT,
  INTERNAL_PREFIX,
  INTERNAL_PATH_PREFIXES,
  INTERNAL_ENDPOINTS,
  BUILD_DIRS,
  PROJECT_DIRS,
  DEFAULT_CACHE_DIR,
  isInternalEndpoint,
  isStaticAsset,
  normalizeChunkPath,
} from "./server.ts";

describe("utils/constants/server", () => {
  describe("constants", () => {
    it("should export DEFAULT_DASHBOARD_PORT", () => {
      assertEquals(DEFAULT_DASHBOARD_PORT, 3002);
    });

    it("should export INTERNAL_PREFIX", () => {
      assertEquals(INTERNAL_PREFIX, "/_veryfront");
    });

    it("should export path prefixes", () => {
      assertExists(INTERNAL_PATH_PREFIXES.RSC);
      assertExists(INTERNAL_PATH_PREFIXES.FS);
      assertExists(INTERNAL_PATH_PREFIXES.MODULES);
    });

    it("should export internal endpoints", () => {
      assertExists(INTERNAL_ENDPOINTS.HMR_RUNTIME);
      assertExists(INTERNAL_ENDPOINTS.CLIENT_JS);
      assertExists(INTERNAL_ENDPOINTS.RSC_CLIENT);
    });

    it("should export build directories", () => {
      assertEquals(BUILD_DIRS.ROOT, "_veryfront");
      assertExists(BUILD_DIRS.CHUNKS);
    });

    it("should export project directories", () => {
      assertEquals(PROJECT_DIRS.ROOT, ".veryfront");
      assertExists(PROJECT_DIRS.CACHE);
    });
  });

  describe("isInternalEndpoint", () => {
    it("should detect internal endpoints", () => {
      assertEquals(isInternalEndpoint("/_veryfront/hmr.js"), true);
      assertEquals(isInternalEndpoint("/public/file.js"), false);
    });
  });

  describe("isStaticAsset", () => {
    it("should detect static assets", () => {
      assertEquals(isStaticAsset("/file.js"), true);
      assertEquals(isStaticAsset("/path"), false);
    });

    it("should detect internal endpoints as static", () => {
      assertEquals(isStaticAsset("/_veryfront/client.js"), true);
    });
  });

  describe("normalizeChunkPath", () => {
    it("should normalize chunk paths", () => {
      const result = normalizeChunkPath("bundle.js");
      assert(result.includes("bundle.js"));
    });

    it("should handle absolute paths", () => {
      const result = normalizeChunkPath("/abs/bundle.js");
      assertEquals(result, "/abs/bundle.js");
    });
  });
});
