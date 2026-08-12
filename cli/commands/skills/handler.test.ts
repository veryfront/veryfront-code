import "#veryfront/schemas/_test-setup.ts";
import { fromFileUrl } from "#veryfront/compat/path/index.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getSkillInfo, listSkills } from "./command.ts";

describe("Skills Command", () => {
  const repositoryRoot = fromFileUrl(new URL("../../../", import.meta.url));

  async function runSkillsInfo(
    args: string[],
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const cliPath = fromFileUrl(new URL("../../main.ts", import.meta.url));
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", cliPath, "skills", "info", ...args, "--json"],
      cwd: repositoryRoot,
      env: { VERYFRONT_NO_UPDATE_CHECK: "1", NO_COLOR: "1" },
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).output();
    const decoder = new TextDecoder();

    return {
      code: result.code,
      stdout: decoder.decode(result.stdout),
      stderr: decoder.decode(result.stderr),
    };
  }

  describe("info JSON output", () => {
    it("returns a usage envelope when the skill name is missing", async () => {
      const result = await runSkillsInfo([]);

      assertEquals(result.code, 2);
      assertEquals(result.stderr, "");
      assertEquals(JSON.parse(result.stdout), {
        success: false,
        command: "skills",
        error: {
          code: "INVALID_ARGUMENT",
          slug: "invalid-argument",
          message: "Usage: veryfront skills info <name>",
        },
      });
    });

    it("returns a not-found envelope for an unknown skill", async () => {
      const result = await runSkillsInfo(["nonexistent-skill-xyz"]);

      assertEquals(result.code, 1);
      assertEquals(result.stderr, "");
      assertEquals(JSON.parse(result.stdout), {
        success: false,
        command: "skills",
        error: {
          code: "NOT_FOUND",
          slug: "skill-not-found",
          message: 'Skill "nonexistent-skill-xyz" not found',
          context: {
            suggestion: "Try: veryfront skills list",
          },
        },
      });
    });
  });

  describe("listSkills", () => {
    it("returns an array", async () => {
      const skills = await listSkills();
      assertEquals(Array.isArray(skills), true);
    });

    it("returns core skills with required fields", async () => {
      const skills = await listSkills();
      for (const skill of skills) {
        assertEquals(typeof skill.metadata.name, "string");
        assertEquals(typeof skill.metadata.description, "string");
        assertEquals(skill.metadata.name.length > 0, true);
      }
    });

    it("includes expected core skills", async () => {
      const skills = await listSkills();
      const names = skills.map((s) => s.metadata.name);
      assertEquals(names.includes("scaffold-app"), true);
      assertEquals(names.includes("deploy-safely"), true);
      assertEquals(names.includes("contribute"), true);
      assertEquals(names.includes("veryfront"), true);
    });
  });

  describe("getSkillInfo", () => {
    it("returns a skill by name", async () => {
      const skill = await getSkillInfo("scaffold-app");
      assertEquals(skill !== null, true);
      assertEquals(skill?.metadata.name, "scaffold-app");
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
