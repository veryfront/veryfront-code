import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#std/path.ts";
import { CORE_SKILLS } from "./core-skills.ts";
import { listAllSkills, listCoreSkills, listLocalSkills, loadSkill } from "./loader.ts";

async function withTempDir(
  files: Record<string, string>,
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "vf-skill-loader-" });
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

const PROJECT_SKILL = `---
name: code-review
description: Review code changes.
allowed-tools: load_skill load_skill_reference
metadata:
  version: "1.0"
---

# Code Review

Review the submitted changes.
`;

describe("Core Skills Embedded Data", () => {
  it("CORE_SKILLS is non-empty", () => {
    assertEquals(CORE_SKILLS.length > 0, true);
  });

  it("all embedded skills have metadata and instructions", () => {
    for (const skill of CORE_SKILLS) {
      assertEquals(typeof skill.metadata.name, "string");
      assertEquals(typeof skill.metadata.description, "string");
      assertEquals(skill.skillMd.length > 0, true);
    }
  });

  it("all embedded skills have unique names", () => {
    const names = CORE_SKILLS.map((s) => s.metadata.name);
    const unique = new Set(names);
    assertEquals(names.length, unique.size, "Duplicate skill names found");
  });
});

describe("Skill Loader", () => {
  it("loads a skill from SKILL.md frontmatter", async () => {
    await withTempDir({ "skills/code-review/SKILL.md": PROJECT_SKILL }, async (dir) => {
      const skill = await loadSkill(join(dir, "skills", "code-review"));

      assertEquals(skill?.metadata.name, "code-review");
      assertEquals(skill?.metadata.description, "Review code changes.");
      assertEquals(skill?.metadata.allowedTools, ["load_skill", "load_skill_reference"]);
      assertEquals(skill?.metadata.metadata?.version, "1.0");
      assertEquals(skill?.skillMd.includes("# Code Review"), true);
    });
  });

  it("does not load a skill whose declared name mismatches its directory", async () => {
    await withTempDir({
      "skills/code-review/SKILL.md": PROJECT_SKILL.replace(
        "name: code-review",
        "name: other-name",
      ),
    }, async (dir) => {
      assertEquals(await loadSkill(join(dir, "skills", "code-review")), null);
    });
  });

  it("preserves a legacy display-style name without changing directory identity", async () => {
    await withTempDir({
      "skills/code-review/SKILL.md": PROJECT_SKILL.replace(
        "name: code-review",
        "name: Code Review",
      ),
    }, async (dir) => {
      const skill = await loadSkill(join(dir, "skills", "code-review"));

      assertEquals(skill?.metadata.name, "code-review");
      assertEquals(skill?.metadata.displayName, "Code Review");
    });
  });

  it("does not load a skill document over the runtime byte budget", async () => {
    await withTempDir({
      "skills/oversized/SKILL.md": "x".repeat(1_048_577),
    }, async (dir) => {
      assertEquals(await loadSkill(join(dir, "skills", "oversized")), null);
    });
  });

  it("lists project-local skills from skills/<id>/SKILL.md", async () => {
    await withTempDir({ "skills/code-review/SKILL.md": PROJECT_SKILL }, async (dir) => {
      const skills = await listLocalSkills(dir);

      assertEquals(skills.map((skill) => skill.metadata.name), ["code-review"]);
    });
  });

  it("listCoreSkills returns built-in SKILL.md directories", async () => {
    const skills = await listCoreSkills();
    const names = skills.map((skill) => skill.metadata.name);

    assertEquals(names.includes("scaffold-app"), true);
    assertEquals(names.includes("deploy-safely"), true);
    assertEquals(names.includes("debug-build"), true);
    assertEquals(names.includes("debug-runtime"), true);
    assertEquals(names.includes("contribute"), true);
    assertEquals(names.includes("scaffold-ai-app"), true);
    assertEquals(names.includes("flywheel"), true);
    assertEquals(names.includes("veryfront"), true);
  });

  it("listAllSkills deduplicates by name with local skills overriding core", async () => {
    await withTempDir({
      "skills/deploy-safely/SKILL.md": `---
name: deploy-safely
description: Local deploy skill.
---

# Local Deploy
`,
    }, async (dir) => {
      const all = await listAllSkills(dir);
      const matches = all.filter((skill) => skill.metadata.name === "deploy-safely");

      assertEquals(matches.length, 1);
      assertEquals(matches[0]?.metadata.description, "Local deploy skill.");
    });
  });
});
