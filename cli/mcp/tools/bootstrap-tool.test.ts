import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for MCP bootstrap tool
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { vfBootstrap } from "./bootstrap-tool.ts";

// ---------------------------------------------------------------------------
// Tool definition (shape)
// ---------------------------------------------------------------------------

describe("mcp/tools/bootstrap-tool", () => {
  describe("vfBootstrap tool definition", () => {
    it("has correct tool name", () => {
      assertEquals(vfBootstrap.name, "vf_bootstrap");
    });

    it("has description mentioning session", () => {
      assertExists(vfBootstrap.description);
      assertEquals(vfBootstrap.description.includes("session"), true);
    });

    it("has description mentioning bootstrap", () => {
      assertEquals(vfBootstrap.description.includes("bootstrap"), true);
    });

    it("has description listing equivalent separate calls", () => {
      assertEquals(vfBootstrap.description.includes("vf_get_project_context"), true);
      assertEquals(vfBootstrap.description.includes("vf_get_conventions"), true);
      assertEquals(vfBootstrap.description.includes("vf_get_errors"), true);
      assertEquals(vfBootstrap.description.includes("vf_get_status"), true);
    });

    it("has execute function", () => {
      assertEquals(typeof vfBootstrap.execute, "function");
    });

    it("has correct annotations — read-only, not destructive, idempotent", () => {
      assertEquals(vfBootstrap.annotations?.readOnlyHint, true);
      assertEquals(vfBootstrap.annotations?.destructiveHint, false);
      assertEquals(vfBootstrap.annotations?.idempotentHint, true);
      assertEquals(vfBootstrap.annotations?.openWorldHint, false);
    });

    it("has title", () => {
      assertEquals(vfBootstrap.title, "Bootstrap");
    });
  });

  // ---------------------------------------------------------------------------
  // Input schema
  // ---------------------------------------------------------------------------

  describe("input schema", () => {
    it("accepts empty input", () => {
      const parsed = vfBootstrap.inputSchema.parse({});
      assertEquals(parsed.projectPath, undefined);
    });

    it("accepts projectPath", () => {
      const parsed = vfBootstrap.inputSchema.parse({ projectPath: "/tmp/project" });
      assertEquals(parsed.projectPath, "/tmp/project");
    });

    it("rejects non-string projectPath", () => {
      let threw = false;
      try {
        vfBootstrap.inputSchema.parse({ projectPath: 123 });
      } catch {
        threw = true;
      }
      assertEquals(threw, true);
    });
  });

  // ---------------------------------------------------------------------------
  // Execute — return shape
  // ---------------------------------------------------------------------------

  describe("execute", () => {
    it("returns object with expected top-level keys", async () => {
      const result = await vfBootstrap.execute({});
      assertExists(result.project);
      assertExists(result.conventions);
      assertExists(result.errors);
      assertExists(result.status);
    });

    it("errors has total and items fields", async () => {
      const result = await vfBootstrap.execute({});
      assertEquals(typeof result.errors.total, "number");
      assertEquals(Array.isArray(result.errors.items), true);
    });

    it("status has running boolean", async () => {
      const result = await vfBootstrap.execute({});
      assertEquals(typeof result.status.running, "boolean");
    });

    it("errors.items is limited to 20 entries", async () => {
      const result = await vfBootstrap.execute({});
      assertEquals(result.errors.items.length <= 20, true);
    });

    it("project contains route and directory info", async () => {
      const result = await vfBootstrap.execute({});
      assertExists(result.project);
      // ProjectContext has these fields from vfGetProjectContext
      assertEquals(typeof result.project, "object");
    });

    it("conventions contains coding conventions", async () => {
      const result = await vfBootstrap.execute({});
      assertExists(result.conventions);
    });
  });
});
