import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertExclusiveCwd } from "./cwd-exclusion-probe.ts";

// The other half of the pair. See ./cwd-exclusion-probe.ts.
describe("testing/cwd cross-file exclusion (b)", () => {
  it("never shares the working directory with another test file", async () => {
    await assertExclusiveCwd("b");
  });
});
