import { assertEquals } from "jsr:@std/assert";
import { describe, it } from "jsr:@std/testing/bdd";
import { findFocusedTests, isTestFile } from "./ban-test-only.ts";

describe("findFocusedTests", () => {
  it("flags it.only / describe.only / test.only / Deno.test.only", () => {
    const source = [
      'it.only("a", () => {});',
      'describe.only("b", () => {});',
      'test.only("c", () => {});',
      'Deno.test.only("d", () => {});',
    ].join("\n");
    assertEquals(findFocusedTests(source), [1, 2, 3, 4]);
  });

  it("does not flag ordinary it/describe calls", () => {
    const source = [
      'it("a", () => {});',
      'describe("b", () => {});',
      "const onlyThing = 1;",
      "obj.only = true;",
    ].join("\n");
    assertEquals(findFocusedTests(source), []);
  });

  it("ignores .only inside comments and string literals", () => {
    const source = [
      '// it.only("x", () => {});',
      '/* describe.only("y", () => {}); */',
      'const s = "use it.only( to focus";',
      "const t = `test.only( in a template`;",
    ].join("\n");
    assertEquals(findFocusedTests(source), []);
  });

  it("reports the correct 1-based line number", () => {
    const source = [
      'it("keep", () => {});',
      "",
      'describe.only("focused", () => {});',
    ].join("\n");
    assertEquals(findFocusedTests(source), [3]);
  });
});

describe("isTestFile", () => {
  it("matches .test.ts and .test.tsx only", () => {
    assertEquals(isTestFile("src/foo.test.ts"), true);
    assertEquals(isTestFile("src/foo.test.tsx"), true);
    assertEquals(isTestFile("src/foo.ts"), false);
    assertEquals(isTestFile("src/testing/bdd.ts"), false);
  });
});
