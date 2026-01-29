import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isReact17, isReact18, isReact19, parseVersion } from "./version-parser.ts";

describe("version-parser", () => {
  describe("parseVersion", () => {
    it("parses a standard semver string", () => {
      const result = parseVersion("18.2.0");
      assertEquals(result, { major: 18, minor: 2, patch: 0 });
    });

    it("parses React 19 RC version", () => {
      const result = parseVersion("19.0.0-rc.1");
      assertEquals(result, { major: 19, minor: 0, patch: 0 });
    });

    it("parses React 17", () => {
      const result = parseVersion("17.0.2");
      assertEquals(result, { major: 17, minor: 0, patch: 2 });
    });

    it("throws on invalid version string", () => {
      assertThrows(
        () => parseVersion("invalid"),
        Error,
      );
    });

    it("throws on empty string", () => {
      assertThrows(
        () => parseVersion(""),
        Error,
      );
    });
  });

  describe("isReact17", () => {
    it("returns true for major 17", () => {
      assertEquals(isReact17(17), true);
    });

    it("returns false for major 18", () => {
      assertEquals(isReact17(18), false);
    });
  });

  describe("isReact18", () => {
    it("returns true for major 18", () => {
      assertEquals(isReact18(18), true);
    });

    it("returns false for major 19", () => {
      assertEquals(isReact18(19), false);
    });
  });

  describe("isReact19", () => {
    it("returns true for major 19", () => {
      assertEquals(isReact19(19, "19.0.0"), true);
    });

    it("returns true for React 18 RC (pre-release of 19)", () => {
      assertEquals(isReact19(18, "18.3.0-rc.1"), true);
    });

    it("returns false for stable React 18", () => {
      assertEquals(isReact19(18, "18.2.0"), false);
    });

    it("returns false for React 17", () => {
      assertEquals(isReact19(17, "17.0.2"), false);
    });
  });
});
