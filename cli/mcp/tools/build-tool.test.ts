/**
 * Tests for MCP build tool
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { vfBuild } from "./build-tool.ts";

describe("mcp/tools/build-tool", () => {
  describe("vfBuild", () => {
    it("has correct tool name", () => {
      assertEquals(vfBuild.name, "vf_build");
    });

    it("has description mentioning production build", () => {
      assertExists(vfBuild.description);
      assertEquals(vfBuild.description.includes("production build"), true);
    });

    it("has execute function", () => {
      assertEquals(typeof vfBuild.execute, "function");
    });

    it("has correct annotations", () => {
      assertExists(vfBuild.annotations);
      assertEquals(vfBuild.annotations!.readOnlyHint, false);
      assertEquals(vfBuild.annotations!.destructiveHint, false);
      assertEquals(vfBuild.annotations!.idempotentHint, true);
      assertEquals(vfBuild.annotations!.openWorldHint, false);
    });

    it("has title", () => {
      assertEquals(vfBuild.title, "Production Build");
    });
  });
});
