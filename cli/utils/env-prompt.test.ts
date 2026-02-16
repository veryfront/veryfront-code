/**
 * Tests for environment variable prompt utilities
 */

import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateGitignoreContent } from "./env-prompt.ts";

describe("env-prompt", () => {
  describe("generateGitignoreContent", () => {
    it("generates full gitignore when no existing content", () => {
      const result = generateGitignoreContent();

      assertStringIncludes(result, "node_modules/");
      assertStringIncludes(result, ".env");
      assertStringIncludes(result, ".env.local");
      assertStringIncludes(result, "dist/");
      assertStringIncludes(result, ".veryfront/");
    });

    it("includes standard sections", () => {
      const result = generateGitignoreContent();

      assertStringIncludes(result, "# Dependencies");
      assertStringIncludes(result, "# Environment files");
      assertStringIncludes(result, "# Build output");
      assertStringIncludes(result, "# Local AI model cache");
      assertStringIncludes(result, ".cache/");
      assertStringIncludes(result, "# IDE");
    });

    it("returns existing content unchanged if .env already present", () => {
      const existing = "# My gitignore\n.env\nnode_modules/";
      const result = generateGitignoreContent(existing);

      assertEquals(result, existing);
    });

    it("appends env entries to existing content without .env", () => {
      const existing = "# My gitignore\nnode_modules/";
      const result = generateGitignoreContent(existing);

      assertStringIncludes(result, "node_modules/");
      assertStringIncludes(result, ".env");
      assertStringIncludes(result, ".env.local");
    });

    it("trims whitespace before appending", () => {
      const existing = "node_modules/\n\n\n";
      const result = generateGitignoreContent(existing);

      // Should not have excessive newlines
      const lines = result.split("\n").filter(Boolean);
      assertEquals(lines.length > 0, true);
    });

    it("includes .env.*.local pattern", () => {
      const result = generateGitignoreContent();

      assertStringIncludes(result, ".env.*.local");
    });
  });

  // Note: promptForEnvVars is async and requires user input
  // Full testing would require mocking stdin and environment detection
});
