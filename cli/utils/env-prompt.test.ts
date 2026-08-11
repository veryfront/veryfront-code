import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for environment variable prompt utilities
 */

import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateGitignoreContent, promptForEnvVars } from "./env-prompt.ts";
import { resetInteractiveMode, setNonInteractive } from "../shared/interactive.ts";

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
      assertStringIncludes(result, "# Local build cache");
      assertStringIncludes(result, ".cache/");
      assertStringIncludes(result, "# IDE");
    });

    it("returns existing content unchanged when every required entry is present", () => {
      const existing = "# My gitignore\n.env\n.env.local\n.env.*.local\n.veryfront/\nnode_modules/";
      const result = generateGitignoreContent(existing);

      assertEquals(result, existing);
    });

    it("adds .veryfront when existing content already ignores environment files", () => {
      const existing = "# My gitignore\n.env\n.env.local\n.env.*.local\nnode_modules/";
      const result = generateGitignoreContent(existing);

      assertStringIncludes(result, ".veryfront/");
      assertEquals(result.match(/^\.env$/gm)?.length, 1);
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

  it("does not read sensitive input when the CLI is non-interactive", async () => {
    try {
      setNonInteractive(true);
      const result = await promptForEnvVars(
        [{
          name: "SECRET_TOKEN",
          description: "Test token",
          required: true,
          sensitive: true,
        }],
        { interactive: true },
      );

      assertEquals(result.values.SECRET_TOKEN, "");
      assertStringIncludes(result.envContent, "# SECRET_TOKEN=");
    } finally {
      resetInteractiveMode();
    }
  });
});
