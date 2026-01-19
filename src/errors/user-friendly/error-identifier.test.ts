import { describe, it } from "@veryfront/testing/bdd";
import { expect } from "@std/expect";
import { identifyError } from "./error-identifier.ts";

describe("error-identifier", () => {
  describe("identifyError", () => {
    describe("config errors", () => {
      it("should identify missing config", () => {
        const error = new Error("veryfront.config not found");
        expect(identifyError(error)).toBe("missing-config");
      });

      it("should identify missing config with different casing", () => {
        const error = new Error("Veryfront.Config NOT FOUND");
        expect(identifyError(error)).toBe("missing-config");
      });

      it("should identify invalid config with parse error", () => {
        const error = new Error("Config parse error");
        expect(identifyError(error)).toBe("invalid-config");
      });

      it("should identify invalid config", () => {
        const error = new Error("Invalid config format");
        expect(identifyError(error)).toBe("invalid-config");
      });
    });

    describe("route errors", () => {
      it("should identify invalid route", () => {
        const error = new Error("Invalid route definition");
        expect(identifyError(error)).toBe("invalid-route");
      });

      it("should identify route export error", () => {
        const error = new Error("Route export is invalid");
        expect(identifyError(error)).toBe("invalid-route");
      });
    });

    describe("RSC errors", () => {
      it("should identify client boundary error", () => {
        const error = new Error("Client boundary violation");
        expect(identifyError(error)).toBe("client-boundary");
      });

      it("should identify client-server boundary error", () => {
        const error = new Error("Client component used in server context");
        expect(identifyError(error)).toBe("client-boundary");
      });
    });

    describe("import errors", () => {
      it("should identify import not found", () => {
        const error = new Error("Cannot import module");
        expect(identifyError(error)).toBe("import-not-found");
      });

      it("should identify module not found", () => {
        const error = new Error("Module not found: ./component.ts");
        expect(identifyError(error)).toBe("import-not-found");
      });

      it("should identify resolve error", () => {
        const error = new Error("Failed to resolve module");
        expect(identifyError(error)).toBe("import-not-found");
      });
    });

    describe("port errors", () => {
      it("should identify port in use", () => {
        const error = new Error("Port 3000 is already in use");
        expect(identifyError(error)).toBe("port-in-use");
      });

      it("should identify EADDRINUSE error", () => {
        const error = new Error("EADDRINUSE: port 3000");
        expect(identifyError(error)).toBe("port-in-use");
      });

      it("should handle case variations", () => {
        const error = new Error("Port IN USE");
        expect(identifyError(error)).toBe("port-in-use");
      });
    });

    describe("build errors", () => {
      it("should identify build failed", () => {
        const error = new Error("Build failed with errors");
        expect(identifyError(error)).toBe("build-failed");
      });

      it("should identify build fail", () => {
        const error = new Error("The build will fail");
        expect(identifyError(error)).toBe("build-failed");
      });
    });

    describe("dependency errors", () => {
      it("should identify missing React dependency", () => {
        const error = new Error("React not found");
        expect(identifyError(error)).toBe("missing-deps");
      });

      it("should handle case variations", () => {
        const error = new Error("REACT NOT FOUND");
        expect(identifyError(error)).toBe("missing-deps");
      });
    });

    describe("unknown errors", () => {
      it("should return unknown for unrecognized errors", () => {
        const error = new Error("Something went wrong");
        expect(identifyError(error)).toBe("unknown");
      });

      it("should return unknown for empty error message", () => {
        const error = new Error("");
        expect(identifyError(error)).toBe("unknown");
      });

      it("should return unknown for generic errors", () => {
        const error = new Error("An unexpected error occurred");
        expect(identifyError(error)).toBe("unknown");
      });
    });

    describe("edge cases", () => {
      it("should handle errors with mixed keywords", () => {
        const error = new Error("Config invalid route");
        expect(identifyError(error)).toBe("invalid-config");
      });

      it("should handle complex error messages", () => {
        const error = new Error("Failed to import module: ./component.tsx not found");
        expect(identifyError(error)).toBe("import-not-found");
      });

      it("should be case-insensitive", () => {
        const error1 = new Error("BUILD FAIL");
        const error2 = new Error("build fail");
        const error3 = new Error("Build Fail");

        expect(identifyError(error1)).toBe("build-failed");
        expect(identifyError(error2)).toBe("build-failed");
        expect(identifyError(error3)).toBe("build-failed");
      });

      it("should handle errors with special characters", () => {
        const error = new Error("Port 3000 is in use!!!");
        expect(identifyError(error)).toBe("port-in-use");
      });

      it("should handle multiline error messages", () => {
        const error = new Error("Build failed\nDetails: syntax error in file.ts");
        expect(identifyError(error)).toBe("build-failed");
      });
    });
  });
});
