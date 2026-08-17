import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  advanceAllCycleManifestGenerations,
  advanceCycleManifestGeneration,
  getCycleManifestGeneration,
} from "./cycle-manifest-lifecycle.ts";

describe("cycle-manifest lifecycle", () => {
  it("advances a full clear beyond every selectively invalidated namespace", () => {
    const firstDir = `/cache/${crypto.randomUUID()}/first`;
    const secondDir = `/cache/${crypto.randomUUID()}/second`;
    advanceCycleManifestGeneration(firstDir);
    const highestSelectiveGeneration = advanceCycleManifestGeneration(firstDir);
    advanceCycleManifestGeneration(secondDir);

    const fullClearGeneration = advanceAllCycleManifestGenerations();

    assertEquals(fullClearGeneration > highestSelectiveGeneration, true);
    assertEquals(getCycleManifestGeneration(firstDir), fullClearGeneration);
    assertEquals(getCycleManifestGeneration(secondDir), fullClearGeneration);
  });
});
