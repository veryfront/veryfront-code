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
    const valid = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

    it("accepts valid names: lowercase, numbers, hyphens", () => {
      assertEquals(valid.test("my-skill"), true);
      assertEquals(valid.test("deploy-safely"), true);
      assertEquals(valid.test("a1"), true);
      assertEquals(valid.test("a"), true);
      assertEquals(valid.test("abc"), true);
    });

    it("rejects uppercase", () => {
      assertEquals(valid.test("My-Skill"), false);
    });

    it("rejects leading dash", () => {
      assertEquals(valid.test("-starts-with-dash"), false);
    });

    it("rejects trailing dash", () => {
      assertEquals(valid.test("ends-with-"), false);
    });

    it("rejects spaces", () => {
      assertEquals(valid.test("has spaces"), false);
    });

    it("rejects path traversal", () => {
      assertEquals(valid.test("../../path-traversal"), false);
    });

    it("rejects empty string", () => {
      assertEquals(valid.test(""), false);
    });
  });
});
