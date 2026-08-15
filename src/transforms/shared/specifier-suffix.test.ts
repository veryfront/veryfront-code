import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { splitSpecifierSuffix } from "./specifier-suffix.ts";

describe("transforms/shared/specifier-suffix", () => {
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    ["@/components/Card.tsx", "@/components/Card.tsx", ""],
    ["@/components/Card.tsx?raw", "@/components/Card.tsx", "?raw"],
    ["@/components/Card.tsx#hero", "@/components/Card.tsx", "#hero"],
    ["@/components/Card.tsx?v=1#hero", "@/components/Card.tsx", "?v=1#hero"],
    // Hash before query: the `?` belongs to the fragment, so the cut is at `#`.
    ["@/a#b?c", "@/a", "#b?c"],
    ["/_vf_modules/lib/data.json?v=2", "/_vf_modules/lib/data.json", "?v=2"],
    ["?leading", "", "?leading"],
    ["#leading", "", "#leading"],
    ["", "", ""],
  ];

  for (const [specifier, path, suffix] of cases) {
    it(`splits ${JSON.stringify(specifier)}`, () => {
      assertEquals(splitSpecifierSuffix(specifier), { path, suffix });
    });
  }

  // The three former copies split on whichever delimiter came first. Anything
  // that reassembles to the input is round-trip safe for every caller, which is
  // what lets one definition replace all three.
  it("round-trips path + suffix back to the input", () => {
    for (const [specifier] of cases) {
      const { path, suffix } = splitSpecifierSuffix(specifier);
      assertEquals(`${path}${suffix}`, specifier);
    }
  });
});
