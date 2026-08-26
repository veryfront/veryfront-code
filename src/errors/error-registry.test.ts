import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  API_CLIENT_ERROR,
  BUILD_FAILED,
  CACHE_INVARIANT_VIOLATION,
  CONFIG_NOT_FOUND,
  CONFIG_VALIDATION_FAILED,
  ERROR_REGISTRY,
  type ErrorSlug,
  FALLBACK_EXHAUSTED,
  getAllSlugs,
  getErrorBySlug,
  getErrorsByCategory,
  INPUT_VALIDATION_FAILED,
  RESOURCE_NOT_FOUND,
  SECURITY_VIOLATION,
  SSR_OUTPUT_LIMIT_EXCEEDED,
  TOKEN_STORAGE_ERROR,
} from "./error-registry.ts";
import type { ErrorCategory } from "./types.ts";

/**
 * Every error slug published as of this list being written.
 *
 * Slugs are part of the public surface: callers match on them, so removing one
 * is a breaking change while adding one is routine. This guards the breaking
 * direction only, which is also why it is a list rather than a count. An exact
 * count made every error-adding pull request edit the same line, so two of them
 * were each green alone and the second died in the merge queue -- that happened
 * at 120, 121 and again at 122. Adding a slug now touches nothing here.
 *
 * Removing a slug is meant to fail. Delete the entry deliberately, in the same
 * change that retires the error.
 */
const PUBLISHED_ERROR_SLUGS: readonly string[] = Object.freeze([
  "agent-error",
  "agent-intent-error",
  "agent-not-found",
  "agent-timeout",
  "already-exists",
  "api-client-error",
  "api-error",
  "api-route-error",
  "asset-optimization-error",
  "authentication-required",
  "branch-not-found",
  "build-failed",
  "bundle-error",
  "cache-error",
  "cache-invariant-violation",
  "cache-path-mismatch",
  "circuit-breaker-open",
  "circular-dependency",
  "client-boundary-violation",
  "client-only-in-server",
  "compilation-error",
  "component-error",
  "config-invalid",
  "config-not-deployable",
  "config-not-found",
  "config-parse-error",
  "config-type-error",
  "config-validation-error",
  "config-validation-failed",
  "cors-config-invalid",
  "cost-limit-exceeded",
  "default-model-credential-mismatch",
  "dependency-missing",
  "deployment-error",
  "deployment-verification-timeout",
  "dev-server-error",
  "durable-run-event-persistence-failed",
  "dynamic-route-error",
  "env-var-missing",
  "environment-not-found",
  "environment-not-routable",
  "error-overlay-error",
  "fallback-exhausted",
  "fast-refresh-error",
  "file-not-found",
  "file-watch-error",
  "hmr-error",
  "hydration-mismatch",
  "import-map-invalid",
  "import-resolution-error",
  "initialization-error",
  "input-validation-failed",
  "invalid-argument",
  "invalid-import",
  "invalid-route-file",
  "invalid-use-client",
  "invalid-use-server",
  "layout-not-found",
  "local-integration-config-invalid",
  "local-integration-credential-unavailable",
  "local-integration-credentials-missing",
  "local-integration-request-failed",
  "local-integration-request-invalid",
  "local-integration-response-invalid",
  "lockfile-format-mismatch",
  "lockfile-read-error",
  "markdown-compile-error",
  "mdx-compile-error",
  "middleware-error",
  "module-not-found",
  "nested-cwd-scope",
  "network-error",
  "not-supported",
  "orchestration-error",
  "page-not-found",
  "permission-denied",
  "platform-error",
  "port-in-use",
  "preview-hostname-too-long",
  "production-build-required",
  "project-execution-unavailable",
  "project-source-empty",
  "push-conflict",
  "push-receipt-missing",
  "rag-store-corrupt",
  "rag-store-unavailable",
  "redirect-destination-not-allowed",
  "release-build-timeout",
  "release-missing-version",
  "release-not-found",
  "render-error",
  "request-error",
  "resource-not-found",
  "route-conflict",
  "route-handler-invalid",
  "route-params-error",
  "rsc-payload-error",
  "schedule-config-invalid",
  "security-violation",
  "semaphore-timeout",
  "server-only-in-client",
  "server-start-error",
  "service-overloaded",
  "source-digest-mismatch",
  "source-map-error",
  "source-snapshot-freshness-unavailable",
  "sourcemap-error",
  "ssg-generation-error",
  "ssr-output-limit-exceeded",
  "sync-state-invalid",
  "template-not-found",
  "timeout-error",
  "token-storage-error",
  "tool-id-conflict",
  "trigger-config-invalid",
  "trigger-execution-failed",
  "trigger-not-supported",
  "trigger-target-not-found",
  "typescript-error",
  "unknown-error",
  "version-mismatch",
  "webhook-config-invalid",
]);

/**
 * Every category an error may declare.
 *
 * Category names are pinned here; per-category totals are not. Those totals
 * used to be, which put every error-adding pull request on the same line and
 * made two of them collide in the merge queue even though each was green
 * alone. Adding a category is a deliberate, rare change and belongs here;
 * adding an error does not.
 */
const ERROR_CATEGORIES: readonly ErrorCategory[] = Object.freeze([
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
]);

describe("error-registry", () => {
  describe("slug uniqueness", () => {
    it("should have unique slugs across all errors", () => {
      const slugs = getAllSlugs();
      const uniqueSlugs = new Set(slugs);
      assertEquals(slugs.length, uniqueSlugs.size, "Duplicate slugs detected");
    });

    it("keeps every published error slug registered", () => {
      const slugs = new Set<string>(getAllSlugs());
      const missing = PUBLISHED_ERROR_SLUGS.filter((slug) => !slugs.has(slug));
      assertEquals(
        missing,
        [],
        `Published error slug(s) no longer registered: ${missing.join(", ")}`,
      );
    });

    it("registers every local integration boundary error", () => {
      const slugs = new Set(getAllSlugs());
      for (
        const slug of [
          "local-integration-config-invalid",
          "local-integration-credentials-missing",
          "local-integration-credential-unavailable",
          "local-integration-request-invalid",
          "local-integration-request-failed",
          "local-integration-response-invalid",
        ] as const
      ) {
        assertEquals(slugs.has(slug), true, `Missing registered error slug "${slug}"`);
      }
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
    it("should have valid category for all errors", () => {
      const errors = Object.values(ERROR_REGISTRY);
      for (const error of errors) {
        assertEquals(
          ERROR_CATEGORIES.includes(error.category),
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
      assertEquals(
        error.suggestion,
        "Create veryfront.config.js, veryfront.config.ts, or veryfront.config.mjs in the project root",
      );
    });

    it("registers actionable CLI precondition errors", () => {
      assertEquals(getErrorBySlug("authentication-required")?.status, 401);
      assertEquals(getErrorBySlug("project-source-empty")?.status, 400);
    });

    it("classifies invalid sync metadata as a runtime error", () => {
      assertEquals(getErrorBySlug("sync-state-invalid")?.exitCode, undefined);
    });

    it("should return correct error for all slugs", () => {
      const slugs = getAllSlugs();
      for (const slug of slugs) {
        const error = getErrorBySlug(slug);
        assertExists(error);
        assertEquals(error.slug, slug);
      }
    });

    it("should not return inherited object properties as errors", () => {
      for (const slug of ["toString", "constructor", "__proto__"]) {
        assertEquals(getErrorBySlug(slug as ErrorSlug), undefined);
      }
    });

    it("should use the canonical build command in deployment recovery guidance", () => {
      const error = getErrorBySlug("production-build-required");
      const suggestion = error.suggestion;
      assertExists(suggestion);
      assertEquals(suggestion, "Run 'veryfront build' before deploying");
      assertEquals(suggestion.includes("'vf build'"), false);
    });
  });

  describe("getErrorsByCategory", () => {
    it("should return CONFIG errors", () => {
      const errors = getErrorsByCategory("CONFIG");
      assertEquals(errors.length, 14);
      for (const error of errors) {
        assertEquals(error.category, "CONFIG");
      }
    });

    it("should return BUILD errors", () => {
      const errors = getErrorsByCategory("BUILD");
      assertEquals(errors.length, 9);
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
      assertEquals(rfc9457.type, "https://veryfront.com/docs/code/guides/errors#config-not-found");
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
          `https://veryfront.com/docs/code/guides/errors#${slug}`,
          `RFC 9457 type URI mismatch for ${slug}`,
        );
      }
    });
  });

  describe("getDocsUrl", () => {
    it("should return correct documentation URL", () => {
      const error = CONFIG_NOT_FOUND.create();
      assertEquals(
        error.getDocsUrl(),
        "https://veryfront.com/docs/code/guides/errors#config-not-found",
      );
    });

    it("should match RFC 9457 type field", () => {
      const error = BUILD_FAILED.create();
      const rfc9457 = error.toRFC9457();
      assertEquals(error.getDocsUrl(), rfc9457.type);
    });
  });

  describe("error categories coverage", () => {
    it("keeps every category populated", () => {
      const empty = ERROR_CATEGORIES.filter(
        (category) => getErrorsByCategory(category).length === 0,
      );
      assertEquals(empty, [], `Categories with no registered errors: ${empty.join(", ")}`);
    });

    it("partitions the registry across categories", () => {
      // Catches an error that is registered but unreachable by category, which
      // a per-category count cannot see once the expected number is also wrong.
      const categorized = ERROR_CATEGORIES.reduce(
        (total, category) => total + getErrorsByCategory(category).length,
        0,
      );
      assertEquals(categorized, getAllSlugs().length);
    });
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

  describe("SSR_OUTPUT_LIMIT_EXCEEDED", () => {
    it("exposes a stable boundary error for bounded SSR rendering", () => {
      const error = SSR_OUTPUT_LIMIT_EXCEEDED.create({
        detail: "Rendered HTML exceeded the configured output ceiling",
      });

      assertEquals(error.slug, "ssr-output-limit-exceeded");
      assertEquals(error.category, "BOUNDARY");
      assertEquals(error.status, 500);
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

  describe("RESOURCE_NOT_FOUND", () => {
    it("should default to status 404", () => {
      const error = RESOURCE_NOT_FOUND.create({
        detail: "Workflow not found: test-workflow",
      });
      assertEquals(error.slug, "resource-not-found");
      assertEquals(error.status, 404);
      assertEquals(error.detail, "Workflow not found: test-workflow");
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

describe("CLI usage errors", () => {
  it("maps a bad argument to invalid-argument with the usage exit code", () => {
    const error = getErrorBySlug("invalid-argument");
    assertEquals(error.title, "Invalid argument");
    assertEquals(error.exitCode, 2);
  });

  it("registers already-exists for targets that would be overwritten", () => {
    const error = getErrorBySlug("already-exists");
    assertEquals(error.category, "GENERAL");
    assertEquals(error.status, 409);
    assertEquals(error.exitCode, 1);
    assertEquals(error.suggestion?.includes("different name"), true);
  });
});
