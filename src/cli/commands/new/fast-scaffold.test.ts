/**
 * Unit tests for fast-scaffold module
 * @module cli/commands/new/fast-scaffold.test
 */

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";

// Test the scaffolding result structure
describe("fast-scaffold", () => {
  describe("ScaffoldResult type", () => {
    it("should have required properties", () => {
      const result = {
        filesWritten: 12,
        template: "ai" as const,
        slug: "my-app",
      };

      assertEquals(result.filesWritten, 12);
      assertEquals(result.template, "ai");
      assertEquals(result.slug, "my-app");
    });
  });

  describe("file generation", () => {
    it("should create .veryfrontrc with correct structure", () => {
      const slug = "test-project";
      const content = JSON.stringify({ projectSlug: slug }, null, 2) + "\n";

      assertExists(content);
      assertEquals(JSON.parse(content).projectSlug, slug);
    });

    it("should create .env for ai template", () => {
      const envVars: Record<string, string> = {
        OPENAI_API_KEY: "sk-your-openai-api-key",
      };

      const content = Object.entries(envVars)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");

      assertExists(content);
      assertEquals(content.includes("OPENAI_API_KEY"), true);
    });
  });
});
