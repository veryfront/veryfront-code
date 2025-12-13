import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertThrows } from "std/assert/mod.ts";
import { parseVersion, isReact17, isReact18, isReact19 } from "./version-parser.ts";

describe("version-parser", () => {
  describe("parseVersion", () => {
    it("should parse valid semver version", () => {
      const result = parseVersion("18.2.0");
      assertEquals(result, { major: 18, minor: 2, patch: 0 });
    });

    it("should parse version with additional info", () => {
      const result = parseVersion("19.0.0-rc.0");
      assertEquals(result, { major: 19, minor: 0, patch: 0 });
    });

    it("should parse React 17 version", () => {
      const result = parseVersion("17.0.2");
      assertEquals(result, { major: 17, minor: 0, patch: 2 });
    });

    it("should throw on invalid version format", () => {
      assertThrows(
        () => parseVersion("invalid"),
        Error,
        "Invalid React version format: invalid",
      );
    });

    it("should throw on empty version string", () => {
      assertThrows(
        () => parseVersion(""),
        Error,
        "Invalid React version format:",
      );
    });

    it("should throw on partial version", () => {
      assertThrows(
        () => parseVersion("18.2"),
        Error,
        "Invalid React version format: 18.2",
      );
    });
  });

  describe("isReact17", () => {
    it("should return true for React 17", () => {
      assertEquals(isReact17(17), true);
    });

    it("should return false for React 18", () => {
      assertEquals(isReact17(18), false);
    });

    it("should return false for React 19", () => {
      assertEquals(isReact17(19), false);
    });

    it("should return false for other versions", () => {
      assertEquals(isReact17(16), false);
      assertEquals(isReact17(20), false);
    });
  });

  describe("isReact18", () => {
    it("should return true for React 18", () => {
      assertEquals(isReact18(18), true);
    });

    it("should return false for React 17", () => {
      assertEquals(isReact18(17), false);
    });

    it("should return false for React 19", () => {
      assertEquals(isReact18(19), false);
    });
  });

  describe("isReact19", () => {
    it("should return true for React 19", () => {
      assertEquals(isReact19(19, "19.0.0"), true);
    });

    it("should return true for React 19 RC versions", () => {
      assertEquals(isReact19(19, "19.0.0-rc.0"), true);
    });

    it("should return false for React 18 RC versions", () => {
      // React 18 RC versions are still React 18, not React 19
      assertEquals(isReact19(18, "18.3.0-rc.0"), false);
    });

    it("should return false for stable React 18", () => {
      assertEquals(isReact19(18, "18.2.0"), false);
    });

    it("should return false for React 17", () => {
      assertEquals(isReact19(17, "17.0.2"), false);
    });
  });
});
