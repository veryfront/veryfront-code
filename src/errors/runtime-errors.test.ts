import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "./types.ts";
import { RenderError, RuntimeError } from "./runtime-errors.ts";

function assertBaseError(
  err: VeryfrontError,
  {
    message,
    name,
    slug,
    context,
  }: {
    message: string;
    name: string;
    slug: string;
    context?: unknown;
  },
): void {
  assertEquals(err.message, message);
  assertEquals(err.name, name);
  assertEquals(err.slug, slug);

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
        slug: "render-error",
      });
    });

    it("should use render-error slug", () => {
      const err = new RuntimeError("fail");
      assertEquals(err.slug, "render-error");
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
        slug: "render-error",
      });
    });

    it("should use render-error slug", () => {
      const err = new RenderError("fail");
      assertEquals(err.slug, "render-error");
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
