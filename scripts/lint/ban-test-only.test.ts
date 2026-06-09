import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
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

  it("flags the option form: it/describe with only: true", () => {
    const source = [
      'it({ name: "a", only: true }, () => {});',
      'describe({ name: "b", only: true }, () => {});',
    ].join("\n");
    assertEquals(findFocusedTests(source), [1, 2]);
  });

  it("flags only: true on its own line in a multi-line options object", () => {
    const source = [
      "it({", // 1
      '  name: "a",', // 2
      "  only: true,", // 3
      "}, () => {});", // 4
    ].join("\n");
    assertEquals(findFocusedTests(source), [3]);
  });

  it("does not flag ordinary it/describe calls or look-alikes", () => {
    const source = [
      'it("a", () => {});',
      'describe("b", () => {});',
      "const onlyThing = 1;",
      "obj.only = true;", // assignment, not an options key
      "const opts = { readOnly: true };", // different key
      'it({ name: "c", only: false }, () => {});', // not focused
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
