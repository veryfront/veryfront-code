import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for MCP skill tools
 */

import { join } from "#std/path.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { SKILL_TEXT_FILE_MAX_BYTES } from "veryfront/skill";
import { SKILL_SUBDIR_MAX_ENTRIES } from "#veryfront/skill/limits.ts";
import {
  createVfGetSkillReference,
  createVfGetSkills,
  vfGetSkillReference,
  vfGetSkills,
} from "./skill-tools.ts";

async function createSkillFixture(
  skillsDir: string,
  name: string,
  options: {
    description?: string;
    body?: string;
    references?: Record<string, string>;
  } = {},
): Promise<string> {
  const skillDir = join(skillsDir, name);
  await Deno.mkdir(skillDir, { recursive: true });
  await Deno.writeTextFile(
    join(skillDir, "SKILL.md"),
    `---
name: ${name}
description: ${options.description ?? "A test skill"}
metadata:
  tools: vf_get_errors, vf_get_logs
---
${options.body ?? "# Test skill\n\nFollow the instructions."}
`,
  );

  const referenceEntries = Object.entries(options.references ?? {});
  if (referenceEntries.length > 0) {
    const referencesDir = join(skillDir, "references");
    await Deno.mkdir(referencesDir, { recursive: true });
    for (const [file, content] of referenceEntries) {
      await Deno.writeTextFile(join(referencesDir, file), content);
    }
  }

  return skillDir;
}

async function withTempSkills(
  run: (input: { root: string; skillsDir: string }) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "veryfront-mcp-skills-" });
  const skillsDir = join(root, "skills");
  await Deno.mkdir(skillsDir, { recursive: true });
  try {
    await run({ root, skillsDir });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
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

    it("loads only canonical, directory-matching skill documents", async () => {
      await withTempSkills(async ({ skillsDir }) => {
        await createSkillFixture(skillsDir, "valid-skill", {
          description: "Validated skill",
          body: "# Valid\n\nUse canonical YAML.",
          references: { "GUIDE.md": "Reference content" },
        });
        await Deno.mkdir(join(skillsDir, "missing-name"), { recursive: true });
        await Deno.writeTextFile(
          join(skillsDir, "missing-name", "SKILL.md"),
          "---\ndescription: Missing name\n---\nInvalid.",
        );
        await Deno.mkdir(join(skillsDir, "mismatched"), { recursive: true });
        await Deno.writeTextFile(
          join(skillsDir, "mismatched", "SKILL.md"),
          "---\nname: another\ndescription: Mismatch\n---\nInvalid.",
        );

        const tool = createVfGetSkills(skillsDir);
        const listed = await tool.execute({});
        assertEquals(listed.skills?.map((skill) => skill.name), ["valid-skill"]);

        const loaded = await tool.execute({ name: "valid-skill" });
        assertEquals(loaded.skill?.description, "Validated skill");
        assertEquals(loaded.skill?.content, "# Valid\n\nUse canonical YAML.");
        assertEquals(loaded.skill?.tools, ["vf_get_errors", "vf_get_logs"]);
        assertEquals(loaded.skill?.references, ["references/GUIDE.md"]);
      });
    });

    it("rejects traversal, absolute paths, and undiscovered skill ids", async () => {
      await withTempSkills(async ({ root, skillsDir }) => {
        await createSkillFixture(skillsDir, "safe-skill");
        await Deno.writeTextFile(join(root, "SKILL.md"), "outside");
        const tool = createVfGetSkills(skillsDir);

        for (const name of ["../safe-skill", join(root, "SKILL.md"), "not-discovered"]) {
          const result = await tool.execute({ name });
          assertEquals(result.skill, undefined);
          assertEquals(typeof result.error, "string");
        }
      });
    });

    it("rejects oversized skill documents before parsing", async () => {
      await withTempSkills(async ({ skillsDir }) => {
        const skillDir = join(skillsDir, "oversized");
        await Deno.mkdir(skillDir, { recursive: true });
        await Deno.writeTextFile(
          join(skillDir, "SKILL.md"),
          `---
name: oversized
description: Oversized
---
${"x".repeat(SKILL_TEXT_FILE_MAX_BYTES)}
`,
        );

        const result = await createVfGetSkills(skillsDir).execute({ name: "oversized" });
        assertEquals(result.skill, undefined);
        assertEquals(typeof result.error, "string");
      });
    });

    it("rejects symlinked skill directories", async () => {
      if (Deno.build.os === "windows") return;

      await withTempSkills(async ({ root, skillsDir }) => {
        const outsideSkillsDir = join(root, "outside");
        await createSkillFixture(outsideSkillsDir, "linked-skill");
        await Deno.symlink(
          join(outsideSkillsDir, "linked-skill"),
          join(skillsDir, "linked-skill"),
        );

        const result = await createVfGetSkills(skillsDir).execute({ name: "linked-skill" });
        assertEquals(result.skill, undefined);
        assertEquals(typeof result.error, "string");
      });
    });

    it("loads one requested skill without scanning unrelated root entries", async () => {
      await withTempSkills(async ({ skillsDir }) => {
        await createSkillFixture(skillsDir, "target-skill", {
          body: "# Target\n\nLoad only this skill.",
          references: { "TARGET.md": "Target reference" },
        });
        for (let index = 0; index < SKILL_SUBDIR_MAX_ENTRIES; index += 1) {
          await Deno.writeTextFile(join(skillsDir, `unrelated-${index}.txt`), "");
        }

        const loaded = await createVfGetSkills(skillsDir).execute({
          name: "target-skill",
        });
        assertEquals(loaded.skill?.content, "# Target\n\nLoad only this skill.");

        const reference = await createVfGetSkillReference(skillsDir).execute({
          skill: "target-skill",
          reference: "references/TARGET.md",
        });
        assertEquals(reference, { content: "Target reference" });
      });
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

    it("loads only exact advertised reference files", async () => {
      await withTempSkills(async ({ skillsDir }) => {
        const skillDir = await createSkillFixture(skillsDir, "safe-skill", {
          references: {
            "PUBLIC.md": "Public reference",
            "PRIVATE.txt": "Not advertised",
          },
        });
        await Deno.writeTextFile(join(skillDir, "PRIVATE.md"), "Outside references");
        const tool = createVfGetSkillReference(skillsDir);

        assertEquals(
          await tool.execute({ skill: "safe-skill", reference: "references/PUBLIC.md" }),
          { content: "Public reference" },
        );

        for (const reference of ["references/PRIVATE.txt", "PRIVATE.md"]) {
          const result = await tool.execute({ skill: "safe-skill", reference });
          assertEquals(result.content, undefined);
          assertEquals(typeof result.error, "string");
        }
      });
    });

    it("rejects traversal and absolute reference paths without reading them", async () => {
      await withTempSkills(async ({ root, skillsDir }) => {
        await createSkillFixture(skillsDir, "safe-skill", {
          references: { "PUBLIC.md": "Public reference" },
        });
        const secretPath = join(root, "secret.md");
        await Deno.writeTextFile(secretPath, "outside secret");
        const tool = createVfGetSkillReference(skillsDir);

        for (
          const input of [
            { skill: "../../..", reference: "secret.md" },
            { skill: "safe-skill", reference: "../../secret.md" },
            { skill: "safe-skill", reference: secretPath },
          ]
        ) {
          const result = await tool.execute(input);
          assertEquals(result.content, undefined);
          assertEquals(typeof result.error, "string");
        }
      });
    });

    it("rejects symlinked references", async () => {
      if (Deno.build.os === "windows") return;

      await withTempSkills(async ({ root, skillsDir }) => {
        const skillDir = await createSkillFixture(skillsDir, "safe-skill", {
          references: { "PUBLIC.md": "Public reference" },
        });
        const secretPath = join(root, "secret.md");
        await Deno.writeTextFile(secretPath, "outside secret");
        await Deno.symlink(secretPath, join(skillDir, "references", "ESCAPE.md"));

        const result = await createVfGetSkillReference(skillsDir).execute({
          skill: "safe-skill",
          reference: "references/ESCAPE.md",
        });
        assertEquals(result.content, undefined);
        assertEquals(typeof result.error, "string");
      });
    });

    it("rejects oversized reference files", async () => {
      await withTempSkills(async ({ skillsDir }) => {
        await createSkillFixture(skillsDir, "safe-skill", {
          references: {
            "TOO-LARGE.md": "x".repeat(SKILL_TEXT_FILE_MAX_BYTES + 1),
          },
        });

        const result = await createVfGetSkillReference(skillsDir).execute({
          skill: "safe-skill",
          reference: "references/TOO-LARGE.md",
        });
        assertEquals(result.content, undefined);
        assertEquals(typeof result.error, "string");
      });
    });
  });
});
