import { withCwd } from "#veryfront/testing/cwd.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#std/path.ts";
import { SKILL_NAME_REGEX } from "veryfront/skill";
import { validateSkillDirectory } from "./validate.ts";

async function withTempSkill(
  files: Record<string, string>,
  fn: (dir: string) => Promise<void>,
  skillDirName = "test-skill",
): Promise<void> {
  const rootDir = await Deno.makeTempDir({ prefix: "vf-skill-validate-" });
  const dir = join(rootDir, skillDirName);
  try {
    await Deno.mkdir(dir, { recursive: true });
    for (const [path, content] of Object.entries(files)) {
      const target = join(dir, path);
      await Deno.mkdir(join(target, ".."), { recursive: true });
      await Deno.writeTextFile(target, content);
    }
    await fn(dir);
  } finally {
    await Deno.remove(rootDir, { recursive: true });
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
    }, "code-review");
  });

  it("uses the current directory basename when validating the default path", async () => {
    await withTempSkill({
      "SKILL.md": `---
name: code-review
description: Review code changes.
---

# Code Review

Review the submitted changes.
`,
    }, async (dir) => {
      await withCwd(dir, async () => {
        const issues = await validateSkillDirectory(".");
        assertEquals(issues, []);
      });
    }, "code-review");
  });

  it("reports a missing SKILL.md", async () => {
    await withTempSkill({}, async (dir) => {
      const issues = await validateSkillDirectory(dir);
      assertEquals(issues, [{ severity: "error", message: "SKILL.md not found" }]);
    });
  });

  it("reports invalid canonical directory names without echoing rejected input", async () => {
    await withTempSkill({
      "SKILL.md": `---
description: Invalid directory name.
---

# Bad
`,
    }, async (dir) => {
      const issues = await validateSkillDirectory(dir);
      assertEquals(issues.length, 1);
      assertEquals(issues[0]?.severity, "error");
      assertEquals(
        issues[0]?.message,
        "Invalid skill name: must be 1-64 lowercase alphanumeric characters or single hyphens, without leading or trailing hyphens",
      );
      assertEquals(issues[0]?.message.includes("Bad Name"), false);
    }, "Bad Name");
  });

  it("preserves a legacy display-style frontmatter name", async () => {
    await withTempSkill({
      "SKILL.md": `---
name: Process Email
description: Process inbound email.
---

# Process Email

Process inbound email.
`,
    }, async (dir) => {
      const issues = await validateSkillDirectory(dir);
      assertEquals(issues, []);
    }, "process-email");
  });

  it("treats a loose non-canonical name as display metadata", async () => {
    await withTempSkill({
      "SKILL.md": `---
name: invalid--name
description: Legacy display metadata.
---

# Legacy Display
`,
    }, async (dir) => {
      assertEquals(await validateSkillDirectory(dir), []);
    }, "process-email");
  });

  it("reports SKILL.md frontmatter name mismatch with directory", async () => {
    const originalTest = SKILL_NAME_REGEX.test;
    SKILL_NAME_REGEX.test = () => false;
    try {
      await withTempSkill({
        "SKILL.md": `---
name: email
description: Mismatched name.
---

# Email
`,
      }, async (dir) => {
        const issues = await validateSkillDirectory(dir);
        assertEquals(issues, [{
          severity: "error",
          message: 'Skill name "email" does not match directory name "process-email"',
        }]);
      }, "process-email");
    } finally {
      SKILL_NAME_REGEX.test = originalTest;
    }
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
    }, "empty-body");
  });

  it("uses the same strict metadata contract as runtime discovery", async () => {
    const cases = [
      {
        frontmatter: "description: Missing authored name.",
        expected: 'missing required field "name"',
      },
      {
        frontmatter: [
          "name: strict-skill",
          "description: Strict metadata.",
          "allowed-tools: Read",
          "allowed_tools: Write",
        ].join("\n"),
        expected: "must not declare both",
      },
      {
        frontmatter: [
          "name: strict-skill",
          "description: Strict metadata.",
          "metadata:",
          "  version: 2",
        ].join("\n"),
        expected: "metadata values must be strings",
      },
    ];

    for (const testCase of cases) {
      await withTempSkill({
        "SKILL.md": `---\n${testCase.frontmatter}\n---\n\n# Strict skill\n`,
      }, async (dir) => {
        const issues = await validateSkillDirectory(dir);
        assertEquals(issues.length, 1);
        assertEquals(issues[0]?.severity, "error");
        assertEquals(issues[0]?.message.includes(testCase.expected), true);
      }, "strict-skill");
    }
  });
});
