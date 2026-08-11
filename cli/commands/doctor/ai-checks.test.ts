import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for doctor AI checks
 */

import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withTempDir } from "#veryfront/testing";
import { mkdir, writeTextFile } from "#veryfront/compat/fs.ts";
import { join } from "#veryfront/compat/path";
import { checkAIConfig } from "./ai-checks.ts";

describe("doctor/ai-checks", () => {
  describe("checkAIConfig", () => {
    it("is a function", () => {
      assertEquals(typeof checkAIConfig, "function");
    });

    it("returns array of DiagnosticResult objects", async () => {
      // Test with non-existent project (should return warning)
      const results = await checkAIConfig("/non-existent-project-path");

      assertExists(results);
      assertEquals(Array.isArray(results), true);
      assertEquals(results.length > 0, true);

      // Each result should have required properties
      for (const result of results) {
        assertExists(result.name);
        assertExists(result.status);
        assertExists(result.message);
        assertEquals(["pass", "warn", "fail"].includes(result.status), true);
      }
    });

    it("handles missing config gracefully", async () => {
      const results = await checkAIConfig("/does-not-exist");

      // When config defaults are used (no config file), AI is disabled by default
      // So we expect a "pass" status with "Disabled (default)" message
      const aiFeatureResult = results.find((r) => r.name === "AI Features");
      assertExists(aiFeatureResult);
      assertEquals(aiFeatureResult.status, "pass");
      assertEquals(aiFeatureResult.message, "Disabled (default)");
    });

    it("reports AI as in use when the project ships agents and tools", async () => {
      await withTempDir(async (projectDir) => {
        await mkdir(join(projectDir, "agents"), { recursive: true });
        await mkdir(join(projectDir, "tools"), { recursive: true });
        await writeTextFile(
          join(projectDir, "agents", "assistant.ts"),
          "export default {};\n",
        );
        await writeTextFile(
          join(projectDir, "tools", "calculator.ts"),
          "export default {};\n",
        );

        const results = await checkAIConfig(projectDir);
        const aiFeatureResult = results.find((result) => result.name === "AI Features");

        assertExists(aiFeatureResult);
        assertEquals(aiFeatureResult.status, "pass");
        assertEquals(
          aiFeatureResult.message.includes("Disabled"),
          false,
          "a project with discoverable agents must not be reported as AI-disabled",
        );
        assertStringIncludes(aiFeatureResult.message, "agents/");
        assertStringIncludes(aiFeatureResult.message, "tools/");
      }, { prefix: "doctor-ai-surfaces-" });
    });
  });
});
