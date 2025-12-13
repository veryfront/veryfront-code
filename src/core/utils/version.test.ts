import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assert } from "std/assert/mod.ts";
import { VERSION } from "./version.ts";

describe("utils/version", () => {
  describe("VERSION", () => {
    it("should be a string", () => {
      assertEquals(typeof VERSION, "string");
    });

    it("should not be empty", () => {
      assert(VERSION.length > 0);
    });

    it("should match semver pattern or be 0.0.0", () => {
      const semverPattern = /^\d+\.\d+\.\d+/;
      assert(semverPattern.test(VERSION) || VERSION === "0.0.0");
    });
  });
});
