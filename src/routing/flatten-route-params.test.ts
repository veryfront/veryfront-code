import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { flattenRouteParams } from "./flatten-route-params.ts";

describe("routing/flattenRouteParams", () => {
  it("keeps a single dynamic segment as-is", () => {
    assertEquals(flattenRouteParams({ id: "42" }), { id: "42" });
  });

  it("joins catch-all array segments instead of dropping them (issue #2742)", () => {
    // Regression: the SSR flatteners used `value[0]`, truncating to "guides".
    assertEquals(flattenRouteParams({ slug: ["guides", "intro"] }), { slug: "guides/intro" });
  });

  it("handles mixed params and skips undefined values", () => {
    assertEquals(
      flattenRouteParams({ id: "7", rest: ["a", "b", "c"], missing: undefined as never }),
      { id: "7", rest: "a/b/c" },
    );
  });

  it("returns an empty object for no params", () => {
    assertEquals(flattenRouteParams(undefined), {});
  });
});
