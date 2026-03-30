import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseSkillJson } from "../../skills/types.ts";

describe("Skills Validate", () => {
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

  it("accepts skill without requires", () => {
    const result = parseSkillJson({
      name: "simple",
      version: "1.0.0",
      description: "No requirements",
    });
    assertEquals(result.success, true);
  });
});
