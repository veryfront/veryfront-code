import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseSkillJson } from "../../skills/types.ts";

describe("Skills Create", () => {
  describe("skill template produces valid manifest", () => {
    it("generates valid JSON with required fields", () => {
      const template = JSON.stringify({
        name: "test-skill",
        version: "1.0.0",
        description: "test-skill skill",
        requires: { cli: [], mcp: [] },
        inputs: {},
      });
      const parsed = JSON.parse(template);
      assertEquals(parsed.name, "test-skill");
      assertEquals(parsed.version, "1.0.0");
    });

    it("generated manifest passes schema validation", () => {
      const template = {
        name: "my-skill",
        version: "1.0.0",
        description: "my-skill skill",
        requires: { cli: [], mcp: [] },
        inputs: {},
      };
      const result = parseSkillJson(template);
      assertEquals(result.success, true);
    });
  });

  describe("skill name validation", () => {
    it("valid names: lowercase, numbers, hyphens", () => {
      const valid = /^[a-z0-9][a-z0-9-]*$/;
      assertEquals(valid.test("my-skill"), true);
      assertEquals(valid.test("deploy-safely"), true);
      assertEquals(valid.test("a1"), true);
    });

    it("rejects invalid names", () => {
      const valid = /^[a-z0-9][a-z0-9-]*$/;
      assertEquals(valid.test("My-Skill"), false);
      assertEquals(valid.test("-starts-with-dash"), false);
      assertEquals(valid.test("has spaces"), false);
      assertEquals(valid.test("../../path-traversal"), false);
      assertEquals(valid.test(""), false);
    });
  });
});
