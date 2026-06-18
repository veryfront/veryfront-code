import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#std/path.ts";
import { CORE_SKILLS } from "./core-skills.ts";
import { listAllSkills, listCoreSkills, listLocalSkills, loadSkill } from "./loader.ts";

async function withTempCwd(
  files: Record<string, string>,
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const original = Deno.cwd();
  const dir = await Deno.makeTempDir({ prefix: "vf-skill-loader-" });
  try {
    for (const [path, content] of Object.entries(files)) {
      const target = join(dir, path);
      await Deno.mkdir(join(target, ".."), { recursive: true });
      await Deno.writeTextFile(target, content);
    }
    Deno.chdir(dir);
    await fn(dir);
  } finally {
    Deno.chdir(original);
    await Deno.remove(dir, { recursive: true });
  }
}

const PROJECT_SKILL = `---
name: code-review
description: Review code changes.
allowed_tools: load_skill load_skill_reference
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
    await withTempCwd({ "skills/code-review/SKILL.md": PROJECT_SKILL }, async (dir) => {
      const skill = await loadSkill(join(dir, "skills", "code-review"));

      assertEquals(skill?.metadata.name, "code-review");
      assertEquals(skill?.metadata.description, "Review code changes.");
      assertEquals(skill?.metadata.allowedTools, ["load_skill", "load_skill_reference"]);
      assertEquals(skill?.metadata.metadata?.version, "1.0");
      assertEquals(skill?.skillMd.includes("# Code Review"), true);
    });
  });

  it("lists project-local skills from skills/<id>/SKILL.md", async () => {
    await withTempCwd({ "skills/code-review/SKILL.md": PROJECT_SKILL }, async () => {
      const skills = await listLocalSkills();

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
    await withTempCwd({
      "skills/deploy-safely/SKILL.md": `---
name: deploy-safely
description: Local deploy skill.
---

# Local Deploy
`,
    }, async () => {
      const all = await listAllSkills();
      const matches = all.filter((skill) => skill.metadata.name === "deploy-safely");

      assertEquals(matches.length, 1);
      assertEquals(matches[0]?.metadata.description, "Local deploy skill.");
    });
  });
});
