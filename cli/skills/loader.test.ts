import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseSkillJson } from "./types.ts";
import { CORE_SKILLS } from "./core-skills.ts";
import { listCoreSkills } from "./loader.ts";

describe("Skill Types", () => {
  describe("parseSkillJson", () => {
    it("parses a valid skill.json", () => {
      const raw = {
        name: "deploy-safely",
        version: "1.0.0",
        description: "Build, test, deploy, verify",
        requires: { cli: ["build", "deploy"], mcp: ["vf_get_errors"] },
        inputs: {
          environment: { type: "string", default: "production" },
        },
      };
      const result = parseSkillJson(raw);
      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.data.name, "deploy-safely");
        assertEquals(result.data.version, "1.0.0");
      }
    });

    it("rejects skill.json missing name", () => {
      const raw = { version: "1.0.0", description: "test" };
      const result = parseSkillJson(raw);
      assertEquals(result.success, false);
    });

    it("returns error string on failure", () => {
      const result = parseSkillJson({});
      assertEquals(result.success, false);
      if (!result.success) {
        assertEquals(typeof result.error, "string");
        assertEquals(result.error.length > 0, true);
      }
    });
  });
});

describe("Core Skills Embedded Data", () => {
  it("CORE_SKILLS is non-empty", () => {
    assertEquals(CORE_SKILLS.length > 0, true);
  });

  it("all embedded skills have valid manifests", () => {
    for (const skill of CORE_SKILLS) {
      const result = parseSkillJson(skill.manifest);
      assertEquals(
        result.success,
        true,
        `Embedded skill "${skill.manifest.name}" has invalid manifest`,
      );
    }
  });

  it("all embedded skills have non-empty skillMd", () => {
    for (const skill of CORE_SKILLS) {
      assertEquals(
        skill.skillMd.length > 0,
        true,
        `Embedded skill "${skill.manifest.name}" has empty skillMd`,
      );
    }
  });

  it("all embedded skills have unique names", () => {
    const names = CORE_SKILLS.map((s) => s.manifest.name);
    const unique = new Set(names);
    assertEquals(names.length, unique.size, "Duplicate skill names found");
  });

  it("expected core skills are present", () => {
    const names = CORE_SKILLS.map((s) => s.manifest.name);
    assertEquals(names.includes("scaffold-app"), true);
    assertEquals(names.includes("deploy-safely"), true);
    assertEquals(names.includes("debug-build"), true);
    assertEquals(names.includes("debug-runtime"), true);
    assertEquals(names.includes("contribute"), true);
    assertEquals(names.includes("scaffold-ai-app"), true);
  });
});

describe("Skill Loader", () => {
  it("listCoreSkills returns skills", async () => {
    const skills = await listCoreSkills();
    assertEquals(Array.isArray(skills), true);
    assertEquals(skills.length > 0, true);
  });

  it("listCoreSkills returns skills with valid structure", async () => {
    const skills = await listCoreSkills();
    for (const skill of skills) {
      assertEquals(typeof skill.manifest.name, "string");
      assertEquals(typeof skill.manifest.version, "string");
      assertEquals(typeof skill.manifest.description, "string");
      assertEquals(typeof skill.skillMd, "string");
      assertEquals(typeof skill.directory, "string");
    }
  });
});
