import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { compareVersions, shouldSkip } from "./update-check.ts";

describe("update-check", () => {
  describe("compareVersions", () => {
    it("detects newer major version", () => {
      assertEquals(compareVersions("1.0.0", "2.0.0"), true);
    });

    it("detects newer minor version", () => {
      assertEquals(compareVersions("1.2.0", "1.3.0"), true);
    });

    it("detects newer patch version", () => {
      assertEquals(compareVersions("1.2.3", "1.2.4"), true);
    });

    it("returns false for same version", () => {
      assertEquals(compareVersions("1.2.3", "1.2.3"), false);
    });

    it("returns false for older version", () => {
      assertEquals(compareVersions("2.0.0", "1.0.0"), false);
    });

    it("handles version with fewer segments", () => {
      assertEquals(compareVersions("1.0", "1.1"), true);
    });
  });

  describe("shouldSkip", () => {
    it("returns a boolean", () => {
      assertEquals(typeof shouldSkip(), "boolean");
    });
  });
});
