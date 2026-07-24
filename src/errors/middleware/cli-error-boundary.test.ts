import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for CLI Error Boundary Middleware
 */

import { describe, it } from "#veryfront/testing/bdd";
import { assert, assertEquals, assertExists, assertMatch } from "#veryfront/testing/assert";
import { formatCLIError } from "./cli-error-boundary.ts";
import { VeryfrontError } from "../types.ts";
import { CONFIG_NOT_FOUND, UNKNOWN_ERROR } from "../error-registry.ts";
import { ERROR_OUTPUT_MAX_LENGTH_CHARS } from "../safe-diagnostics.ts";

describe("cli-error-boundary", () => {
  describe("formatCLIError", () => {
    it("should format VeryfrontError with slug and title", () => {
      const error = CONFIG_NOT_FOUND.create({
        detail: "Missing veryfront.config.ts in project root",
      });

      const output = formatCLIError(error);

      // Should include slug in brackets
      assertMatch(output, /\[config-not-found\]/);
      // Should include title
      assertMatch(output, /Configuration file not found/);
    });

    it("should include detail when present", () => {
      const error = CONFIG_NOT_FOUND.create({
        detail: "Missing veryfront.config.ts in project root",
      });

      const output = formatCLIError(error);

      assertMatch(output, /Missing veryfront.config.ts/);
      assertMatch(output, /Detail:/);
    });

    it("should include suggestion when present", () => {
      const error = CONFIG_NOT_FOUND.create();

      const output = formatCLIError(error);

      // CONFIG_NOT_FOUND has a suggestion
      assertMatch(output, /Suggestion:/);
      assertMatch(output, /veryfront\.config\.js/);
      assertMatch(output, /veryfront\.config\.ts/);
      assertMatch(output, /veryfront\.config\.mjs/);
    });

    it("should include docs URL", () => {
      const error = CONFIG_NOT_FOUND.create();

      const output = formatCLIError(error);

      assertMatch(output, /Docs:/);
      assertMatch(output, /https:\/\/veryfront\.com\/docs\/errors\/config-not-found/);
    });

    it("should wrap plain Error as unknown-error", () => {
      const error = new Error("Something went wrong");

      const output = formatCLIError(error);

      assertMatch(output, /\[unknown-error\]/);
      assertMatch(output, /Something went wrong/);
    });

    it("should handle Error with no message", () => {
      const error = new Error();

      const output = formatCLIError(error);

      assertMatch(output, /\[unknown-error\]/);
    });

    it("should handle non-Error throws", () => {
      const output = formatCLIError("string error");

      assertMatch(output, /\[unknown-error\]/);
      assertMatch(output, /string error/);
    });

    it("should format output with proper structure", () => {
      const error = new VeryfrontError("Test error", {
        slug: "test-error",
        category: "GENERAL",
        status: 500,
        title: "Test Error Title",
        detail: "This is a detailed description",
        suggestion: "Try this fix",
      });

      const output = formatCLIError(error);

      const lines = output.split("\n");

      // Should start with empty line
      assertEquals(lines[0], "");

      // Should have slug and title on second line (with ANSI codes stripped for testing)
      const header = lines[1];
      assertExists(header);
      // deno-lint-ignore no-control-regex
      const headerLine = header.replace(/\x1b\[\d+m/g, ""); // Strip ANSI codes
      assertMatch(headerLine, /\[test-error\]/);
      assertMatch(headerLine, /Test Error Title/);

      // Should have detail
      const detailLine = lines.find((line) => line.includes("Detail:"));
      assertEquals(detailLine !== undefined, true);

      // Should have suggestion
      const suggestionLine = lines.find((line) => line.includes("Suggestion:"));
      assertEquals(suggestionLine !== undefined, true);

      // Should have docs link
      const docsLine = lines.find((line) => line.includes("Docs:"));
      assertEquals(docsLine !== undefined, true);

      // Should end with empty line
      assertEquals(lines[lines.length - 1], "");
    });

    it("should not include detail if not provided", () => {
      const error = new VeryfrontError("Test", {
        slug: "test",
        category: "GENERAL",
        status: 500,
        title: "Test",
        // No detail provided
      });

      const output = formatCLIError(error);

      // Should not have "Detail:" line
      assertEquals(output.includes("Detail:"), false);
    });

    it("should not include suggestion if not provided", () => {
      const error = new VeryfrontError("Test", {
        slug: "test",
        category: "GENERAL",
        status: 500,
        title: "Test",
        // No suggestion provided
      });

      const output = formatCLIError(error);

      // Should not have "Suggestion:" line
      assertEquals(output.includes("Suggestion:"), false);
    });

    it("should handle errors with cause", () => {
      const originalError = new Error("Original cause");
      const error = UNKNOWN_ERROR.create({
        detail: "Wrapped error",
        cause: originalError,
      });

      const output = formatCLIError(error);

      assertMatch(output, /Wrapped error/);
      assertMatch(output, /\[unknown-error\]/);
    });

    it("should format multiple errors consistently", () => {
      const error1 = CONFIG_NOT_FOUND.create();
      const error2 = new Error("Test");

      const output1 = formatCLIError(error1);
      const output2 = formatCLIError(error2);

      // Both should start and end with empty lines
      assertEquals(output1.startsWith("\n"), true);
      assertEquals(output1.endsWith("\n"), true);
      assertEquals(output2.startsWith("\n"), true);
      assertEquals(output2.endsWith("\n"), true);
    });

    it("should fail closed for proxies around real errors and redact diagnostics", () => {
      const source = new VeryfrontError("secret", {
        slug: "custom",
        category: "GENERAL",
        status: 500,
        title: "Authorization: Bearer title-secret",
        detail: "apiKey=detail-secret cookie=cookie-secret",
      });
      const hostile = new Proxy(source, {
        get(target, property, receiver) {
          if (property === "slug") throw new Error("blocked");
          return Reflect.get(target, property, receiver);
        },
      });

      const output = formatCLIError(hostile);

      assertMatch(output, /\[unknown-error\]/);
      for (const secret of ["title-secret", "detail-secret", "cookie-secret"]) {
        assertEquals(output.includes(secret), false);
      }
    });

    it("should neutralize terminal and line injection in untrusted fields", () => {
      const injection = "\x1b]2;owned\x07\x1b[2J\nFAKE SUCCESS";
      const error = new VeryfrontError(`message ${injection}`, {
        slug: `custom-${injection}`,
        category: "GENERAL",
        status: 500,
        title: `title ${injection}`,
        detail: `detail ${injection}`,
        suggestion: `suggestion ${injection}`,
      });

      const output = formatCLIError(error);

      for (const forbidden of ["\x1b]2;owned", "\x1b[2J", "\x07", "\nFAKE SUCCESS"]) {
        assertEquals(output.includes(forbidden), false);
      }
    });

    it("should bound actual CLI output for oversized diagnostics", () => {
      const error = new VeryfrontError("Vendor error", {
        slug: "vendor/path?token=slug-secret#fragment",
        category: "GENERAL",
        status: 500,
        title: "t".repeat(ERROR_OUTPUT_MAX_LENGTH_CHARS * 2),
        detail: "d".repeat(ERROR_OUTPUT_MAX_LENGTH_CHARS * 2),
        suggestion: "s".repeat(ERROR_OUTPUT_MAX_LENGTH_CHARS * 2),
      });
      error.stack = `Error: vendor\n${
        "    at frame (file:///app/main.ts:1:1)\n".repeat(
          ERROR_OUTPUT_MAX_LENGTH_CHARS,
        )
      }`;

      const output = formatCLIError(error);

      assert(output.length <= ERROR_OUTPUT_MAX_LENGTH_CHARS);
      assert(output.includes("...[truncated]"));
      assertEquals(output.includes("slug-secret"), false);
    });
  });
});
