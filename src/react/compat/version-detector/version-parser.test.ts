import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  isReact17,
  isReact18,
  isReact19,
  parseVersion,
  resolveReactDependencyVersion,
} from "./version-parser.ts";

describe("version-parser", () => {
  describe("parseVersion", () => {
    it("parses a standard semver string", () => {
      assertEquals(parseVersion("18.2.0"), { major: 18, minor: 2, patch: 0 });
    });

    it("parses React 19 RC version", () => {
      assertEquals(parseVersion("19.0.0-rc.1"), { major: 19, minor: 0, patch: 0 });
    });

    it("parses React 17", () => {
      assertEquals(parseVersion("17.0.2"), { major: 17, minor: 0, patch: 2 });
    });

    it("throws on invalid version string", () => {
      assertThrows(() => parseVersion("invalid"), Error);
    });

    it("throws on empty string", () => {
      assertThrows(() => parseVersion(""), Error);
    });

    it("rejects trailing data instead of accepting a valid prefix", () => {
      assertThrows(() => parseVersion("19.0.0-not-semver!"), Error);
      assertThrows(() => parseVersion("19.0.0 || 20.0.0"), Error);
    });

    it("rejects non-canonical and unsafe numeric components", () => {
      assertThrows(() => parseVersion("019.0.0"), Error);
      assertThrows(
        () => parseVersion("999999999999999999999999999999.0.0"),
        Error,
      );
    });
  });

  describe("resolveReactDependencyVersion", () => {
    it("resolves exact and inclusive lower-bounded dependency specs", () => {
      assertEquals(resolveReactDependencyVersion("19.1.0"), "19.1.0");
      assertEquals(resolveReactDependencyVersion("^18.2.0"), "18.2.0");
      assertEquals(resolveReactDependencyVersion("~18.3.1"), "18.3.1");
      assertEquals(
        resolveReactDependencyVersion(">=18.2.0 <20.0.0"),
        "18.2.0",
      );
    });

    it("rejects specs without one safe capability baseline", () => {
      for (
        const specifier of [
          "latest",
          "<20.0.0",
          ">18.2.0",
          "^18.2.0 || ^19.0.0",
          "npm:react@19.1.0",
        ]
      ) {
        assertThrows(
          () => resolveReactDependencyVersion(specifier),
          Error,
        );
      }
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

    it("does not classify a React 18 release candidate as React 19", () => {
      assertEquals(isReact19(18, "18.3.0-rc.1"), false);
    });

    it("returns false for stable React 18", () => {
      assertEquals(isReact19(18, "18.2.0"), false);
    });

    it("returns false for React 17", () => {
      assertEquals(isReact19(17, "17.0.2"), false);
    });
  });
});
