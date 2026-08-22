import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { digestWorkerGenerationMaterial } from "./worker-generation.ts";

describe("worker generation hashing on portable runtimes", () => {
  it("hashes exact UTF-16 code units without Uint8Array proposal methods", async () => {
    assertEquals(
      await digestWorkerGenerationMaterial("release-a"),
      "d457ae345861ae4ee18a1047f1a9e9c30b66a56e6d602c6c026ec85f5d7f83a4",
    );
    assertEquals(
      await digestWorkerGenerationMaterial("\ud800"),
      "6e6535d29be7bfac2971dc0853620d739dd43a62c41409d21d39ccb9b29e224b",
    );
    assertNotEquals(
      await digestWorkerGenerationMaterial("\ud800"),
      await digestWorkerGenerationMaterial("\ufffd"),
    );
  });
});
