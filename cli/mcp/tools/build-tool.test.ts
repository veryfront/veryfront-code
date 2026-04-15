/**
 * Tests for MCP build tool
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { vfBuild } from "./build-tool.ts";

// ---------------------------------------------------------------------------
// Tool definition (shape)
// ---------------------------------------------------------------------------

describe("mcp/tools/build-tool", () => {
  describe("vfBuild tool definition", () => {
    it("has correct tool name", () => {
      assertEquals(vfBuild.name, "vf_build");
    });

    it("has description mentioning production build", () => {
      assertExists(vfBuild.description);
      assertEquals(vfBuild.description.includes("production build"), true);
    });

    it("has description mentioning dryRun", () => {
      assertEquals(vfBuild.description.includes("dryRun"), true);
    });

    it("has description cross-referencing dev server", () => {
      assertEquals(vfBuild.description.includes("dev server"), true);
    });

    it("has execute function", () => {
      assertEquals(typeof vfBuild.execute, "function");
    });

    it("has correct annotations — not read-only, not destructive, idempotent", () => {
      assertEquals(vfBuild.annotations?.readOnlyHint, false);
      assertEquals(vfBuild.annotations?.destructiveHint, false);
      assertEquals(vfBuild.annotations?.idempotentHint, true);
      assertEquals(vfBuild.annotations?.openWorldHint, false);
    });

    it("has title", () => {
      assertEquals(vfBuild.title, "Production Build");
    });
  });

  // ---------------------------------------------------------------------------
  // Input schema validation
  // ---------------------------------------------------------------------------

  describe("input schema", () => {
    it("accepts empty input with correct defaults", () => {
      const parsed = vfBuild.inputSchema.parse({});
      assertEquals(parsed.splitting, true);
      assertEquals(parsed.compress, true);
      assertEquals(parsed.ssg, true);
      assertEquals(parsed.dryRun, false);
      assertEquals(parsed.outputDir, undefined);
    });

    it("accepts all fields", () => {
      const parsed = vfBuild.inputSchema.parse({
        outputDir: "/tmp/build",
        splitting: false,
        compress: false,
        ssg: false,
        dryRun: true,
      });
      assertEquals(parsed.outputDir, "/tmp/build");
      assertEquals(parsed.splitting, false);
      assertEquals(parsed.compress, false);
      assertEquals(parsed.ssg, false);
      assertEquals(parsed.dryRun, true);
    });

    it("rejects invalid types", () => {
      let threw = false;
      try {
        vfBuild.inputSchema.parse({ splitting: "yes" });
      } catch {
        threw = true;
      }
      assertEquals(threw, true);
    });

    it("rejects non-string outputDir", () => {
      let threw = false;
      try {
        vfBuild.inputSchema.parse({ outputDir: 123 });
      } catch {
        threw = true;
      }
      assertEquals(threw, true);
    });
  });

  // ---------------------------------------------------------------------------
  // BuildResult interface (execute returns correct shape on error)
  // ---------------------------------------------------------------------------

  describe("execute error handling", () => {
    it("returns BuildResult with success false on build failure", async () => {
      // Execute against a non-existent project dir to trigger a build error
      const result = await vfBuild.execute({
        outputDir: "/tmp/vf-build-test-nonexistent",
        splitting: true,
        compress: true,
        ssg: true,
        dryRun: true,
      });
      // buildProduction will fail because cwd() may not be a valid project
      // Either way, it should return a structured result, not throw
      assertExists(result);
      assertEquals(typeof result.success, "boolean");
      if (!result.success) {
        assertEquals(typeof result.error, "string");
        assertEquals(typeof result.duration_ms, "number");
      }
    });
  });
});
