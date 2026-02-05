import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ErrorCode, errorCodeSchema, type ErrorCodeType } from "./error.schema.ts";

describe("errors/schema", () => {
  describe("errorCodeSchema", () => {
    it("should accept all valid error codes", () => {
      const validCodes = [
        "FILE_NOT_FOUND",
        "BUILD_ERROR",
        "CONFIG_ERROR",
        "COMPILATION_ERROR",
        "NETWORK_ERROR",
        "PERMISSION_ERROR",
        "RENDER_ERROR",
        "INITIALIZATION_ERROR",
        "AGENT_ERROR",
        "AGENT_NOT_FOUND",
        "AGENT_TIMEOUT",
        "AGENT_INTENT_ERROR",
        "ORCHESTRATION_ERROR",
        "NOT_SUPPORTED",
        "SERVICE_OVERLOADED",
      ] as const;

      for (const code of validCodes) {
        const result = errorCodeSchema.safeParse(code);
        assertEquals(result.success, true, `${code} should be valid`);
      }
    });

    it("should reject invalid error codes", () => {
      const invalidCodes = [
        "INVALID_CODE",
        "file_not_found",
        "FileNotFound",
        "",
        null,
        undefined,
        123,
      ];

      for (const code of invalidCodes) {
        const result = errorCodeSchema.safeParse(code);
        assertEquals(result.success, false, `${code} should be invalid`);
      }
    });
  });

  describe("ErrorCode const object", () => {
    it("should have all error codes as runtime values", () => {
      // Test that ErrorCode can be accessed like an enum
      assertEquals(ErrorCode.FILE_NOT_FOUND, "FILE_NOT_FOUND");
      assertEquals(ErrorCode.BUILD_ERROR, "BUILD_ERROR");
      assertEquals(ErrorCode.CONFIG_ERROR, "CONFIG_ERROR");
      assertEquals(ErrorCode.COMPILATION_ERROR, "COMPILATION_ERROR");
      assertEquals(ErrorCode.NETWORK_ERROR, "NETWORK_ERROR");
      assertEquals(ErrorCode.PERMISSION_ERROR, "PERMISSION_ERROR");
      assertEquals(ErrorCode.RENDER_ERROR, "RENDER_ERROR");
      assertEquals(ErrorCode.INITIALIZATION_ERROR, "INITIALIZATION_ERROR");
      assertEquals(ErrorCode.AGENT_ERROR, "AGENT_ERROR");
      assertEquals(ErrorCode.AGENT_NOT_FOUND, "AGENT_NOT_FOUND");
      assertEquals(ErrorCode.AGENT_TIMEOUT, "AGENT_TIMEOUT");
      assertEquals(ErrorCode.AGENT_INTENT_ERROR, "AGENT_INTENT_ERROR");
      assertEquals(ErrorCode.ORCHESTRATION_ERROR, "ORCHESTRATION_ERROR");
      assertEquals(ErrorCode.NOT_SUPPORTED, "NOT_SUPPORTED");
      assertEquals(ErrorCode.SERVICE_OVERLOADED, "SERVICE_OVERLOADED");
    });

    it("should have exactly 15 error codes", () => {
      const keys = Object.keys(ErrorCode);
      assertEquals(keys.length, 15);
    });

    it("should match schema enum values", () => {
      // Verify ErrorCode object values match schema options
      const schemaOptions = errorCodeSchema._def.values;
      const objectValues = Object.values(ErrorCode);

      assertEquals(objectValues.length, schemaOptions.length);
      for (const value of objectValues) {
        assertEquals(
          schemaOptions.includes(value),
          true,
          `${value} should be in schema`,
        );
      }
    });
  });

  describe("ErrorCodeType", () => {
    it("should accept ErrorCode object values", () => {
      // Test that ErrorCodeType works with ErrorCode values
      const testCode: ErrorCodeType = ErrorCode.CONFIG_ERROR;
      assertEquals(testCode, "CONFIG_ERROR");

      const testCode2: ErrorCodeType = ErrorCode.AGENT_TIMEOUT;
      assertEquals(testCode2, "AGENT_TIMEOUT");
    });

    it("should accept literal string values", () => {
      // Test that ErrorCodeType works with literals
      const testCode: ErrorCodeType = "NETWORK_ERROR";
      assertEquals(testCode, "NETWORK_ERROR");
    });
  });

  describe("Dual export pattern usage", () => {
    it("should support enum-like runtime access", () => {
      // Simulate typical usage pattern
      function handleError(code: ErrorCodeType): string {
        if (code === ErrorCode.CONFIG_ERROR) {
          return "Configuration error occurred";
        }
        if (code === ErrorCode.NETWORK_ERROR) {
          return "Network error occurred";
        }
        return "Unknown error";
      }

      assertEquals(handleError(ErrorCode.CONFIG_ERROR), "Configuration error occurred");
      assertEquals(handleError("NETWORK_ERROR"), "Network error occurred");
      assertEquals(handleError(ErrorCode.AGENT_ERROR), "Unknown error");
    });

    it("should support switch statements", () => {
      function getErrorMessage(code: ErrorCodeType): string {
        switch (code) {
          case ErrorCode.FILE_NOT_FOUND:
            return "File not found";
          case ErrorCode.BUILD_ERROR:
            return "Build failed";
          case ErrorCode.CONFIG_ERROR:
            return "Configuration invalid";
          default:
            return "Unknown error";
        }
      }

      assertEquals(getErrorMessage(ErrorCode.FILE_NOT_FOUND), "File not found");
      assertEquals(getErrorMessage("BUILD_ERROR"), "Build failed");
      assertEquals(getErrorMessage(ErrorCode.AGENT_ERROR), "Unknown error");
    });

    it("should support Object.values iteration", () => {
      // Test that we can iterate over all error codes
      const allCodes = Object.values(ErrorCode);
      assertEquals(allCodes.length, 15);

      // Verify all are strings
      for (const code of allCodes) {
        assertEquals(typeof code, "string");
      }
    });
  });
});
