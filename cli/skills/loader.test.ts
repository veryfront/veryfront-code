import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { basename, join } from "#std/path.ts";
import { CORE_SKILLS } from "./core-skills.generated.ts";
import {
  listAllSkills,
  listCoreSkills,
  listLocalSkills,
  loadSkill,
  readCoreSkillDocument,
} from "./loader.ts";

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

  it("embeds every cli/mcp/skills directory, references included", async () => {
    const onDisk = (await listCoreSkills())
      .map((skill) => ({ ...skill, directory: `core:${basename(skill.directory)}` }))
      .sort((a, b) => a.directory.localeCompare(b.directory));

    assertEquals(
      CORE_SKILLS,
      onDisk,
      "cli/skills/core-skills.generated.ts is stale; run deno task generate",
    );
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

  it("loads references/*.md next to SKILL.md", async () => {
    await withTempDir({
      "skills/code-review/SKILL.md": PROJECT_SKILL,
      "skills/code-review/references/B.md": "# B",
      "skills/code-review/references/A.md": "# A",
      "skills/code-review/references/notes.txt": "ignored",
    }, async (dir) => {
      const skill = await loadSkill(join(dir, "skills", "code-review"));

      assertEquals(skill?.references, {
        "references/A.md": "# A",
        "references/B.md": "# B",
      });
    });
  });

  it("omits references when a skill has none", async () => {
    await withTempDir({ "skills/code-review/SKILL.md": PROJECT_SKILL }, async (dir) => {
      const skill = await loadSkill(join(dir, "skills", "code-review"));

      assertEquals(skill !== null && "references" in skill, false);
    });
  });

  it("omits references when the references directory has no Markdown files", async () => {
    await withTempDir({
      "skills/code-review/SKILL.md": PROJECT_SKILL,
      "skills/code-review/references/notes.txt": "ignored",
    }, async (dir) => {
      const skill = await loadSkill(join(dir, "skills", "code-review"));

      assertEquals(skill !== null && "references" in skill, false);
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

  it("listCoreSkills falls back to the embedded skills when cli/mcp/skills is not shipped", async () => {
    const skills = await listCoreSkills("/nonexistent/cli/mcp/skills");
    const veryfront = skills.find((skill) => skill.metadata.name === "veryfront");

    assertEquals(veryfront?.directory, "core:veryfront");
    assertEquals(veryfront?.skillMd.includes("veryfront integration connect"), true);
    assertEquals(
      veryfront?.references?.["references/INTEGRATIONS.md"]?.includes("## Recovery"),
      true,
    );
  });

  it("readCoreSkillDocument returns SKILL.md or a reference from the embedded skills", async () => {
    const missingDir = "/nonexistent/cli/mcp/skills";

    assertEquals(
      (await readCoreSkillDocument("flywheel", "SKILL.md", missingDir))?.startsWith("# "),
      true,
    );
    assertEquals(
      (await readCoreSkillDocument("veryfront", "references/ROUTES.md", missingDir))?.length! > 0,
      true,
    );
    assertEquals(await readCoreSkillDocument("veryfront", "../../x.md", missingDir), undefined);
    assertEquals(await readCoreSkillDocument("unknown", "SKILL.md", missingDir), undefined);
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
