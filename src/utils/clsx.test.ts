import { describe, it } from "jsr:@std/testing/bdd";
import { assertEquals } from "jsr:@std/assert";
import { clsx } from "./clsx.ts";

describe("clsx", () => {
  it("joins string args with single spaces", () => {
    assertEquals(clsx("a", "b", "c"), "a b c");
  });
  it("drops falsy values", () => {
    assertEquals(clsx("a", false, null, undefined, 0, "", "b"), "a b");
  });
  it("expands object form to keys with truthy values", () => {
    assertEquals(clsx("base", { active: true, disabled: false }), "base active");
  });
  it("flattens arrays recursively", () => {
    assertEquals(clsx(["a", ["b", ["c"]]]), "a b c");
  });
});
