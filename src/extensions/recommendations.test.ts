import { assertEquals } from "#veryfront/testing/assert.ts";
import { getRecommendation } from "./recommendations.ts";

Deno.test("Skill document parser recommendation points to its first-party extension", () => {
  assertEquals(
    getRecommendation("SkillDocumentParserProvider"),
    "@veryfront/ext-yaml",
  );
});
