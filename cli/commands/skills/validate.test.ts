import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#std/path.ts";
import { validateSkillDirectory } from "./validate.ts";

async function withTempSkill(
  files: Record<string, string>,
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "vf-skill-validate-" });
  try {
    for (const [path, content] of Object.entries(files)) {
      const target = join(dir, path);
      await Deno.mkdir(join(target, ".."), { recursive: true });
      await Deno.writeTextFile(target, content);
    }
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

describe("Skills Validate", () => {
  it("accepts a project skill with SKILL.md frontmatter", async () => {
    await withTempSkill({
      "SKILL.md": `---
name: code-review
description: Review code changes.
allowed_tools: load_skill load_skill_reference
---

# Code Review

Review the submitted changes.
`,
    }, async (dir) => {
      const issues = await validateSkillDirectory(dir);
      assertEquals(issues, []);
    });
  });

  it("reports a missing SKILL.md", async () => {
    await withTempSkill({}, async (dir) => {
      const issues = await validateSkillDirectory(dir);
      assertEquals(issues, [{ severity: "error", message: "SKILL.md not found" }]);
    });
  });

  it("reports invalid SKILL.md frontmatter", async () => {
    await withTempSkill({
      "SKILL.md": `---
name: BadName
description: Invalid name.
---

# Bad
`,
    }, async (dir) => {
      const issues = await validateSkillDirectory(dir);
      assertEquals(issues.length, 1);
      assertEquals(issues[0]?.severity, "error");
      assertEquals(issues[0]?.message.includes("Invalid skill name"), true);
    });
  });

  it("warns when SKILL.md has no instruction body", async () => {
    await withTempSkill({
      "SKILL.md": `---
name: empty-body
description: Empty instruction body.
---
`,
    }, async (dir) => {
      const issues = await validateSkillDirectory(dir);
      assertEquals(issues, [{ severity: "warning", message: "SKILL.md body is empty" }]);
    });
  });
});
