import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { identifyError } from "./error-identifier.ts";

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
