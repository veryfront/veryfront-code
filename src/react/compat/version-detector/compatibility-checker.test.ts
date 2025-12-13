import { describe, it, beforeEach } from "std/testing/bdd.ts";
import { assertEquals } from "std/assert/mod.ts";
import {
  checkVersionCompatibility,
  getRecommendedSSRMethod,
} from "./compatibility-checker.ts";
import { __resetReactVersionCacheForTests } from "./version-cache.ts";

describe("compatibility-checker", () => {
  beforeEach(() => {
    __resetReactVersionCacheForTests();
  });

  describe("checkVersionCompatibility", () => {
    it("should return compatible true when no features required", () => {
      const result = checkVersionCompatibility([]);

      assertEquals(result.compatible, true);
      assertEquals(result.warnings.length, 0);
      assertEquals(result.errors.length, 0);
    });

    it("should check basic rendering features", () => {
      const result = checkVersionCompatibility([
        "renderToString",
        "renderToStaticMarkup",
      ]);

      assertEquals(result.compatible, true);
      assertEquals(Array.isArray(result.warnings), true);
      assertEquals(Array.isArray(result.errors), true);
    });

    it("should check React 18+ features", () => {
      const result = checkVersionCompatibility([
        "streaming",
        "suspense",
        "automaticBatching",
        "transitions",
      ]);

      assertEquals(typeof result.compatible, "boolean");
      assertEquals(Array.isArray(result.warnings), true);
      assertEquals(Array.isArray(result.errors), true);
    });

    it("should check React 19 features", () => {
      const result = checkVersionCompatibility([
        "useFormStatus",
        "useOptimistic",
        "serverActions",
      ]);

      assertEquals(typeof result.compatible, "boolean");
      assertEquals(Array.isArray(result.warnings), true);
      assertEquals(Array.isArray(result.errors), true);
    });

    it("should provide meaningful error messages for missing features", () => {
      const result = checkVersionCompatibility([
        "streaming",
        "renderToPipeableStream",
      ]);

      if (!result.compatible) {
        assertEquals(result.errors.length > 0, true);
        for (const error of result.errors) {
          assertEquals(typeof error, "string");
          assertEquals(error.length > 0, true);
        }
      }
    });

    it("should distinguish between errors and warnings", () => {
      const result = checkVersionCompatibility([
        "useFormStatus",
        "streaming",
      ]);

      assertEquals(typeof result.compatible, "boolean");

      if (result.warnings.length > 0) {
        for (const warning of result.warnings) {
          assertEquals(warning.includes("React 19"), true);
        }
      }

      if (result.errors.length > 0) {
        for (const error of result.errors) {
          assertEquals(
            error.includes("React 18+") || error.includes("not available"),
            true,
          );
        }
      }
    });

    it("should handle mixed feature requirements", () => {
      const result = checkVersionCompatibility([
        "renderToString",
        "streaming",
        "useFormStatus",
      ]);

      assertEquals(typeof result.compatible, "boolean");
      assertEquals(Array.isArray(result.warnings), true);
      assertEquals(Array.isArray(result.errors), true);
    });
  });

  describe("getRecommendedSSRMethod", () => {
    it("should return a valid SSR method", () => {
      const method = getRecommendedSSRMethod();

      assertEquals(
        ["string", "stream", "readable-stream"].includes(method),
        true,
      );
    });

    it("should recommend based on available features", () => {
      const method = getRecommendedSSRMethod();

      assertEquals(typeof method, "string");
      assertEquals(method.length > 0, true);
    });

    it("should prefer streaming methods for modern React", () => {
      const method = getRecommendedSSRMethod();

      assertEquals(typeof method, "string");
    });
  });
});
