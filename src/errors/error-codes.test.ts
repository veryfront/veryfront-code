import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ErrorCode, getErrorDocsUrl, inferErrorCode } from "./error-codes.ts";

describe("error-codes", () => {
  describe("getErrorDocsUrl", () => {
    it("should return docs URL with error code", () => {
      assertEquals(
        getErrorDocsUrl(ErrorCode.CONFIG_NOT_FOUND),
        "https://veryfront.com/docs/errors/VF001",
      );
    });

    it("should work with any error code", () => {
      assertEquals(
        getErrorDocsUrl(ErrorCode.BUILD_FAILED),
        "https://veryfront.com/docs/errors/VF100",
      );
    });
  });

  describe("inferErrorCode", () => {
    it("should return null for unrecognized errors", () => {
      assertEquals(inferErrorCode(new Error("something random")), null);
    });

    it("should infer CONFIG_NOT_FOUND for config not found message", () => {
      assertEquals(
        inferErrorCode(new Error("Config not found at path")),
        ErrorCode.CONFIG_NOT_FOUND,
      );
    });

    it("should infer CONFIG_INVALID for config invalid message", () => {
      assertEquals(
        inferErrorCode(new Error("Config is invalid")),
        ErrorCode.CONFIG_INVALID,
      );
    });

    it("should infer CORS_CONFIG_INVALID for cors message", () => {
      assertEquals(
        inferErrorCode(new Error("CORS origin rejected")),
        ErrorCode.CORS_CONFIG_INVALID,
      );
    });

    it("should infer ROUTE_CONFLICT for route conflict message", () => {
      assertEquals(
        inferErrorCode(new Error("Route conflict detected")),
        ErrorCode.ROUTE_CONFLICT,
      );
    });

    it("should infer INVALID_ROUTE_FILE for route invalid message", () => {
      assertEquals(
        inferErrorCode(new Error("Route file is invalid")),
        ErrorCode.INVALID_ROUTE_FILE,
      );
    });

    it("should infer CLIENT_BOUNDARY_VIOLATION", () => {
      assertEquals(
        inferErrorCode(new Error("Client boundary violation detected")),
        ErrorCode.CLIENT_BOUNDARY_VIOLATION,
      );
    });

    it("should infer SERVER_ONLY_IN_CLIENT", () => {
      assertEquals(
        inferErrorCode(new Error("server-only module used in client code")),
        ErrorCode.SERVER_ONLY_IN_CLIENT,
      );
    });

    it("should infer CACHE_PATH_MISMATCH", () => {
      assertEquals(
        inferErrorCode(new Error("cache path mismatch")),
        ErrorCode.CACHE_PATH_MISMATCH,
      );
    });

    it("should infer MODULE_NOT_FOUND for module not found", () => {
      assertEquals(
        inferErrorCode(new Error("Module not found: react")),
        ErrorCode.MODULE_NOT_FOUND,
      );
    });

    it("should infer MODULE_NOT_FOUND for cannot find module", () => {
      assertEquals(
        inferErrorCode(new Error("Cannot find module './foo'")),
        ErrorCode.MODULE_NOT_FOUND,
      );
    });

    it("should infer IMPORT_RESOLUTION_ERROR for import errors", () => {
      assertEquals(
        inferErrorCode(new Error("Failed to import module")),
        ErrorCode.IMPORT_RESOLUTION_ERROR,
      );
    });

    it("should infer IMPORT_RESOLUTION_ERROR for resolve errors", () => {
      assertEquals(
        inferErrorCode(new Error("Failed to resolve specifier")),
        ErrorCode.IMPORT_RESOLUTION_ERROR,
      );
    });

    it("should infer DEPENDENCY_MISSING for react not found", () => {
      assertEquals(
        inferErrorCode(new Error("react package not found")),
        ErrorCode.DEPENDENCY_MISSING,
      );
    });

    it("should infer PORT_IN_USE for port in use", () => {
      assertEquals(
        inferErrorCode(new Error("Port 3000 is in use")),
        ErrorCode.PORT_IN_USE,
      );
    });

    it("should infer PORT_IN_USE for EADDRINUSE", () => {
      assertEquals(
        inferErrorCode(new Error("listen EADDRINUSE on port 8080")),
        ErrorCode.PORT_IN_USE,
      );
    });

    it("should infer SERVICE_OVERLOADED for capacity exceeded", () => {
      assertEquals(
        inferErrorCode(new Error("capacity exceeded")),
        ErrorCode.SERVICE_OVERLOADED,
      );
    });

    it("should infer SERVICE_OVERLOADED for service overloaded", () => {
      assertEquals(
        inferErrorCode(new Error("service overloaded")),
        ErrorCode.SERVICE_OVERLOADED,
      );
    });

    it("should infer HYDRATION_MISMATCH", () => {
      assertEquals(
        inferErrorCode(new Error("Hydration failed")),
        ErrorCode.HYDRATION_MISMATCH,
      );
    });

    it("should infer BUILD_FAILED for build fail", () => {
      assertEquals(
        inferErrorCode(new Error("Build failed with errors")),
        ErrorCode.BUILD_FAILED,
      );
    });

    it("should infer MDX_COMPILE_ERROR", () => {
      assertEquals(
        inferErrorCode(new Error("MDX compilation error")),
        ErrorCode.MDX_COMPILE_ERROR,
      );
    });

    it("should infer TYPESCRIPT_ERROR", () => {
      assertEquals(
        inferErrorCode(new Error("TypeScript type error")),
        ErrorCode.TYPESCRIPT_ERROR,
      );
    });

    it("should be case insensitive", () => {
      assertEquals(
        inferErrorCode(new Error("CONFIG NOT FOUND")),
        ErrorCode.CONFIG_NOT_FOUND,
      );
    });
  });
});
