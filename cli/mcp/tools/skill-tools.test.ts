import "#veryfront/schemas/_test-setup.ts";
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

    it("returns the bundled veryfront skill with its references", async () => {
      const result = await vfGetSkills.execute({ name: "veryfront" });

      assertEquals(result.skill?.content.includes("veryfront integration connect"), true);
      assertEquals(result.skill?.references?.includes("references/INTEGRATIONS.md"), true);
    });

    it("lists the bundled skills", async () => {
      const result = await vfGetSkills.execute({});
      const names = result.skills?.map((skill) => skill.name) ?? [];

      assertEquals(names.includes("veryfront"), true);
      assertEquals(names.includes("flywheel"), true);
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

    it("returns a bundled reference document", async () => {
      const result = await vfGetSkillReference.execute({
        skill: "veryfront",
        reference: "references/INTEGRATIONS.md",
      });

      assertEquals(result.content?.includes("## Recovery"), true);
    });

    it("returns an error for a path outside the skill's references", async () => {
      const result = await vfGetSkillReference.execute({
        skill: "veryfront",
        reference: "../flywheel/SKILL.md",
      });

      assertEquals(result, { error: "Reference not found: veryfront/../flywheel/SKILL.md" });
    });
  });
});
