import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { type SplitSpecifier, splitSpecifierSuffix } from "./specifier-suffix.ts";

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

  it("uses the captured minimum function after project code replaces Math.min", () => {
    const mathMin = Math.min;

    try {
      Math.min = () => {
        throw new Error("poisoned Math.min");
      };

      assertEquals(splitSpecifierSuffix("@/Card.tsx?raw#hero"), {
        path: "@/Card.tsx",
        suffix: "?raw#hero",
      });
    } finally {
      Math.min = mathMin;
    }
  });

  it("uses the captured string primordials after project code replaces String.prototype", () => {
    const stringIndexOf = String.prototype.indexOf;
    const stringSlice = String.prototype.slice;
    let result: SplitSpecifier | null = null;

    try {
      String.prototype.indexOf = () => {
        throw new Error("poisoned String.prototype.indexOf");
      };
      String.prototype.slice = () => {
        throw new Error("poisoned String.prototype.slice");
      };

      result = splitSpecifierSuffix("@/Card.tsx?raw#hero");
    } finally {
      String.prototype.indexOf = stringIndexOf;
      String.prototype.slice = stringSlice;
    }

    // Asserted only after restoration: the assertion library itself formats
    // strings, so it cannot run inside the poisoned window.
    assertEquals(
      result,
      { path: "@/Card.tsx", suffix: "?raw#hero" },
      "splitting must not go through patched String.prototype methods",
    );
  });
});
