import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  BUILD_FAILED,
  CONFIG_NOT_FOUND,
  ERROR_REGISTRY,
  getAllSlugs,
  getErrorBySlug,
  getErrorsByCategory,
} from "./error-registry.ts";
import type { ErrorCategory } from "./types.ts";

describe("error-registry", () => {
  describe("slug uniqueness", () => {
    it("should have unique slugs across all errors", () => {
      const slugs = getAllSlugs();
      const uniqueSlugs = new Set(slugs);
      assertEquals(slugs.length, uniqueSlugs.size, "Duplicate slugs detected");
    });

    it("should have 69 registered errors", () => {
      const slugs = getAllSlugs();
      assertEquals(slugs.length, 69);
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

    it("should have max 40 characters for all slugs", () => {
      const slugs = getAllSlugs();
      for (const slug of slugs) {
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
      assertEquals(errors.length, 7);
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
      const errors = getErrorsByCategory("INVALID");
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

    it("should include cause in RFC 9457 response when provided", () => {
      const error = BUILD_FAILED.create({
        detail: "Build failed due to TypeScript errors",
        cause: "typescript-error",
      });

      const rfc9457 = error.toRFC9457();
      assertEquals(rfc9457.cause, "typescript-error");
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
      CONFIG: 7,
      BUILD: 8,
      RUNTIME: 7,
      ROUTE: 6,
      MODULE: 6,
      SERVER: 8,
      BOUNDARY: 6,
      DEV: 5,
      DEPLOY: 4,
      AGENT: 5,
      GENERAL: 7,
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
});
