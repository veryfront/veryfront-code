import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ErrorCode } from "../error-codes.ts";
import { CONFIG_ERROR_CATALOG } from "./config-errors.ts";

describe("errors/catalog/config-errors", () => {
  describe("CONFIG_ERROR_CATALOG", () => {
    it("should contain all config error codes", () => {
      const expectedCodes = [
        ErrorCode.CONFIG_NOT_FOUND,
        ErrorCode.CONFIG_INVALID,
        ErrorCode.CONFIG_PARSE_ERROR,
        ErrorCode.CONFIG_VALIDATION_ERROR,
        ErrorCode.CONFIG_TYPE_ERROR,
        ErrorCode.IMPORT_MAP_INVALID,
        ErrorCode.CORS_CONFIG_INVALID,
      ];

      for (const code of expectedCodes) {
        assertEquals(code in CONFIG_ERROR_CATALOG, true, `Missing error code: ${code}`);
      }
    });

    it("should have correct structure for each entry", () => {
      for (const [code, solution] of Object.entries(CONFIG_ERROR_CATALOG)) {
        assertEquals(solution.code, code, `code mismatch for ${code}`);
        assertEquals(typeof solution.title, "string", `title should be string for ${code}`);
        assertEquals(typeof solution.message, "string", `message should be string for ${code}`);
        assertEquals(typeof solution.docs, "string", `docs should be string for ${code}`);
      }
    });

    it("should have steps for all entries", () => {
      for (const [code, solution] of Object.entries(CONFIG_ERROR_CATALOG)) {
        assertEquals(Array.isArray(solution.steps), true, `steps should be array for ${code}`);
        assertEquals(solution.steps!.length > 0, true, `steps should not be empty for ${code}`);
      }
    });

    it("should have docs URLs pointing to veryfront.com", () => {
      for (const solution of Object.values(CONFIG_ERROR_CATALOG)) {
        assertEquals(
          solution.docs!.startsWith("https://veryfront.com/docs/errors/"),
          true,
          `docs URL should start with veryfront.com for ${solution.code}`,
        );
      }
    });

    it("CONFIG_NOT_FOUND should have example and tips", () => {
      const solution = CONFIG_ERROR_CATALOG[ErrorCode.CONFIG_NOT_FOUND]!;
      assertEquals(typeof solution.example, "string");
      assertEquals(Array.isArray(solution.tips), true);
      assertEquals(solution.tips!.length > 0, true);
    });

    it("CONFIG_INVALID should have example", () => {
      const solution = CONFIG_ERROR_CATALOG[ErrorCode.CONFIG_INVALID]!;
      assertEquals(typeof solution.example, "string");
    });

    it("IMPORT_MAP_INVALID should have example", () => {
      const solution = CONFIG_ERROR_CATALOG[ErrorCode.IMPORT_MAP_INVALID]!;
      assertEquals(typeof solution.example, "string");
    });

    it("CORS_CONFIG_INVALID should have example", () => {
      const solution = CONFIG_ERROR_CATALOG[ErrorCode.CORS_CONFIG_INVALID]!;
      assertEquals(typeof solution.example, "string");
    });
  });
});
