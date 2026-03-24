import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("jobs/index.ts exports", () => {
  it("should export the public jobs SDK surface", async () => {
    const mod = await import("./index.ts");

    const expected: Array<[string, string]> = [
      ["VeryfrontJobsClient", "function"],
      ["createJobsClient", "function"],
      ["JobSchema", "object"],
      ["CronJobSchema", "object"],
      ["JobBatchSchema", "object"],
      ["JobTargetDefinitionSchema", "object"],
    ];

    for (const [key, type] of expected) {
      assertExists(mod[key as keyof typeof mod]);
      assertEquals(typeof mod[key as keyof typeof mod], type);
    }
  });
});
