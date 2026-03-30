import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { listSkills } from "./command.ts";

describe("Skills Command", () => {
  it("listSkills returns an array", async () => {
    const skills = await listSkills();
    assertEquals(Array.isArray(skills), true);
  });
});
