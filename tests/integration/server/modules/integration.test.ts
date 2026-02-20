/**
 * Server Modules Integration Tests
 *
 * Tests cross-module integration between:
 * - Error Overlay (runtime and build error display)
 * - API Server (data endpoints and caching)
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "#veryfront/testing/assert";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import { ErrorOverlay } from "../../../../src/server/dev-server/error-overlay/index.ts";
import { APIServer } from "../../../../src/modules/server/index.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

type MockRenderer = {
  renderPage: (slug: string) => Promise<{
    html: string;
    frontmatter: { title: string; description: string };
    headings: Array<{ depth: number; text: string; id: string }>;
  }>;
};

function createMockRenderer(): MockRenderer {
  return {
    // deno-lint-ignore require-await
    renderPage: async (slug: string) => {
      if (slug === "error-page") {
        throw new Error("Render error: Page not found");
      }

      return {
        html: `<div>Content for ${slug}</div>`,
        frontmatter: { title: slug, description: `Description for ${slug}` },
        headings: [{ depth: 1, text: `Heading for ${slug}`, id: "heading-1" }],
      };
    },
  };
}

describe(
  "Server Modules Integration Tests",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    afterAll(async () => {
      await cleanupBundler();
    });

    describe(
      "Server Modules - Error Overlay Integration",
      {
        sanitizeResources: true,
        sanitizeOps: true,
      },
      () => {
        it("generates runtime error overlay with error details", () => {
          const errorInfo = {
            type: "runtime" as const,
            error: new Error("Test runtime error"),
            file: "/src/app.tsx",
            line: 42,
            column: 10,
          };

          const html = ErrorOverlay.createHTML(errorInfo);

          assertStringIncludes(html, "Runtime Error");
          assertStringIncludes(html, "Test runtime error");
          assertStringIncludes(html, "/src/app.tsx");
          assertStringIncludes(html, "42");
          assert(html.length > 0, "HTML should be generated");
        });

        it("generates build error overlay with suggestions", () => {
          const error = new Error('Cannot find module "./missing"');
          const errorInfo = {
            type: "build" as const,
            error,
          };

          const html = ErrorOverlay.createHTML(errorInfo);

          assertStringIncludes(html, "Build Error");
          assertStringIncludes(html, "Cannot find module");

          const suggestion = ErrorOverlay.getSuggestion(error);
          assertExists(suggestion, "Should provide suggestion for module error");
          assertStringIncludes(suggestion!, "module exists");
        });

        it("provides helpful suggestions for common errors", () => {
          const testCases = [
            { error: new Error("Unexpected token <"), expectedSuggestion: "syntax errors" },
            { error: new Error("Module not found: react"), expectedSuggestion: "module exists" },
            {
              error: new Error("Invalid frontmatter syntax"),
              expectedSuggestion: "frontmatter syntax",
            },
            {
              error: new Error("Cannot use hook outside component"),
              expectedSuggestion: "hooks can only",
            },
          ];

          for (const { error, expectedSuggestion } of testCases) {
            const suggestion = ErrorOverlay.getSuggestion(error);
            assertExists(suggestion, `Should provide suggestion for: ${error.message}`);
            assertStringIncludes(
              suggestion!.toLowerCase(),
              expectedSuggestion.toLowerCase(),
              `Suggestion should mention "${expectedSuggestion}"`,
            );
          }
        });

        it("generates error overlay runtime script", () => {
          const runtime = ErrorOverlay.getRuntime();

          assertStringIncludes(runtime, "window.showErrorOverlay");
          assertStringIncludes(runtime, "addEventListener");
          assertStringIncludes(runtime, "error");
          assertStringIncludes(runtime, "unhandledrejection");
          assert(runtime.length > 0, "Runtime script should be generated");
        });

        it("handles errors without file information", () => {
          const errorInfo = {
            type: "runtime" as const,
            error: new Error("Generic error"),
          };

          const html = ErrorOverlay.createHTML(errorInfo);

          assertStringIncludes(html, "Runtime Error");
          assertStringIncludes(html, "Generic error");
          assert(html.length > 0, "HTML should be generated without file info");
        });
      },
    );

    describe(
      "Server Modules - API Server Integration",
      {
        sanitizeResources: true,
        sanitizeOps: true,
      },
      () => {
        it("handles page data requests successfully", async () => {
          const apiServer = new APIServer({ renderer: createMockRenderer() });

          const response = await apiServer.handleRequest("/_veryfront/data/test-page.json");

          assertExists(response, "Should return response for data request");
          assertEquals(response!.status, 200);
          assertEquals(response!.headers.get("content-type"), "application/json");

          const data = await response!.json();
          assertEquals(data.slug, "test-page");
          assertEquals(data.frontmatter.title, "test-page");
          assertStringIncludes(data.html, "test-page");
        });

        it("handles API errors and returns error response", async () => {
          const apiServer = new APIServer({ renderer: createMockRenderer() });

          const response = await apiServer.handleRequest("/_veryfront/data/error-page.json");

          assertExists(response, "Should return error response");
          assertEquals(response!.status, 404);
          assertEquals(response!.headers.get("content-type"), "application/json");

          const data = await response!.json();
          assertExists(data.error, "Should include error message");
          assertStringIncludes(data.error, "Render error");
        });

        it("returns null for non-API routes", async () => {
          const apiServer = new APIServer({ renderer: createMockRenderer() });

          const response = await apiServer.handleRequest("/regular-page");

          assertEquals(response, null, "Should return null for non-API routes");
        });

        it("sets no-cache headers for data endpoints", async () => {
          const apiServer = new APIServer({ renderer: createMockRenderer() });

          const response = await apiServer.handleRequest("/_veryfront/data/index.json");

          assertExists(response);
          assertEquals(response!.headers.get("cache-control"), "no-cache");
        });
      },
    );

    describe(
      "Server Modules - Error Propagation",
      {
        sanitizeResources: true,
        sanitizeOps: true,
      },
      () => {
        it("propagates API errors to error overlay", async () => {
          const apiServer = new APIServer({ renderer: createMockRenderer() });

          const response = await apiServer.handleRequest("/_veryfront/data/error-page.json");

          assertExists(response);
          assertEquals(response!.status, 404);

          const data = await response!.json();
          const error = new Error(data.error);

          const html = ErrorOverlay.createHTML({
            type: "runtime" as const,
            error,
          });

          assertStringIncludes(html, "Render error");
          assertStringIncludes(html, "Runtime Error");
        });

        it("recovers from malformed API responses", async () => {
          const badRenderer = {
            renderPage: (_slug: string) => ({} as any),
          };

          const apiServer = new APIServer({ renderer: badRenderer });
          const response = await apiServer.handleRequest("/_veryfront/data/test.json");

          assertExists(response);
          assertEquals(response!.status, 200);

          const data = await response!.json();
          assertExists(data);
        });
      },
    );
  },
);
