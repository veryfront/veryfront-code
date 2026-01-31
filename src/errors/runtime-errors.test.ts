import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ErrorCode, VeryfrontError } from "./types.ts";
import { RenderError, RuntimeError } from "./runtime-errors.ts";

function assertBaseError(
  err: VeryfrontError,
  {
    message,
    name,
    code,
    context,
  }: {
    message: string;
    name: string;
    code: ErrorCode;
    context?: unknown;
  },
): void {
  assertEquals(err.message, message);
  assertEquals(err.name, name);
  assertEquals(err.code, code);

  if (context !== undefined) {
    assertEquals(err.context, context);
  }

  assertEquals(err instanceof VeryfrontError, true);
  assertEquals(err instanceof Error, true);
}

describe("errors/runtime-errors", () => {
  describe("RuntimeError", () => {
    it("should set message and name", () => {
      const err = new RuntimeError("something broke");
      assertBaseError(err, {
        message: "something broke",
        name: "RuntimeError",
        code: ErrorCode.RENDER_ERROR,
      });
    });

    it("should use RENDER_ERROR code", () => {
      const err = new RuntimeError("fail");
      assertEquals(err.code, ErrorCode.RENDER_ERROR);
    });

    it("should accept context", () => {
      const ctx = { component: "App" };
      const err = new RuntimeError("fail", ctx);
      assertEquals(err.context, ctx);
    });

    it("should be instanceof VeryfrontError and Error", () => {
      const err = new RuntimeError("test");
      assertEquals(err instanceof VeryfrontError, true);
      assertEquals(err instanceof Error, true);
    });
  });

  describe("RenderError", () => {
    it("should set message and name", () => {
      const err = new RenderError("render failed");
      assertBaseError(err, {
        message: "render failed",
        name: "RenderError",
        code: ErrorCode.RENDER_ERROR,
      });
    });

    it("should use RENDER_ERROR code", () => {
      const err = new RenderError("fail");
      assertEquals(err.code, ErrorCode.RENDER_ERROR);
    });

    it("should accept context", () => {
      const ctx = { route: "/page" };
      const err = new RenderError("fail", ctx);
      assertEquals(err.context, ctx);
    });

    it("should be instanceof VeryfrontError and Error", () => {
      const err = new RenderError("test");
      assertEquals(err instanceof VeryfrontError, true);
      assertEquals(err instanceof Error, true);
    });
  });
});
