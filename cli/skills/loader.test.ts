import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseSkillJson } from "./types.ts";

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
  });
});
