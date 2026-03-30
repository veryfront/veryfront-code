import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseSkillJson } from "../../skills/types.ts";

describe("Skills Validate", () => {
  describe("schema validation", () => {
    it("validates a correct skill manifest", () => {
      const result = parseSkillJson({
        name: "test",
        version: "1.0.0",
        description: "A test skill",
        requires: { cli: ["build"], mcp: [] },
      });
      assertEquals(result.success, true);
    });

    it("rejects missing required fields", () => {
      const result = parseSkillJson({ version: "1.0.0" });
      assertEquals(result.success, false);
    });

    it("rejects missing name", () => {
      const result = parseSkillJson({
        version: "1.0.0",
        description: "No name",
      });
      assertEquals(result.success, false);
    });

    it("rejects missing version", () => {
      const result = parseSkillJson({
        name: "test",
        description: "No version",
      });
      assertEquals(result.success, false);
    });

    it("rejects missing description", () => {
      const result = parseSkillJson({ name: "test", version: "1.0.0" });
      assertEquals(result.success, false);
    });

    it("accepts skill without requires", () => {
      const result = parseSkillJson({
        name: "simple",
        version: "1.0.0",
        description: "No requirements",
      });
      assertEquals(result.success, true);
    });

    it("accepts skill without inputs", () => {
      const result = parseSkillJson({
        name: "simple",
        version: "1.0.0",
        description: "No inputs",
        requires: { cli: ["build"] },
      });
      assertEquals(result.success, true);
    });

    it("accepts skill with typed inputs", () => {
      const result = parseSkillJson({
        name: "full",
        version: "1.0.0",
        description: "Full skill",
        inputs: {
          env: {
            type: "string",
            default: "production",
            description: "Target env",
          },
        },
      });
      assertEquals(result.success, true);
    });

    it("rejects non-object input", () => {
      const result = parseSkillJson("not an object");
      assertEquals(result.success, false);
    });

    it("rejects null input", () => {
      const result = parseSkillJson(null);
      assertEquals(result.success, false);
    });
  });
});
