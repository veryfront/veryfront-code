import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ErrorCode, getErrorDocsUrl, inferErrorCode } from "./error-codes.ts";

describe("error-codes", () => {
  describe("getErrorDocsUrl", () => {
    const cases: Array<[ErrorCode, string]> = [
      [ErrorCode.CONFIG_NOT_FOUND, "https://veryfront.com/docs/errors/VF001"],
      [ErrorCode.BUILD_FAILED, "https://veryfront.com/docs/errors/VF100"],
    ];

    for (const [code, url] of cases) {
      it(`should return docs URL for ${code}`, () => {
        assertEquals(getErrorDocsUrl(code), url);
      });
    }
  });

  describe("inferErrorCode", () => {
    const cases: Array<[string, ErrorCode | null]> = [
      ["something random", null],
      ["Config not found at path", ErrorCode.CONFIG_NOT_FOUND],
      ["Config is invalid", ErrorCode.CONFIG_INVALID],
      ["CORS origin rejected", ErrorCode.CORS_CONFIG_INVALID],
      ["Route conflict detected", ErrorCode.ROUTE_CONFLICT],
      ["Route file is invalid", ErrorCode.INVALID_ROUTE_FILE],
      ["Client boundary violation detected", ErrorCode.CLIENT_BOUNDARY_VIOLATION],
      ["server-only module used in client code", ErrorCode.SERVER_ONLY_IN_CLIENT],
      ["cache path mismatch", ErrorCode.CACHE_PATH_MISMATCH],
      ["Module not found: react", ErrorCode.MODULE_NOT_FOUND],
      ["Cannot find module './foo'", ErrorCode.MODULE_NOT_FOUND],
      ["Failed to import module", ErrorCode.IMPORT_RESOLUTION_ERROR],
      ["Failed to resolve specifier", ErrorCode.IMPORT_RESOLUTION_ERROR],
      ["react package not found", ErrorCode.DEPENDENCY_MISSING],
      ["Port 3000 is in use", ErrorCode.PORT_IN_USE],
      ["listen EADDRINUSE on port 8080", ErrorCode.PORT_IN_USE],
      ["capacity exceeded", ErrorCode.SERVICE_OVERLOADED],
      ["service overloaded", ErrorCode.SERVICE_OVERLOADED],
      ["Hydration failed", ErrorCode.HYDRATION_MISMATCH],
      ["Build failed with errors", ErrorCode.BUILD_FAILED],
      ["MDX compilation error", ErrorCode.MDX_COMPILE_ERROR],
      ["TypeScript type error", ErrorCode.TYPESCRIPT_ERROR],
      ["CONFIG NOT FOUND", ErrorCode.CONFIG_NOT_FOUND],
    ];

    for (const [message, expected] of cases) {
      it(`should infer ${expected ?? "null"} for "${message}"`, () => {
        assertEquals(inferErrorCode(new Error(message)), expected);
      });
    }
  });
});
