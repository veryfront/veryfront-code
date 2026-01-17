import { describe, it } from "@std/testing/bdd.ts";
import { expect } from "@std/expect";
import { createErrorSolution, createSimpleError } from "./factory.ts";
import { ErrorCode } from "../error-codes.ts";

describe("factory", () => {
  describe("createErrorSolution", () => {
    it("should create error solution with all required fields", () => {
      const solution = createErrorSolution(ErrorCode.CONFIG_NOT_FOUND, {
        title: "Configuration file not found",
        message: "Veryfront could not find veryfront.config.js",
      });

      expect(solution.code).toBe(ErrorCode.CONFIG_NOT_FOUND);
      expect(solution.title).toBe("Configuration file not found");
      expect(solution.message).toBe("Veryfront could not find veryfront.config.js");
      expect(solution.docs).toBe("https://veryfront.com/docs/errors/VF001");
    });

    it("should create error solution with steps", () => {
      const solution = createErrorSolution(ErrorCode.BUILD_FAILED, {
        title: "Build failed",
        message: "The build process encountered errors",
        steps: ["Check error messages", "Fix TypeScript errors", "Run build again"],
      });

      expect(solution.code).toBe(ErrorCode.BUILD_FAILED);
      expect(solution.steps).toEqual([
        "Check error messages",
        "Fix TypeScript errors",
        "Run build again",
      ]);
      expect(solution.docs).toBe("https://veryfront.com/docs/errors/VF100");
    });

    it("should create error solution with example", () => {
      const example = "export default { port: 3000 }";
      const solution = createErrorSolution(ErrorCode.CONFIG_INVALID, {
        title: "Invalid config",
        message: "Configuration is invalid",
        example,
      });

      expect(solution.example).toBe(example);
      expect(solution.docs).toBe("https://veryfront.com/docs/errors/VF002");
    });

    it("should create error solution with tips", () => {
      const solution = createErrorSolution(ErrorCode.PORT_IN_USE, {
        title: "Port already in use",
        message: "The specified port is already in use",
        tips: ["Use a different port", "Stop the other process"],
      });

      expect(solution.tips).toEqual(["Use a different port", "Stop the other process"]);
      expect(solution.docs).toBe("https://veryfront.com/docs/errors/VF500");
    });

    it("should create error solution with relatedErrors", () => {
      const solution = createErrorSolution(ErrorCode.HYDRATION_MISMATCH, {
        title: "Hydration mismatch",
        message: "Client and server HTML do not match",
        relatedErrors: [ErrorCode.RENDER_ERROR, ErrorCode.COMPONENT_ERROR],
      });

      expect(solution.relatedErrors).toEqual([ErrorCode.RENDER_ERROR, ErrorCode.COMPONENT_ERROR]);
      expect(solution.docs).toBe("https://veryfront.com/docs/errors/VF200");
    });

    it("should auto-generate docs URL from error code", () => {
      const solution = createErrorSolution(ErrorCode.MODULE_NOT_FOUND, {
        title: "Module not found",
        message: "The requested module could not be found",
      });

      expect(solution.docs).toBe("https://veryfront.com/docs/errors/VF400");
    });

    it("should allow custom docs URL override", () => {
      const customUrl = "https://custom-docs.example.com/errors/custom";
      const solution = createErrorSolution(ErrorCode.UNKNOWN_ERROR, {
        title: "Unknown error",
        message: "An unknown error occurred",
        docs: customUrl,
      });

      expect(solution.docs).toBe(customUrl);
    });

    it("should preserve all optional fields when provided", () => {
      const solution = createErrorSolution(ErrorCode.API_ERROR, {
        title: "API Error",
        message: "API request failed",
        steps: ["Check API endpoint", "Verify authentication"],
        example: 'fetch("/api/data")',
        tips: ["Use correct HTTP method"],
        relatedErrors: [ErrorCode.REQUEST_ERROR],
      });

      expect(solution.code).toBe(ErrorCode.API_ERROR);
      expect(solution.title).toBe("API Error");
      expect(solution.message).toBe("API request failed");
      expect(solution.steps).toEqual(["Check API endpoint", "Verify authentication"]);
      expect(solution.example).toBe('fetch("/api/data")');
      expect(solution.tips).toEqual(["Use correct HTTP method"]);
      expect(solution.relatedErrors).toEqual([ErrorCode.REQUEST_ERROR]);
      expect(solution.docs).toBe("https://veryfront.com/docs/errors/VF205");
    });

    it("should handle empty steps array", () => {
      const solution = createErrorSolution(ErrorCode.TIMEOUT_ERROR, {
        title: "Timeout error",
        message: "Operation timed out",
        steps: [],
      });

      expect(solution.steps).toEqual([]);
    });

    it("should handle empty tips array", () => {
      const solution = createErrorSolution(ErrorCode.PERMISSION_DENIED, {
        title: "Permission denied",
        message: "Access to resource denied",
        tips: [],
      });

      expect(solution.tips).toEqual([]);
    });

    it("should handle empty relatedErrors array", () => {
      const solution = createErrorSolution(ErrorCode.FILE_NOT_FOUND, {
        title: "File not found",
        message: "The requested file does not exist",
        relatedErrors: [],
      });

      expect(solution.relatedErrors).toEqual([]);
    });

    it("should work with different error code categories", () => {
      const configSolution = createErrorSolution(ErrorCode.CONFIG_NOT_FOUND, {
        title: "Config not found",
        message: "Config missing",
      });
      expect(configSolution.docs).toBe("https://veryfront.com/docs/errors/VF001");

      const buildSolution = createErrorSolution(ErrorCode.BUILD_FAILED, {
        title: "Build failed",
        message: "Build error",
      });
      expect(buildSolution.docs).toBe("https://veryfront.com/docs/errors/VF100");

      const runtimeSolution = createErrorSolution(ErrorCode.RENDER_ERROR, {
        title: "Render error",
        message: "Rendering failed",
      });
      expect(runtimeSolution.docs).toBe("https://veryfront.com/docs/errors/VF201");

      const routeSolution = createErrorSolution(ErrorCode.ROUTE_CONFLICT, {
        title: "Route conflict",
        message: "Conflicting routes",
      });
      expect(routeSolution.docs).toBe("https://veryfront.com/docs/errors/VF300");

      const importSolution = createErrorSolution(ErrorCode.MODULE_NOT_FOUND, {
        title: "Module not found",
        message: "Module missing",
      });
      expect(importSolution.docs).toBe("https://veryfront.com/docs/errors/VF400");

      const serverSolution = createErrorSolution(ErrorCode.PORT_IN_USE, {
        title: "Port in use",
        message: "Port already taken",
      });
      expect(serverSolution.docs).toBe("https://veryfront.com/docs/errors/VF500");

      const rscSolution = createErrorSolution(ErrorCode.CLIENT_BOUNDARY_VIOLATION, {
        title: "Client boundary violation",
        message: "Invalid client component usage",
      });
      expect(rscSolution.docs).toBe("https://veryfront.com/docs/errors/VF600");

      const devSolution = createErrorSolution(ErrorCode.DEV_SERVER_ERROR, {
        title: "Dev server error",
        message: "Dev server failed",
      });
      expect(devSolution.docs).toBe("https://veryfront.com/docs/errors/VF700");

      const deploySolution = createErrorSolution(ErrorCode.DEPLOYMENT_ERROR, {
        title: "Deployment error",
        message: "Deployment failed",
      });
      expect(deploySolution.docs).toBe("https://veryfront.com/docs/errors/VF800");

      const generalSolution = createErrorSolution(ErrorCode.UNKNOWN_ERROR, {
        title: "Unknown error",
        message: "Unknown error occurred",
      });
      expect(generalSolution.docs).toBe("https://veryfront.com/docs/errors/VF900");
    });

    it("should handle multiline messages", () => {
      const solution = createErrorSolution(ErrorCode.TYPESCRIPT_ERROR, {
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
      const solution = createErrorSolution(ErrorCode.CONFIG_VALIDATION_ERROR, {
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
        ErrorCode.BUILD_FAILED,
        "Build failed",
        "The build process encountered errors",
        ["Check error messages", "Fix TypeScript errors"],
      );

      expect(solution.code).toBe(ErrorCode.BUILD_FAILED);
      expect(solution.title).toBe("Build failed");
      expect(solution.message).toBe("The build process encountered errors");
      expect(solution.steps).toEqual(["Check error messages", "Fix TypeScript errors"]);
      expect(solution.docs).toBe("https://veryfront.com/docs/errors/VF100");
    });

    it("should auto-generate docs URL", () => {
      const solution = createSimpleError(
        ErrorCode.CONFIG_NOT_FOUND,
        "Config not found",
        "Configuration file missing",
        ["Create config file"],
      );

      expect(solution.docs).toBe("https://veryfront.com/docs/errors/VF001");
    });

    it("should handle empty steps array", () => {
      const solution = createSimpleError(
        ErrorCode.UNKNOWN_ERROR,
        "Unknown error",
        "An unknown error occurred",
        [],
      );

      expect(solution.steps).toEqual([]);
      expect(solution.code).toBe(ErrorCode.UNKNOWN_ERROR);
    });

    it("should handle single step", () => {
      const solution = createSimpleError(
        ErrorCode.PORT_IN_USE,
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
        ErrorCode.SERVER_START_ERROR,
        "Server start error",
        "Server failed to start",
        steps,
      );

      expect(solution.steps).toEqual(steps);
      expect(solution.steps?.length).toBe(5);
    });

    it("should work with all error code categories", () => {
      const configs = createSimpleError(
        ErrorCode.CONFIG_INVALID,
        "Config invalid",
        "Invalid config",
        ["Fix config"],
      );
      expect(configs.docs).toBe("https://veryfront.com/docs/errors/VF002");

      const build = createSimpleError(ErrorCode.BUNDLE_ERROR, "Bundle error", "Bundle failed", [
        "Check bundle",
      ]);
      expect(build.docs).toBe("https://veryfront.com/docs/errors/VF101");

      const runtime = createSimpleError(
        ErrorCode.HYDRATION_MISMATCH,
        "Hydration mismatch",
        "Mismatch detected",
        ["Fix HTML"],
      );
      expect(runtime.docs).toBe("https://veryfront.com/docs/errors/VF200");

      const route = createSimpleError(
        ErrorCode.INVALID_ROUTE_FILE,
        "Invalid route",
        "Route invalid",
        ["Fix route"],
      );
      expect(route.docs).toBe("https://veryfront.com/docs/errors/VF301");

      const importErr = createSimpleError(
        ErrorCode.IMPORT_RESOLUTION_ERROR,
        "Import error",
        "Import failed",
        ["Check import"],
      );
      expect(importErr.docs).toBe("https://veryfront.com/docs/errors/VF401");

      const server = createSimpleError(ErrorCode.HMR_ERROR, "HMR error", "HMR failed", [
        "Restart dev server",
      ]);
      expect(server.docs).toBe("https://veryfront.com/docs/errors/VF502");

      const rsc = createSimpleError(
        ErrorCode.SERVER_ONLY_IN_CLIENT,
        "Server-only in client",
        "Invalid usage",
        ["Remove server code"],
      );
      expect(rsc.docs).toBe("https://veryfront.com/docs/errors/VF601");

      const dev = createSimpleError(
        ErrorCode.FAST_REFRESH_ERROR,
        "Fast refresh error",
        "Refresh failed",
        ["Reload page"],
      );
      expect(dev.docs).toBe("https://veryfront.com/docs/errors/VF701");

      const deploy = createSimpleError(
        ErrorCode.PLATFORM_ERROR,
        "Platform error",
        "Platform failed",
        ["Check platform"],
      );
      expect(deploy.docs).toBe("https://veryfront.com/docs/errors/VF801");

      const general = createSimpleError(
        ErrorCode.INVALID_ARGUMENT,
        "Invalid argument",
        "Argument invalid",
        ["Check arguments"],
      );
      expect(general.docs).toBe("https://veryfront.com/docs/errors/VF903");
    });

    it("should handle special characters in title", () => {
      const solution = createSimpleError(
        ErrorCode.API_ERROR,
        'API Error: "Unauthorized"',
        "Authentication failed",
        ["Check credentials"],
      );

      expect(solution.title).toBe('API Error: "Unauthorized"');
    });

    it("should handle special characters in message", () => {
      const solution = createSimpleError(
        ErrorCode.FILE_NOT_FOUND,
        "File not found",
        "Cannot find file at path: /home/user/project/file.tsx",
        ["Check file path"],
      );

      expect(solution.message).toContain("/home/user/project/file.tsx");
    });

    it("should handle special characters in steps", () => {
      const solution = createSimpleError(
        ErrorCode.ROUTE_HANDLER_INVALID,
        "Route handler invalid",
        "Route handler is not valid",
        ["Export default function", "Use correct signature: (req, res) => {}"],
      );

      expect(solution.steps).toContain("Use correct signature: (req, res) => {}");
    });
  });

  describe("integration", () => {
    it("should produce identical results when used equivalently", () => {
      const simple = createSimpleError(
        ErrorCode.BUILD_FAILED,
        "Build failed",
        "The build process encountered errors",
        ["Check error messages", "Fix errors"],
      );

      const full = createErrorSolution(ErrorCode.BUILD_FAILED, {
        title: "Build failed",
        message: "The build process encountered errors",
        steps: ["Check error messages", "Fix errors"],
      });

      expect(simple.code).toBe(full.code);
      expect(simple.title).toBe(full.title);
      expect(simple.message).toBe(full.message);
      expect(simple.steps).toEqual(full.steps);
      expect(simple.docs).toBe(full.docs);
    });

    it("should createSimpleError use createErrorSolution internally", () => {
      const simple = createSimpleError(
        ErrorCode.MODULE_NOT_FOUND,
        "Module not found",
        "Cannot find module",
        ["Check import path"],
      );

      expect(simple).toHaveProperty("code");
      expect(simple).toHaveProperty("title");
      expect(simple).toHaveProperty("message");
      expect(simple).toHaveProperty("steps");
      expect(simple).toHaveProperty("docs");
    });

    it("should both functions generate correct docs URLs", () => {
      const simple = createSimpleError(
        ErrorCode.CONFIG_NOT_FOUND,
        "Config not found",
        "Config missing",
        ["Create config"],
      );
      const full = createErrorSolution(ErrorCode.CONFIG_NOT_FOUND, {
        title: "Config not found",
        message: "Config missing",
      });

      expect(simple.docs).toBe("https://veryfront.com/docs/errors/VF001");
      expect(full.docs).toBe("https://veryfront.com/docs/errors/VF001");
      expect(simple.docs).toBe(full.docs);
    });

    it("should handle real-world error scenarios", () => {
      const configError = createErrorSolution(ErrorCode.CONFIG_NOT_FOUND, {
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

      expect(configError.code).toBe(ErrorCode.CONFIG_NOT_FOUND);
      expect(configError.steps?.length).toBe(3);
      expect(configError.tips?.length).toBe(2);

      const buildError = createSimpleError(
        ErrorCode.TYPESCRIPT_ERROR,
        "TypeScript compilation failed",
        "Found 5 type errors in your code",
        ["Fix type errors shown below", 'Run "tsc --noEmit" to check types'],
      );

      expect(buildError.code).toBe(ErrorCode.TYPESCRIPT_ERROR);
      expect(buildError.steps?.length).toBe(2);

      const runtimeError = createErrorSolution(ErrorCode.HYDRATION_MISMATCH, {
        title: "Hydration mismatch detected",
        message: "The HTML rendered on the server does not match the client",
        steps: [
          "Check for client-only APIs used during SSR",
          "Ensure Date.now() or Math.random() are not used directly",
          "Use useEffect for client-only code",
        ],
        relatedErrors: [ErrorCode.RENDER_ERROR, ErrorCode.COMPONENT_ERROR],
        docs: "https://veryfront.com/docs/errors/VF200#hydration",
      });

      expect(runtimeError.relatedErrors?.length).toBe(2);
      expect(runtimeError.docs).toBe("https://veryfront.com/docs/errors/VF200#hydration");
    });
  });
});
