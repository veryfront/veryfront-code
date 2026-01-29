import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildRscModules, type GraphIds } from "./manifest.ts";

describe("rendering/rsc/manifest", () => {
  describe("buildRscModules", () => {
    it("should return empty array when graphIds is undefined", async () => {
      const result = await buildRscModules("/project", undefined);
      assertEquals(result, []);
    });

    it("should return empty array when graphIds has no entries", async () => {
      const graphIds: GraphIds = { client: [], server: [] };
      const result = await buildRscModules("/project", graphIds);
      assertEquals(result, []);
    });
  });
});
