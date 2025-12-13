import { describe, it, beforeEach } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import {
  getReactVersionInfo,
  hasFeature,
  __resetReactVersionCacheForTests,
} from "./version-cache.ts";

describe("version-cache", () => {
  beforeEach(() => {
    __resetReactVersionCacheForTests();
  });

  describe("getReactVersionInfo", () => {
    it("should return version info", () => {
      const info = getReactVersionInfo();

      assertExists(info);
      assertEquals(typeof info.version, "string");
      assertEquals(typeof info.major, "number");
      assertEquals(typeof info.minor, "number");
      assertEquals(typeof info.patch, "number");
    });

    it("should cache version info on subsequent calls", () => {
      const info1 = getReactVersionInfo();
      const info2 = getReactVersionInfo();

      assertEquals(info1, info2);
      assertEquals(info1 === info2, true, "Should return same object reference");
    });

    it("should have version flags", () => {
      const info = getReactVersionInfo();

      assertEquals(typeof info.isReact17, "boolean");
      assertEquals(typeof info.isReact18, "boolean");
      assertEquals(typeof info.isReact19, "boolean");
    });

    it("should have features object", () => {
      const info = getReactVersionInfo();

      assertExists(info.features);
      assertEquals(typeof info.features, "object");
    });
  });

  describe("hasFeature", () => {
    it("should return boolean for feature check", () => {
      const result = hasFeature("streaming");

      assertEquals(typeof result, "boolean");
    });

    it("should check multiple features", () => {
      const features = [
        "suspense",
        "streaming",
        "automaticBatching",
        "transitions",
        "serverComponents",
        "renderToString",
        "renderToPipeableStream",
        "renderToReadableStream",
      ] as const;

      for (const feature of features) {
        const result = hasFeature(feature);
        assertEquals(typeof result, "boolean");
      }
    });

    it("should use cached version info", () => {
      const info1 = getReactVersionInfo();
      const hasStreamingFeature = hasFeature("streaming");

      assertEquals(hasStreamingFeature, info1.features.streaming);
    });
  });

  describe("__resetReactVersionCacheForTests", () => {
    it("should reset the cache", () => {
      const info1 = getReactVersionInfo();

      __resetReactVersionCacheForTests();

      const info2 = getReactVersionInfo();

      assertEquals(info1.version, info2.version);
      assertEquals(info1 === info2, false, "Should create new object after reset");
    });

    it("should allow fresh detection after reset", () => {
      getReactVersionInfo();

      __resetReactVersionCacheForTests();

      const info = getReactVersionInfo();
      assertExists(info);
      assertEquals(typeof info.version, "string");
    });
  });
});
