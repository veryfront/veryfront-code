import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
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
  it("ignores cyclic arrays instead of overflowing the call stack", () => {
    const values: unknown[] = ["a"];
    values.push(values, "b");

    assertEquals(clsx(values as never), "a b");
  });
  it("expands a repeated array each time when it is not cyclic", () => {
    const values = ["a", "b"];
    assertEquals(clsx(values, values), "a b a b");
  });
});
