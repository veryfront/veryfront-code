import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for MCP skill tools
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { cwd } from "veryfront/platform";
import { join } from "veryfront/platform/path";
import { vfGetSkillReference, vfGetSkills } from "./skill-tools.ts";

const SKILLS_DIR = join(cwd(), "cli/mcp/skills");

function uniqueFixtureName(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

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

    it("loads a skill and its advertised references", async () => {
      const result = await vfGetSkills.execute({ name: "veryfront" });
      assertEquals(result.skill?.name, "veryfront");
      assertEquals(result.skill?.references?.includes("references/ROUTES.md"), true);
      assertEquals(result.error, undefined);
    });

    it("preserves nested tool metadata from canonical skill frontmatter", async () => {
      const result = await vfGetSkills.execute({ name: "flywheel" });
      assertEquals(result.skill?.tools, [
        "vf_wait_for_ready",
        "vf_get_flywheel_status",
        "vf_trigger_hmr",
        "vf_get_errors",
        "vf_get_logs",
      ]);
    });

    it("rejects traversal to a skill outside the skills directory", async () => {
      const outsideName = uniqueFixtureName("outside-skill");
      const outsideDir = join(cwd(), "cli/mcp", outsideName);
      await Deno.mkdir(outsideDir);
      await Deno.writeTextFile(
        join(outsideDir, "SKILL.md"),
        "---\nname: escaped\ndescription: escaped\n---\n\noutside",
      );

      try {
        const result = await vfGetSkills.execute({ name: `../${outsideName}` });
        assertEquals(result, { error: "Skill not found." });
      } finally {
        await Deno.remove(outsideDir, { recursive: true });
      }
    });

    it("rejects absolute, backslash, and encoded path lookalikes", async () => {
      for (const name of ["/tmp/skill", "..\\outside", "%2e%2e%2foutside"]) {
        assertEquals(await vfGetSkills.execute({ name }), { error: "Skill not found." });
      }
    });

    it("rejects skill directories that are symbolic links", async () => {
      const skillName = uniqueFixtureName("linked-skill");
      const outsideDir = await Deno.makeTempDir({ prefix: "veryfront-skill-tool-" });
      const linkPath = join(SKILLS_DIR, skillName);
      await Deno.writeTextFile(
        join(outsideDir, "SKILL.md"),
        `---\nname: ${skillName}\ndescription: linked\n---\n\noutside`,
      );
      await Deno.symlink(outsideDir, linkPath);

      try {
        assertEquals(await vfGetSkills.execute({ name: skillName }), {
          error: "Skill not found.",
        });
      } finally {
        await Deno.remove(linkPath);
        await Deno.remove(outsideDir, { recursive: true });
      }
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

    it("loads an advertised reference", async () => {
      const result = await vfGetSkillReference.execute({
        skill: "veryfront",
        reference: "references/ROUTES.md",
      });
      assertEquals(typeof result.content, "string");
      assertEquals(result.error, undefined);
    });

    it("rejects traversal and files that the skill does not advertise", async () => {
      for (
        const reference of [
          "../../../../AGENTS.md",
          "SKILL.md",
          "references/../SKILL.md",
          "references\\ROUTES.md",
          "%2e%2e%2fAGENTS.md",
        ]
      ) {
        assertEquals(
          await vfGetSkillReference.execute({ skill: "veryfront", reference }),
          { error: "Skill reference not found." },
        );
      }
    });

    it("requires the exact advertised skill name", async () => {
      assertEquals(
        await vfGetSkillReference.execute({
          skill: "../skills/veryfront",
          reference: "references/ROUTES.md",
        }),
        { error: "Skill reference not found." },
      );
    });

    it("rejects reference files that are symbolic links", async () => {
      const fileName = `${uniqueFixtureName("linked-reference")}.md`;
      const outsideDir = await Deno.makeTempDir({ prefix: "veryfront-skill-reference-" });
      const outsidePath = join(outsideDir, fileName);
      const linkPath = join(SKILLS_DIR, "veryfront", "references", fileName);
      await Deno.writeTextFile(outsidePath, "outside");
      await Deno.symlink(outsidePath, linkPath);

      try {
        assertEquals(
          await vfGetSkillReference.execute({
            skill: "veryfront",
            reference: `references/${fileName}`,
          }),
          { error: "Skill reference not found." },
        );
      } finally {
        await Deno.remove(linkPath);
        await Deno.remove(outsideDir, { recursive: true });
      }
    });

    it("rejects oversized and invalid UTF-8 references", async () => {
      const referencesDir = join(SKILLS_DIR, "veryfront", "references");
      const oversizedName = `${uniqueFixtureName("oversized")}.md`;
      const invalidName = `${uniqueFixtureName("invalid-utf8")}.md`;
      const oversizedPath = join(referencesDir, oversizedName);
      const invalidPath = join(referencesDir, invalidName);
      await Deno.writeFile(oversizedPath, new Uint8Array(4 * 1024 * 1024 + 1));
      await Deno.writeFile(invalidPath, new Uint8Array([0xff, 0xfe, 0xfd]));

      try {
        for (const fileName of [oversizedName, invalidName]) {
          assertEquals(
            await vfGetSkillReference.execute({
              skill: "veryfront",
              reference: `references/${fileName}`,
            }),
            { error: "Skill reference not found." },
          );
        }
      } finally {
        await Deno.remove(oversizedPath);
        await Deno.remove(invalidPath);
      }
    });

    it("does not expose filesystem errors", async () => {
      assertEquals(
        await vfGetSkillReference.execute({
          skill: "veryfront",
          reference: "references/DOES-NOT-EXIST.md",
        }),
        { error: "Skill reference not found." },
      );
    });
  });
});
