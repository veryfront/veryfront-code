import "#veryfront/schemas/_test-setup.ts";
import { fromFileUrl } from "#veryfront/compat/path/index.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getSkillInfo, listSkills } from "./command.ts";

describe("Skills Command", () => {
  const repositoryRoot = fromFileUrl(new URL("../../../", import.meta.url));

  /**
   * Run the CLI the way these tests mean to read it: `--quiet` so the child's
   * stderr carries the command's output and nothing else.
   *
   * Without it the stderr assertions below are not only about the CLI. A child
   * whose dependencies are not all present locally first resolves them --
   * `nodeModulesDir` is `auto`, so it reconciles `node_modules/` against
   * `cli/main.ts`'s graph -- and it narrates that work on stderr: `Download
   * https://registry.npmjs.org/yaml`. Nothing in this repository's CI puts
   * `yaml` where the child would find it. The cache is warmed from
   * `src/index.ts`, and `yaml` reaches the CLI only through `cli/main.ts` (via
   * `@opentelemetry/configuration` and `bash-tool`), so it is in neither the
   * warmed blob nor the test process's own graph; whether a shard paid for the
   * fetch came down to which cache entry the runner happened to restore. That
   * is why this file failed on pull requests that cannot reach this code.
   *
   * `--quiet` suppresses only the runtime's own diagnostics. Anything the CLI
   * writes to stderr still arrives -- `veryfront skills info` with no name and
   * no `--json` still reports `✗ Usage: veryfront skills info <name>` under it
   * -- so the assertions still hold the command to a silent stderr.
   */
  async function runSkillsInfo(
    args: string[],
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const cliPath = fromFileUrl(new URL("../../main.ts", import.meta.url));
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", "--quiet", cliPath, "skills", "info", ...args, "--json"],
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
