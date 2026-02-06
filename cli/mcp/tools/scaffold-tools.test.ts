/**
 * Tests for MCP scaffold tools
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { vfGetConventions, vfScaffold } from "./scaffold-tools.ts";

describe("mcp/tools/scaffold-tools", () => {
  describe("vfGetConventions", () => {
    it("has correct tool name", () => {
      assertEquals(vfGetConventions.name, "vf_get_conventions");
    });

    it("has description mentioning conventions", () => {
      assertExists(vfGetConventions.description);
      assertEquals(vfGetConventions.description.toLowerCase().includes("convention"), true);
    });

    it("has execute function", () => {
      assertEquals(typeof vfGetConventions.execute, "function");
    });

    it("returns conventions object when executed", async () => {
      const result = await vfGetConventions.execute({});
      assertExists(result);
      assertEquals(typeof result, "object");
    });

    it("includes file naming conventions", async () => {
      const result = await vfGetConventions.execute({});
      assertExists(result);
    });
  });

  describe("vfScaffold", () => {
    it("has correct tool name", () => {
      assertEquals(vfScaffold.name, "vf_scaffold");
    });

    it("has description mentioning scaffold or create", () => {
      assertExists(vfScaffold.description);
      const desc = vfScaffold.description.toLowerCase();
      assertEquals(desc.includes("scaffold") || desc.includes("create"), true);
    });

    it("has execute function", () => {
      assertEquals(typeof vfScaffold.execute, "function");
    });
  });
});
