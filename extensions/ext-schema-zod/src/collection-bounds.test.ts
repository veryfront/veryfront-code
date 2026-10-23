import { assert, assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { z } from "zod";
import { createZodAdapter } from "./adapter.ts";

describe("SchemaValidator constrained collections", () => {
  it("preserves an oversized union array's size diagnostic and path", () => {
    const validator = createZodAdapter();
    let elementChecks = 0;
    const element = validator.string().refine(() => {
      elementChecks++;
      return true;
    });
    const schema = validator.object({
      values: validator.union([validator.string(), validator.array(element).max(2)]),
    });
    const result = schema.safeParse({ values: ["a", "b", "c"] });

    assert(!result.success);
    assertEquals(elementChecks, 0);
    assertEquals(result.issues.map(({ code, path }) => ({ code, path })), [
      { code: "too_big", path: ["values"] },
    ]);
    assert(schema.safeParse({ values: "a" }).success);
    assert(schema.safeParse({ values: ["a", "b"] }).success);
    assertEquals(elementChecks, 2);
    assert(!schema.safeParse({ values: 1 }).success);
    const error = assertThrows(() => schema.parse({ values: ["a", "b", "c"] }));
    assert(error instanceof z.ZodError);
    assertEquals(error.issues.map(({ code, path }) => ({ code, path })), [
      { code: "too_big", path: ["values"] },
    ]);
  });

  it("keeps ambiguous union failures and gives continuable options priority", () => {
    const validator = createZodAdapter();
    let elementChecks = 0;
    const element = validator.string().refine(() => {
      elementChecks++;
      return true;
    });
    const ambiguous = validator.union([
      validator.array(element).max(2),
      validator.array(element).max(1),
    ]).safeParse(["a", "b", "c"]);
    assert(!ambiguous.success);
    assertEquals(ambiguous.issues.map((issue) => issue.code), ["invalid_union"]);
    assertEquals(elementChecks, 0);

    const preferred = validator.union([
      validator.array(element).max(2),
      validator.array(validator.string()).refine(() => false, "Alternative refused"),
    ]).safeParse(["a", "b", "c"]);
    assert(!preferred.success);
    assertEquals(preferred.issues.map(({ code, message }) => ({ code, message })), [
      { code: "custom", message: "Alternative refused" },
    ]);
    assertEquals(elementChecks, 0);
  });

  it("retains nested bounded-array diagnostics in union object options", () => {
    const validator = createZodAdapter();
    const schema = validator.object({
      queryParams: validator.union([
        validator.object({ policy: validator.literal("all") }),
        validator.object({
          policy: validator.literal("include-list"),
          params: validator.array(validator.string()).max(2, "Too many parameters"),
        }),
      ]),
    });
    const invalid = schema.safeParse({
      queryParams: { policy: "include-list", params: ["a", "b", "c"] },
    });
    assert(!invalid.success);
    assertEquals(invalid.issues, [{
      code: "too_big",
      path: ["queryParams", "params"],
      message: "Too many parameters",
    }]);
    assert(schema.safeParse({ queryParams: { policy: "all" } }).success);
    assert(
      schema.safeParse({
        queryParams: { policy: "include-list", params: ["a"] },
      }).success,
    );
  });

  it("preserves successful alternatives, transforms and cloned union checks", () => {
    const validator = createZodAdapter();
    let checks = 0;
    const schema = validator.union([
      validator.string().transform((value) => value.length),
      validator.array(validator.string()).max(2).transform((value) => value.length),
    ]).refine((value) => {
      checks++;
      return value > 0;
    }, "Empty value refused").describe("Count");
    assertEquals(schema.parse("abc"), 3);
    assertEquals(schema.parse(["a"]), 1);
    assertEquals(checks, 2);
    const empty = schema.safeParse("");
    assert(!empty.success);
    assertEquals(empty.issues.map((issue) => issue.message), ["Empty value refused"]);
    assertEquals(checks, 3);
    // A failing pipe explicitly aborts, so its union diagnostic stays generic.
    const piped = schema.safeParse(["a", "b", "c"]);
    assert(!piped.success);
    assertEquals(piped.issues.map((issue) => issue.code), ["invalid_union"]);
    const bounded = validator.union([
      validator.string(),
      validator.array(validator.string()).max(2),
    ]).refine(() => {
      checks++;
      return true;
    }).describe("Bounded values");
    for (let attempt = 0; attempt < 2; attempt++) {
      const oversized = bounded.safeParse(["a", "b", "c"]);
      assert(!oversized.success);
      assertEquals(oversized.issues.map((issue) => issue.code), ["too_big"]);
    }
    assertEquals(checks, 3);
  });

  it("rejects an oversized array before validating its elements", () => {
    const validator = createZodAdapter();
    let elementChecks = 0;
    const element = validator.string().refine(() => {
      elementChecks++;
      return true;
    });
    const result = validator.array(element).max(2).safeParse(["a", "b", "c"]);

    assert(!result.success);
    assertEquals(elementChecks, 0);
    assertEquals(result.issues.map(({ code, path }) => ({ code, path })), [
      { code: "too_big", path: [] },
    ]);
  });

  it("preserves valid and invalid element validation within the bound", () => {
    const validator = createZodAdapter();
    let elementChecks = 0;
    const element = validator.string().refine((value) => {
      elementChecks++;
      return value !== "bad";
    }, "Element refused");
    const schema = validator.array(element).max(2);
    const valid = schema.safeParse(["a", "b"]);
    assert(valid.success);
    assertEquals(valid.data, ["a", "b"]);
    assertEquals(elementChecks, 2);

    elementChecks = 0;
    const invalid = schema.safeParse(["bad"]);
    assert(!invalid.success);
    assertEquals(elementChecks, 1);
    assertEquals(invalid.issues.map(({ code, path }) => ({ code, path })), [
      { code: "custom", path: [0] },
    ]);
  });
});
