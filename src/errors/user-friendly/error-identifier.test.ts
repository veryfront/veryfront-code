import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { identifyError } from "./error-identifier.ts";
import { CONFIG_NOT_FOUND, DEPENDENCY_MISSING, INVALID_IMPORT } from "../error-registry.ts";
import { VeryfrontError } from "../types.ts";
import { ERROR_SOLUTIONS } from "./error-catalog.ts";

/**
 * Independent copy of the registry-slug bridge. Every entry must resolve to a
 * key the legacy solution catalog actually publishes, otherwise the user drops
 * to the bare doctor hint instead of the mapped solution.
 */
const BRIDGED_REGISTRY_SLUGS: ReadonlyArray<readonly [string, string]> = [
  ["config-not-found", "missing-config"],
  ["config-invalid", "invalid-config"],
  ["config-parse-error", "invalid-config"],
  ["config-validation-error", "invalid-config"],
  ["config-validation-failed", "invalid-config"],
  ["config-type-error", "invalid-config"],
  ["invalid-route-file", "invalid-route"],
  ["route-handler-invalid", "invalid-route"],
  ["client-boundary-violation", "client-boundary"],
  ["server-only-in-client", "client-boundary"],
  ["client-only-in-server", "client-boundary"],
  ["module-not-found", "import-not-found"],
  ["import-resolution-error", "import-not-found"],
  ["port-in-use", "port-in-use"],
  ["build-failed", "build-failed"],
  ["dependency-missing", "missing-deps"],
];

function testIdentifyError(name: string, message: string, expected: string): void {
  it(name, () => {
    expect(identifyError(new Error(message))).toBe(expected);
  });
}

describe("error-identifier", () => {
  describe("identifyError", () => {
    describe("config errors", () => {
      testIdentifyError(
        "should identify missing config",
        "veryfront.config not found",
        "missing-config",
      );
      testIdentifyError(
        "should identify missing config with different casing",
        "Veryfront.Config NOT FOUND",
        "missing-config",
      );
      testIdentifyError(
        "should identify invalid config with parse error",
        "Config parse error",
        "invalid-config",
      );
      testIdentifyError(
        "should identify invalid config",
        "Invalid config format",
        "invalid-config",
      );
    });

    describe("route errors", () => {
      testIdentifyError(
        "should identify invalid route",
        "Invalid route definition",
        "invalid-route",
      );
      testIdentifyError(
        "should identify route export error",
        "Route export is invalid",
        "invalid-route",
      );
    });

    describe("RSC errors", () => {
      testIdentifyError(
        "should identify client boundary error",
        "Client boundary violation",
        "client-boundary",
      );
      testIdentifyError(
        "should identify client-server boundary error",
        "Client component used in server context",
        "client-boundary",
      );
    });

    describe("import errors", () => {
      testIdentifyError(
        "should identify import not found",
        "Cannot import module",
        "import-not-found",
      );
      testIdentifyError(
        "should identify module not found",
        "Module not found: ./component.ts",
        "import-not-found",
      );
      testIdentifyError(
        "should identify resolve error",
        "Failed to resolve module",
        "import-not-found",
      );
    });

    describe("port errors", () => {
      testIdentifyError(
        "should identify port in use",
        "Port 3000 is already in use",
        "port-in-use",
      );
      testIdentifyError("should identify EADDRINUSE error", "EADDRINUSE: port 3000", "port-in-use");
      testIdentifyError("should handle case variations", "Port IN USE", "port-in-use");
    });

    describe("build errors", () => {
      testIdentifyError("should identify build failed", "Build failed with errors", "build-failed");
      testIdentifyError("should identify build fail", "The build will fail", "build-failed");
    });

    describe("dependency errors", () => {
      testIdentifyError(
        "should identify missing React dependency",
        "React not found",
        "missing-deps",
      );
      testIdentifyError("should handle case variations", "REACT NOT FOUND", "missing-deps");
      testIdentifyError(
        "should prefer the dependency solution for React module errors",
        "React module not found",
        "missing-deps",
      );
    });

    describe("registered errors", () => {
      it("should bridge canonical config slugs to the legacy solution catalog", () => {
        expect(identifyError(CONFIG_NOT_FOUND.create())).toBe("missing-config");
      });

      it("should bridge canonical dependency slugs to the legacy solution catalog", () => {
        expect(identifyError(DEPENDENCY_MISSING.create())).toBe("missing-deps");
      });

      it("should bridge every registered slug to a published solution", () => {
        for (const [slug, expected] of BRIDGED_REGISTRY_SLUGS) {
          const error = new VeryfrontError("unrecognized failure", {
            slug,
            category: "GENERAL",
            status: 500,
            title: "Unrecognized failure",
          });

          assertEquals(identifyError(error), expected, `slug ${slug} must bridge to ${expected}`);
          assertEquals(
            Object.hasOwn(ERROR_SOLUTIONS, expected),
            true,
            `the solution catalog must publish ${expected}`,
          );
        }
      });

      it("should classify registered errors whose slug has no bridge entry by message", () => {
        assertEquals(identifyError(INVALID_IMPORT.create()), "import-not-found");
      });

      it("should classify an unbridged VeryfrontError by its message", () => {
        const error = new VeryfrontError("Port 3000 is already in use", {
          slug: "dev-server-error",
          category: "DEV",
          status: 500,
          title: "Dev server error",
        });

        assertEquals(identifyError(error), "port-in-use");
      });

      it("should not treat inherited object property names as registered solutions", () => {
        for (const slug of ["toString", "constructor", "__proto__"]) {
          const error = new VeryfrontError("unrecognized failure", {
            slug,
            category: "GENERAL",
            status: 500,
            title: "Unrecognized failure",
          });

          expect(identifyError(error)).toBe("unknown");
        }
      });
    });

    describe("unknown errors", () => {
      testIdentifyError(
        "should return unknown for unrecognized errors",
        "Something went wrong",
        "unknown",
      );
      testIdentifyError("should return unknown for empty error message", "", "unknown");
      testIdentifyError(
        "should return unknown for generic errors",
        "An unexpected error occurred",
        "unknown",
      );
    });

    describe("edge cases", () => {
      testIdentifyError(
        "should handle errors with mixed keywords",
        "Config invalid route",
        "invalid-config",
      );
      testIdentifyError(
        "should handle complex error messages",
        "Failed to import module: ./component.tsx not found",
        "import-not-found",
      );

      it("should be case-insensitive", () => {
        expect(identifyError(new Error("BUILD FAIL"))).toBe("build-failed");
        expect(identifyError(new Error("build fail"))).toBe("build-failed");
        expect(identifyError(new Error("Build Fail"))).toBe("build-failed");
      });

      testIdentifyError(
        "should handle errors with special characters",
        "Port 3000 is in use!!!",
        "port-in-use",
      );
      testIdentifyError(
        "should handle multiline error messages",
        "Build failed\nDetails: syntax error in file.ts",
        "build-failed",
      );
    });
  });
});
