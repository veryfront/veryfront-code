import { assertEquals } from "jsr:@std/assert";
import { describe, it } from "jsr:@std/testing/bdd";
import {
  countSkippedTests,
  isTestFile,
  isWithinBaseline,
} from "./check-skipped-tests-baseline.ts";

describe("countSkippedTests", () => {
  it("counts method-form skips and ignores", () => {
    const source = [
      'it.skip("a", () => {});',
      'describe.skip("b", () => {});',
      'test.skip("c", () => {});',
      'Deno.test.ignore("d", () => {});',
      'it.ignore("e", () => {});',
    ].join("\n");
    assertEquals(countSkippedTests(source), 5);
  });

  it("counts option-form skip/ignore: true", () => {
    const source = [
      'it({ name: "a", skip: true }, () => {});',
      'describe({ name: "b", ignore: true }, () => {});',
    ].join("\n");
    assertEquals(countSkippedTests(source), 2);
  });

  it("does not count active tests or look-alikes", () => {
    const source = [
      'it("a", () => {});',
      'describe("b", () => {});',
      'it({ name: "c", skip: false }, () => {});',
      "const skipList = [];",
      "obj.skip();", // not a test runner method chain on it/describe/test
    ].join("\n");
    assertEquals(countSkippedTests(source), 0);
  });

  it("ignores skips inside comments and string literals", () => {
    const source = [
      '// it.skip("x", () => {});',
      'const s = "it.skip( reference";',
      "const t = `describe.ignore( in template`;",
    ].join("\n");
    assertEquals(countSkippedTests(source), 0);
  });
});

describe("isWithinBaseline", () => {
  it("allows counts at or below the baseline and rejects growth", () => {
    assertEquals(isWithinBaseline(22, 22), true);
    assertEquals(isWithinBaseline(21, 22), true);
    assertEquals(isWithinBaseline(23, 22), false);
  });
});

describe("isTestFile", () => {
  it("matches .test.ts and .test.tsx only", () => {
    assertEquals(isTestFile("src/foo.test.ts"), true);
    assertEquals(isTestFile("src/foo.test.tsx"), true);
    assertEquals(isTestFile("src/foo.ts"), false);
  });
});
