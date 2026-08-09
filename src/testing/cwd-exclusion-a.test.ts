import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertExclusiveCwd } from "./cwd-exclusion-probe.ts";

// One half of a pair. See ./cwd-exclusion-probe.ts for why the property under
// test needs two files to be observable at all.
describe("testing/cwd cross-file exclusion (a)", () => {
  it("never shares the working directory with another test file", async () => {
    await assertExclusiveCwd("a");
  });
});
