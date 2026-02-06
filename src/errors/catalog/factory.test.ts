import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { createErrorSolution, createSimpleError } from "./factory.ts";
import type { ErrorSlug } from "../error-registry.ts";

describe("factory", () => {
  describe("createErrorSolution", () => {
    it("should create error solution with all required fields", () => {
      const solution = createErrorSolution("config-not-found", {
        title: "Configuration file not found",
        message: "Veryfront could not find veryfront.config.js",
      });

      expect(solution).toMatchObject({
        slug: "config-not-found",
        title: "Configuration file not found",
        message: "Veryfront could not find veryfront.config.js",
        docs: "https://veryfront.com/docs/errors/config-not-found",
      });
    });

    it("should create error solution with steps", () => {
      const solution = createErrorSolution("build-failed", {
        title: "Build failed",
        message: "The build process encountered errors",
        steps: ["Check error messages", "Fix TypeScript errors", "Run build again"],
      });

      expect(solution.slug).toBe("build-failed");
      expect(solution.steps).toEqual([
        "Check error messages",
        "Fix TypeScript errors",
        "Run build again",
      ]);
      expect(solution.docs).toBe("https://veryfront.com/docs/errors/build-failed");
    });

    it("should create error solution with example", () => {
      const example = "export default { port: 3000 }";
      const solution = createErrorSolution("config-invalid", {
        title: "Invalid config",
        message: "Configuration is invalid",
        example,
      });

      expect(solution.example).toBe(example);
      expect(solution.docs).toBe("https://veryfront.com/docs/errors/config-invalid");
    });

    it("should create error solution with tips", () => {
      const solution = createErrorSolution("port-in-use", {
        title: "Port already in use",
        message: "The specified port is already in use",
        tips: ["Use a different port", "Stop the other process"],
      });

      expect(solution.tips).toEqual(["Use a different port", "Stop the other process"]);
      expect(solution.docs).toBe("https://veryfront.com/docs/errors/port-in-use");
    });

    it("should create error solution with relatedErrors", () => {
      const solution = createErrorSolution("hydration-mismatch", {
        title: "Hydration mismatch",
        message: "Client and server HTML do not match",
        relatedErrors: ["render-error", "component-error"],
      });

      expect(solution.relatedErrors).toEqual(["render-error", "component-error"]);
      expect(solution.docs).toBe("https://veryfront.com/docs/errors/hydration-mismatch");
    });

    it("should auto-generate docs URL from error slug", () => {
      const solution = createErrorSolution("module-not-found", {
        title: "Module not found",
        message: "The requested module could not be found",
      });

      expect(solution.docs).toBe("https://veryfront.com/docs/errors/module-not-found");
    });

    it("should allow custom docs URL override", () => {
      const customUrl = "https://custom-docs.example.com/errors/custom";
      const solution = createErrorSolution("unknown-error", {
        title: "Unknown error",
        message: "An unknown error occurred",
        docs: customUrl,
      });

      expect(solution.docs).toBe(customUrl);
    });

    it("should preserve all optional fields when provided", () => {
      const solution = createErrorSolution("api-error", {
        title: "API Error",
        message: "API request failed",
        steps: ["Check API endpoint", "Verify authentication"],
        example: 'fetch("/api/data")',
        tips: ["Use correct HTTP method"],
        relatedErrors: ["request-error"],
      });

      expect(solution).toMatchObject({
        slug: "api-error",
        title: "API Error",
        message: "API request failed",
        steps: ["Check API endpoint", "Verify authentication"],
        example: 'fetch("/api/data")',
        tips: ["Use correct HTTP method"],
        relatedErrors: ["request-error"],
        docs: "https://veryfront.com/docs/errors/api-error",
      });
    });

    it("should handle empty steps array", () => {
      const solution = createErrorSolution("timeout-error", {
        title: "Timeout error",
        message: "Operation timed out",
        steps: [],
      });

      expect(solution.steps).toEqual([]);
    });

    it("should handle empty tips array", () => {
      const solution = createErrorSolution("permission-denied", {
        title: "Permission denied",
        message: "Access to resource denied",
        tips: [],
      });

      expect(solution.tips).toEqual([]);
    });

    it("should handle empty relatedErrors array", () => {
      const solution = createErrorSolution("file-not-found", {
        title: "File not found",
        message: "The requested file does not exist",
        relatedErrors: [],
      });

      expect(solution.relatedErrors).toEqual([]);
    });

    it("should work with different error slug categories", () => {
      const cases: Array<[ErrorSlug, string]> = [
        ["config-not-found", "https://veryfront.com/docs/errors/config-not-found"],
        ["build-failed", "https://veryfront.com/docs/errors/build-failed"],
        ["render-error", "https://veryfront.com/docs/errors/render-error"],
        ["route-conflict", "https://veryfront.com/docs/errors/route-conflict"],
        ["module-not-found", "https://veryfront.com/docs/errors/module-not-found"],
        ["port-in-use", "https://veryfront.com/docs/errors/port-in-use"],
        [
          "client-boundary-violation",
          "https://veryfront.com/docs/errors/client-boundary-violation",
        ],
        ["dev-server-error", "https://veryfront.com/docs/errors/dev-server-error"],
        ["deployment-error", "https://veryfront.com/docs/errors/deployment-error"],
        ["unknown-error", "https://veryfront.com/docs/errors/unknown-error"],
      ];

      for (const [slug, docs] of cases) {
        expect(createErrorSolution(slug, { title: "Title", message: "Message" }).docs).toBe(docs);
      }
    });

    it("should handle multiline messages", () => {
      const solution = createErrorSolution("typescript-error", {
        title: "TypeScript error",
        message:
          "TypeScript compilation failed:\n- Type mismatch at line 10\n- Missing return type at line 20",
      });

      expect(solution.message).toContain("\n");
      expect(solution.message).toContain("Type mismatch");
    });

    it("should handle multiline examples", () => {
      const example = `export default {
  port: 3000,
  mode: 'development'
}`;
      const solution = createErrorSolution("config-validation-error", {
        title: "Config validation error",
        message: "Configuration failed validation",
        example,
      });

      expect(solution.example).toContain("\n");
      expect(solution.example).toContain("port: 3000");
    });
  });

  describe("createSimpleError", () => {
    it("should create simple error with minimal config", () => {
      const solution = createSimpleError(
        "build-failed",
        "Build failed",
        "The build process encountered errors",
        ["Check error messages", "Fix TypeScript errors"],
      );

      expect(solution).toMatchObject({
        slug: "build-failed",
        title: "Build failed",
        message: "The build process encountered errors",
        steps: ["Check error messages", "Fix TypeScript errors"],
        docs: "https://veryfront.com/docs/errors/build-failed",
      });
    });

    it("should auto-generate docs URL", () => {
      const solution = createSimpleError(
        "config-not-found",
        "Config not found",
        "Configuration file missing",
        ["Create config file"],
      );

      expect(solution.docs).toBe("https://veryfront.com/docs/errors/config-not-found");
    });

    it("should handle empty steps array", () => {
      const solution = createSimpleError(
        "unknown-error",
        "Unknown error",
        "An unknown error occurred",
        [],
      );

      expect(solution.steps).toEqual([]);
      expect(solution.slug).toBe("unknown-error");
    });

    it("should handle single step", () => {
      const solution = createSimpleError(
        "port-in-use",
        "Port in use",
        "The specified port is already in use",
        ["Use a different port"],
      );

      expect(solution.steps).toEqual(["Use a different port"]);
    });

    it("should handle many steps", () => {
      const steps = [
        "Step 1: Check configuration",
        "Step 2: Verify dependencies",
        "Step 3: Clear cache",
        "Step 4: Restart server",
        "Step 5: Check logs",
      ];
      const solution = createSimpleError(
        "server-start-error",
        "Server start error",
        "Server failed to start",
        steps,
      );

      expect(solution.steps).toEqual(steps);
      expect(solution.steps?.length).toBe(5);
    });

    it("should work with all error slug categories", () => {
      const cases: Array<[ErrorSlug, string]> = [
        ["config-invalid", "https://veryfront.com/docs/errors/config-invalid"],
        ["bundle-error", "https://veryfront.com/docs/errors/bundle-error"],
        ["hydration-mismatch", "https://veryfront.com/docs/errors/hydration-mismatch"],
        ["invalid-route-file", "https://veryfront.com/docs/errors/invalid-route-file"],
        ["import-resolution-error", "https://veryfront.com/docs/errors/import-resolution-error"],
        ["hmr-error", "https://veryfront.com/docs/errors/hmr-error"],
        ["server-only-in-client", "https://veryfront.com/docs/errors/server-only-in-client"],
        ["fast-refresh-error", "https://veryfront.com/docs/errors/fast-refresh-error"],
        ["platform-error", "https://veryfront.com/docs/errors/platform-error"],
        ["invalid-argument", "https://veryfront.com/docs/errors/invalid-argument"],
      ];

      for (const [slug, docs] of cases) {
        expect(createSimpleError(slug, "Title", "Message", ["Step"]).docs).toBe(docs);
      }
    });

    it("should handle special characters in title", () => {
      const solution = createSimpleError(
        "api-error",
        'API Error: "Unauthorized"',
        "Authentication failed",
        ["Check credentials"],
      );

      expect(solution.title).toBe('API Error: "Unauthorized"');
    });

    it("should handle special characters in message", () => {
      const solution = createSimpleError(
        "file-not-found",
        "File not found",
        "Cannot find file at path: /home/user/project/file.tsx",
        ["Check file path"],
      );

      expect(solution.message).toContain("/home/user/project/file.tsx");
    });

    it("should handle special characters in steps", () => {
      const solution = createSimpleError(
        "route-handler-invalid",
        "Route handler invalid",
        "Route handler is not valid",
        ["Export default function", "Use correct signature: (req, res) => {}"],
      );

      expect(solution.steps).toContain("Use correct signature: (req, res) => {}");
    });
  });

  describe("integration", () => {
    it("should produce identical results when used equivalently", () => {
      const steps = ["Check error messages", "Fix errors"];

      const simple = createSimpleError(
        "build-failed",
        "Build failed",
        "The build process encountered errors",
        steps,
      );

      const full = createErrorSolution("build-failed", {
        title: "Build failed",
        message: "The build process encountered errors",
        steps,
      });

      expect(simple).toMatchObject({
        slug: full.slug,
        title: full.title,
        message: full.message,
        steps: full.steps,
        docs: full.docs,
      });
    });

    it("should createSimpleError use createErrorSolution internally", () => {
      const simple = createSimpleError(
        "module-not-found",
        "Module not found",
        "Cannot find module",
        ["Check import path"],
      );

      for (const key of ["slug", "title", "message", "steps", "docs"] as const) {
        expect(simple).toHaveProperty(key);
      }
    });

    it("should both functions generate correct docs URLs", () => {
      const simple = createSimpleError(
        "config-not-found",
        "Config not found",
        "Config missing",
        ["Create config"],
      );
      const full = createErrorSolution("config-not-found", {
        title: "Config not found",
        message: "Config missing",
      });

      expect(simple.docs).toBe("https://veryfront.com/docs/errors/config-not-found");
      expect(full.docs).toBe("https://veryfront.com/docs/errors/config-not-found");
      expect(simple.docs).toBe(full.docs);
    });

    it("should handle real-world error scenarios", () => {
      const configError = createErrorSolution("config-not-found", {
        title: "Configuration file not found",
        message: "Veryfront could not find veryfront.config.js in your project root",
        steps: [
          "Create veryfront.config.js in your project root",
          'Run "veryfront init" to generate a default configuration',
          "Or specify a custom config path with --config flag",
        ],
        example: 'export default { port: 3000, mode: "development" }',
        tips: ["Make sure you are in the correct directory", "Check file permissions"],
      });

      expect(configError.slug).toBe("config-not-found");
      expect(configError.steps?.length).toBe(3);
      expect(configError.tips?.length).toBe(2);

      const buildError = createSimpleError(
        "typescript-error",
        "TypeScript compilation failed",
        "Found 5 type errors in your code",
        ["Fix type errors shown below", 'Run "tsc --noEmit" to check types'],
      );

      expect(buildError.slug).toBe("typescript-error");
      expect(buildError.steps?.length).toBe(2);

      const runtimeError = createErrorSolution("hydration-mismatch", {
        title: "Hydration mismatch detected",
        message: "The HTML rendered on the server does not match the client",
        steps: [
          "Check for client-only APIs used during SSR",
          "Ensure Date.now() or Math.random() are not used directly",
          "Use useEffect for client-only code",
        ],
        relatedErrors: ["render-error", "component-error"],
        docs: "https://veryfront.com/docs/errors/hydration-mismatch#hydration",
      });

      expect(runtimeError.relatedErrors?.length).toBe(2);
      expect(runtimeError.docs).toBe(
        "https://veryfront.com/docs/errors/hydration-mismatch#hydration",
      );
    });
  });
});
