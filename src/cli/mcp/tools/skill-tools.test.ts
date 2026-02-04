/**
 * Tests for MCP skill tools
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { vfGetSkillReference, vfGetSkills } from "./skill-tools.ts";

describe("mcp/tools/skill-tools", () => {
  describe("vfGetSkills", () => {
    it("has correct tool name", () => {
      assertEquals(vfGetSkills.name, "vf_get_skills");
    });

    it("has description mentioning skills", () => {
      assertExists(vfGetSkills.description);
      assertEquals(vfGetSkills.description.toLowerCase().includes("skill"), true);
    });

    it("has execute function", () => {
      assertEquals(typeof vfGetSkills.execute, "function");
    });

    it("returns skills array when executed without name", async () => {
      const result = await vfGetSkills.execute({});
      assertEquals(Array.isArray(result) || typeof result === "object", true);
    });
  });

  describe("vfGetSkillReference", () => {
    it("has correct tool name", () => {
      assertEquals(vfGetSkillReference.name, "vf_get_skill_reference");
    });

    it("has description mentioning reference", () => {
      assertExists(vfGetSkillReference.description);
      assertEquals(vfGetSkillReference.description.toLowerCase().includes("reference"), true);
    });

    it("has execute function", () => {
      assertEquals(typeof vfGetSkillReference.execute, "function");
    });
  });
});
