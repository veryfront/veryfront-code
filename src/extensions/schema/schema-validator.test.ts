import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { InferSchema } from "./schema-validator.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";

type AssertEqual<Actual, Expected> = (<T>() => T extends Actual ? 1 : 2) extends
  (<T>() => T extends Expected ? 1 : 2) ? true
  : false;

type Assert<T extends true> = T;

describe("SchemaValidator enum", () => {
  it("preserves inline string-literal unions through defineSchema", () => {
    const getCategorySchema = defineSchema((v) =>
      v.object({
        category: v.enum(["bug", "billing"]),
      })
    );

    type Category = InferSchema<ReturnType<typeof getCategorySchema>>["category"];
    type _InlineEnumInference = Assert<AssertEqual<Category, "bug" | "billing">>;

    const bug: Category = "bug";
    const billing: Category = "billing";
    // @ts-expect-error enum inference must reject values outside the declared set.
    const feature: Category = "feature";

    assertEquals(bug, "bug");
    assertEquals(billing, "billing");
    assertEquals(feature, "feature");
  });

  it("preserves existing as const enum inference", () => {
    const getCategorySchema = defineSchema((v) =>
      v.object({
        category: v.enum(["bug", "billing"] as const),
      })
    );

    type Category = InferSchema<ReturnType<typeof getCategorySchema>>["category"];
    type _ConstEnumInference = Assert<AssertEqual<Category, "bug" | "billing">>;

    const bug: Category = "bug";
    const billing: Category = "billing";
    // @ts-expect-error enum inference must reject values outside the declared set.
    const feature: Category = "feature";

    assertEquals(bug, "bug");
    assertEquals(billing, "billing");
    assertEquals(feature, "feature");
  });

  it("keeps runtime enum validation behavior unchanged", () => {
    const schema = defineSchema((v) => v.enum(["bug", "billing"]))();

    assertEquals(schema.safeParse("bug").success, true);
    assertEquals(schema.safeParse("billing").success, true);
    assertEquals(schema.safeParse("feature").success, false);
  });
});
