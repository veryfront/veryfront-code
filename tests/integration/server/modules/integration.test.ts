/**
 * Server error-overlay integration tests.
 */

import "../../../_helpers/contract-init.ts";
import { assert, assertExists, assertStringIncludes } from "#veryfront/testing/assert";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import { ErrorOverlay } from "../../../../src/server/dev-server/error-overlay/index.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

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
  },
);
