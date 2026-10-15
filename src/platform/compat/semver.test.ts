import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { satisfies, valid, versionAdmission } from "./semver.ts";

describe("shared semantic version admission", () => {
  it("distinguishes unevaluable tags from a rejected range and normalizes exact version prefixes", () => {
    assertEquals(versionAdmission("v19.2.4", "^18.0.0"), false);
    assertEquals(versionAdmission("v19.2.4", "^19.2.0"), true);
    assertEquals(versionAdmission("19.2.4", "latest"), null);
    assertEquals(versionAdmission("invalid", "latest"), false);
  });
  it("preserves exact version validation", () => {
    for (const value of ["19.2.4", "v19.2.4", "19.2.4-rc.1+build"]) {
      assertEquals(valid(value), true);
    }
    for (const value of ["19.2", "^19.2.4", "01.2.4", "19.2.4-01", "19.2.4+", "invalid"]) {
      assertEquals(valid(value), false);
    }
  });
  for (
    const [version, range, expected] of [
      ["19.2.4", "^19.2.0", true],
      ["19.2.4", "~19.2.0", true],
      ["19.2.4", "19.x", true],
      ["19.2.4", "19", true],
      ["19.2.4", ">=19.2.0 <20.0.0", true],
      ["19.2.4", "18 || 19", true],
      ["19.2.4", "19.2.0 - 19.2.4", true],
      ["19.2.4", "^v19.2.0", true],
      ["19.2.4", ">=v19.2.0", true],
      ["0.0.4", "^0.0.3", false],
      ["19.2.4-rc.1", "^19.2.0", false],
      ["19.2.4-rc.1", "^19.2.4-rc.0", true],
      ["19.2.4", "workspace:*", false],
      ["19.2.4", "latest", false],
      ["19.2.4", "not-a-range", false],
      ["invalid", "*", false],
    ] as const
  ) {
    it(`${version} satisfies ${range}: ${expected}`, () =>
      assertEquals(satisfies(version, range), expected));
  }
});
