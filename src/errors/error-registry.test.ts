import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  API_CLIENT_ERROR,
  BUILD_FAILED,
  CACHE_INVARIANT_VIOLATION,
  CONFIG_NOT_FOUND,
  CONFIG_VALIDATION_FAILED,
  ERROR_REGISTRY,
  FALLBACK_EXHAUSTED,
  getAllSlugs,
  getErrorBySlug,
  getErrorsByCategory,
  INPUT_VALIDATION_FAILED,
  SECURITY_VIOLATION,
  TOKEN_STORAGE_ERROR,
} from "./error-registry.ts";
import type { ErrorCategory } from "./types.ts";

describe("error-registry", () => {
  describe("slug uniqueness", () => {
    it("should have unique slugs across all errors", () => {
      const slugs = getAllSlugs();
      const uniqueSlugs = new Set(slugs);
      assertEquals(slugs.length, uniqueSlugs.size, "Duplicate slugs detected");
    });

    it("should have 77 registered errors", () => {
      const slugs = getAllSlugs();
      assertEquals(slugs.length, 77);
    });
  });

  describe("slug naming convention", () => {
    it("should use kebab-case for all slugs", () => {
      const slugs = getAllSlugs();
      for (const slug of slugs) {
        assertEquals(
          slug,
          slug.toLowerCase(),
          `Slug "${slug}" should be lowercase`,
        );
        assertEquals(
          slug.includes("_"),
          false,
          `Slug "${slug}" should not contain underscores`,
        );
        assertEquals(
          /^[a-z][a-z0-9-]*[a-z0-9]$/.test(slug),
          true,
          `Slug "${slug}" should be valid kebab-case`,
        );
      }
    });

    it("should have between 3 and 40 characters for all slugs", () => {
      const slugs = getAllSlugs();
      for (const slug of slugs) {
        assertEquals(
          slug.length >= 3,
          true,
          `Slug "${slug}" is too short (min 3 characters)`,
        );
        assertEquals(
          slug.length <= 40,
          true,
          `Slug "${slug}" exceeds 40 characters`,
        );
      }
    });
  });

  describe("error definitions", () => {
    const validCategories: ErrorCategory[] = [
      "CONFIG",
      "BUILD",
      "RUNTIME",
      "ROUTE",
      "MODULE",
      "SERVER",
      "BOUNDARY",
      "DEV",
      "DEPLOY",
      "AGENT",
      "GENERAL",
    ];

    it("should have valid category for all errors", () => {
      const errors = Object.values(ERROR_REGISTRY);
      for (const error of errors) {
        assertEquals(
          validCategories.includes(error.category),
          true,
          `Error "${error.slug}" has invalid category "${error.category}"`,
        );
      }
    });

    it("should have valid HTTP status for all errors", () => {
      const errors = Object.values(ERROR_REGISTRY);
      for (const error of errors) {
        assertEquals(
          error.status >= 400 && error.status < 600,
          true,
          `Error "${error.slug}" has invalid status ${error.status}`,
        );
      }
    });

    it("should have non-empty title for all errors", () => {
      const errors = Object.values(ERROR_REGISTRY);
      for (const error of errors) {
        assertEquals(
          error.title.length > 0,
          true,
          `Error "${error.slug}" has empty title`,
        );
      }
    });
  });

  describe("getErrorBySlug", () => {
    it("should return error definition for valid slug", () => {
      const error = getErrorBySlug("config-not-found");
      assertExists(error);
      assertEquals(error.slug, "config-not-found");
      assertEquals(error.category, "CONFIG");
      assertEquals(error.status, 404);
    });

    it("should return correct error for all slugs", () => {
      const slugs = getAllSlugs();
      for (const slug of slugs) {
        const error = getErrorBySlug(slug);
        assertExists(error);
        assertEquals(error.slug, slug);
      }
    });
  });

  describe("getErrorsByCategory", () => {
    it("should return CONFIG errors", () => {
      const errors = getErrorsByCategory("CONFIG");
      assertEquals(errors.length, 8);
      for (const error of errors) {
        assertEquals(error.category, "CONFIG");
      }
    });

    it("should return BUILD errors", () => {
      const errors = getErrorsByCategory("BUILD");
      assertEquals(errors.length, 8);
      for (const error of errors) {
        assertEquals(error.category, "BUILD");
      }
    });

    it("should return empty array for invalid category", () => {
      const errors = getErrorsByCategory("INVALID" as ErrorCategory);
      assertEquals(errors.length, 0);
    });
  });

  describe("error.create()", () => {
    it("should create VeryfrontError with correct properties", () => {
      const error = CONFIG_NOT_FOUND.create({
        detail: "Could not find veryfront.config.ts in /app/my-project",
      });

      assertEquals(error.slug, "config-not-found");
      assertEquals(error.category, "CONFIG");
      assertEquals(error.status, 404);
      assertEquals(error.title, "Configuration file not found");
      assertEquals(error.detail, "Could not find veryfront.config.ts in /app/my-project");
      assertExists(error.suggestion);
    });

    it("should support error chaining with cause", () => {
      const error = BUILD_FAILED.create({
        detail: "Build failed due to TypeScript errors",
        cause: "typescript-error",
      });

      assertEquals(error.slug, "build-failed");
      assertEquals(error.cause, "typescript-error");
    });

    it("should support context data", () => {
      const context = { file: "src/index.ts", line: 42 };
      const error = BUILD_FAILED.create({
        detail: "Build failed",
        context,
      });

      assertEquals(error.context, context);
    });

    it("should support status override via create options", () => {
      const error = API_CLIENT_ERROR.create({
        detail: "Not found",
        status: 404,
      });

      assertEquals(error.status, 404);
    });

    it("should support Error object as cause", () => {
      const cause = new Error("original failure");
      const error = FALLBACK_EXHAUSTED.create({
        detail: "Both operations failed",
        cause,
      });

      assertEquals(error.cause, cause);
    });
  });

  describe("RFC 9457 compliance", () => {
    it("should generate valid RFC 9457 response", () => {
      const error = CONFIG_NOT_FOUND.create({
        detail: "Could not find veryfront.config.ts in /app/my-project",
        instance: "/api/projects/abc123/build",
      });

      const rfc9457 = error.toRFC9457();

      // Required fields
      assertEquals(rfc9457.type, "https://veryfront.com/docs/errors/config-not-found");
      assertEquals(rfc9457.title, "Configuration file not found");
      assertEquals(rfc9457.status, 404);
      assertEquals(rfc9457.category, "CONFIG");

      // Optional fields
      assertEquals(rfc9457.detail, "Could not find veryfront.config.ts in /app/my-project");
      assertEquals(rfc9457.instance, "/api/projects/abc123/build");
      assertExists(rfc9457.suggestion);
    });

    it("should include cause in RFC 9457 response when provided as string", () => {
      const error = BUILD_FAILED.create({
        detail: "Build failed due to TypeScript errors",
        cause: "typescript-error",
      });

      const rfc9457 = error.toRFC9457();
      assertEquals(rfc9457.cause, "typescript-error");
    });

    it("should omit non-string cause from RFC 9457 response", () => {
      const error = FALLBACK_EXHAUSTED.create({
        detail: "Both operations failed",
        cause: new Error("original"),
      });

      const rfc9457 = error.toRFC9457();
      assertEquals(rfc9457.cause, undefined);
    });

    it("should have type URI that matches docs URL", () => {
      const slugs = getAllSlugs();
      for (const slug of slugs) {
        const errorDef = getErrorBySlug(slug);
        const error = errorDef.create();
        const rfc9457 = error.toRFC9457();

        assertEquals(
          rfc9457.type,
          `https://veryfront.com/docs/errors/${slug}`,
          `RFC 9457 type URI mismatch for ${slug}`,
        );
      }
    });
  });

  describe("getDocsUrl", () => {
    it("should return correct documentation URL", () => {
      const error = CONFIG_NOT_FOUND.create();
      assertEquals(error.getDocsUrl(), "https://veryfront.com/docs/errors/config-not-found");
    });

    it("should match RFC 9457 type field", () => {
      const error = BUILD_FAILED.create();
      const rfc9457 = error.toRFC9457();
      assertEquals(error.getDocsUrl(), rfc9457.type);
    });
  });

  describe("error categories coverage", () => {
    const expectedCategoryCounts: Record<string, number> = {
      CONFIG: 8,
      BUILD: 8,
      RUNTIME: 7,
      ROUTE: 6,
      MODULE: 6,
      SERVER: 13,
      BOUNDARY: 6,
      DEV: 5,
      DEPLOY: 4,
      AGENT: 5,
      GENERAL: 9,
    };

    for (const [category, count] of Object.entries(expectedCategoryCounts)) {
      it(`should have ${count} errors in ${category} category`, () => {
        const errors = getErrorsByCategory(category);
        assertEquals(
          errors.length,
          count,
          `Expected ${count} ${category} errors, got ${errors.length}`,
        );
      });
    }
  });

  // =========================================================================
  // Scattered error migration tests
  // =========================================================================

  describe("API_CLIENT_ERROR", () => {
    it("should preserve status and context", () => {
      const error = API_CLIENT_ERROR.create({
        detail: "Not found",
        status: 404,
        context: { endpoint: "/api/users" },
      });
      assertEquals(error.slug, "api-client-error");
      assertEquals(error.status, 404);
      assertEquals((error.context as Record<string, unknown>).endpoint, "/api/users");
    });

    it("should use title as message when no detail", () => {
      const error = API_CLIENT_ERROR.create();
      assertEquals(error.message, "API client request failed");
      assertEquals(error.detail, undefined);
    });
  });

  describe("CONFIG_VALIDATION_FAILED", () => {
    it("should default to status 400", () => {
      const error = CONFIG_VALIDATION_FAILED.create({ detail: "Invalid port" });
      assertEquals(error.slug, "config-validation-failed");
      assertEquals(error.status, 400);
    });
  });

  describe("SECURITY_VIOLATION", () => {
    it("should default to status 403", () => {
      const error = SECURITY_VIOLATION.create({
        detail: "Path traversal detected",
        context: { path: "../etc/passwd", code: "TRAVERSAL" },
      });
      assertEquals(error.slug, "security-violation");
      assertEquals(error.status, 403);
      assertEquals((error.context as Record<string, unknown>).path, "../etc/passwd");
    });
  });

  describe("INPUT_VALIDATION_FAILED", () => {
    it("should default to status 400", () => {
      const error = INPUT_VALIDATION_FAILED.create({
        detail: "URL too long",
        context: { maxLength: 2048 },
      });
      assertEquals(error.slug, "input-validation-failed");
      assertEquals(error.status, 400);
    });
  });

  describe("TOKEN_STORAGE_ERROR", () => {
    it("should preserve status from response", () => {
      const error = TOKEN_STORAGE_ERROR.create({
        detail: "Failed to get token",
        status: 503,
      });
      assertEquals(error.slug, "token-storage-error");
      assertEquals(error.status, 503);
    });
  });

  describe("CACHE_INVARIANT_VIOLATION", () => {
    it("should default to status 500", () => {
      const error = CACHE_INVARIANT_VIOLATION.create({
        detail: "Hardcoded paths in portable code",
      });
      assertEquals(error.slug, "cache-invariant-violation");
      assertEquals(error.status, 500);
    });
  });

  describe("FALLBACK_EXHAUSTED", () => {
    it("should chain cause errors", () => {
      const primary = new Error("primary failed");
      const error = FALLBACK_EXHAUSTED.create({
        detail: "Both primary and fallback failed",
        cause: primary,
        context: { operationName: "readFile" },
      });
      assertEquals(error.slug, "fallback-exhausted");
      assertEquals(error.status, 500);
      assertEquals(error.cause, primary);
    });
  });
});
