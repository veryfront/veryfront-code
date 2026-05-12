import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getSkillInfo, listSkills } from "./command.ts";

describe("Skills Command", () => {
  describe("listSkills", () => {
    it("returns an array", async () => {
      const skills = await listSkills();
      assertEquals(Array.isArray(skills), true);
    });

    it("returns core skills with required fields", async () => {
      const skills = await listSkills();
      for (const skill of skills) {
        assertEquals(typeof skill.manifest.name, "string");
        assertEquals(typeof skill.manifest.version, "string");
        assertEquals(typeof skill.manifest.description, "string");
        assertEquals(skill.manifest.name.length > 0, true);
      }
    });

    it("includes expected core skills", async () => {
      const skills = await listSkills();
      const names = skills.map((s) => s.manifest.name);
      assertEquals(names.includes("scaffold-app"), true);
      assertEquals(names.includes("deploy-safely"), true);
      assertEquals(names.includes("contribute"), true);
    });
  });

  describe("getSkillInfo", () => {
    it("returns a skill by name", async () => {
      const skill = await getSkillInfo("scaffold-app");
      assertEquals(skill !== null, true);
      assertEquals(skill?.manifest.name, "scaffold-app");
    });

    it("returns null for unknown skill", async () => {
      const skill = await getSkillInfo("nonexistent-skill-xyz");
      assertEquals(skill, null);
    });

    it("returns skill with markdown content", async () => {
      const skill = await getSkillInfo("deploy-safely");
      assertEquals(skill !== null, true);
      assertEquals(typeof skill?.skillMd, "string");
      assertEquals(skill!.skillMd.length > 0, true);
    });
  });
});
