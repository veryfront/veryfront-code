import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ErrorCode, VeryfrontError } from "./types.ts";

describe("errors/types", () => {
  describe("ErrorCode enum", () => {
    it("should have FILE_NOT_FOUND", () => {
      assertEquals(ErrorCode.FILE_NOT_FOUND, "FILE_NOT_FOUND");
    });

    it("should have RENDER_ERROR", () => {
      assertEquals(ErrorCode.RENDER_ERROR, "RENDER_ERROR");
    });

    it("should have SERVICE_OVERLOADED", () => {
      assertEquals(ErrorCode.SERVICE_OVERLOADED, "SERVICE_OVERLOADED");
    });
  });

  describe("VeryfrontError", () => {
    it("should set message and code", () => {
      const err = new VeryfrontError("test error", ErrorCode.BUILD_ERROR);
      assertEquals(err.message, "test error");
      assertEquals(err.code, ErrorCode.BUILD_ERROR);
      assertEquals(err.name, "VeryfrontError");
    });

    it("should set context when provided", () => {
      const ctx = { file: "main.ts", line: 42 };
      const err = new VeryfrontError("fail", ErrorCode.RENDER_ERROR, ctx);
      assertEquals(err.context, ctx);
    });

    it("should have undefined context when not provided", () => {
      const err = new VeryfrontError("fail", ErrorCode.CONFIG_ERROR);
      assertEquals(err.context, undefined);
    });

    it("should be an instance of Error", () => {
      const err = new VeryfrontError("test", ErrorCode.NETWORK_ERROR);
      assertEquals(err instanceof Error, true);
      assertEquals(err instanceof VeryfrontError, true);
    });
  });
});
