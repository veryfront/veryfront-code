import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import { findSkippedTests } from "./check-skipped-tests-baseline.ts";

const count = (source: string) => findSkippedTests(source, "a.test.ts").length;

describe("findSkippedTests", () => {
  it("counts method-form skips and ignores", () => {
    const source = [
      'it.skip("a", () => {});',
      'describe.skip("b", () => {});',
      'test.skip("c", () => {});',
      'Deno.test.ignore("d", () => {});',
      'it.ignore("e", () => {});',
    ].join("\n");
    assertEquals(count(source), 5);
  });

  it("counts option-form skip/ignore: true", () => {
    const source = [
      'it({ name: "a", skip: true }, () => {});',
      'describe({ name: "b", ignore: true }, () => {});',
    ].join("\n");
    assertEquals(count(source), 2);
  });

  it("reports the line of each skip", () => {
    const source = [
      "/**",
      " * header comment",
      " */",
      'it("a", () => {});',
      'it.skip("b", () => {});',
    ].join("\n");
    assertEquals(findSkippedTests(source, "a.test.ts").map((f) => f.line), [5]);
  });

  it("does not count active tests or look-alikes", () => {
    const source = [
      'it("a", () => {});',
      'describe("b", () => {});',
      'it({ name: "c", skip: false }, () => {});',
      "const skipList = [];",
      "obj.skip();", // not a test runner method chain on it/describe/test
    ].join("\n");
    assertEquals(count(source), 0);
  });

  it("ignores skips inside comments and string literals", () => {
    const source = [
      '// it.skip("x", () => {});',
      'const s = "it.skip( reference";',
      "const t = `describe.ignore( in template`;",
    ].join("\n");
    assertEquals(count(source), 0);
  });
});
