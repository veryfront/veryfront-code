import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import { computeCoverageFromLcov } from "./check-coverage.ts";

const lcov = [
  "SF:/repo/src/a.ts",
  "DA:1,1",
  "DA:2,0",
  "DA:3,5",
  "end_of_record",
  "SF:/repo/src/b.ts",
  "DA:1,0",
  "DA:2,0",
  "end_of_record",
  "SF:/repo/tests/a.test.ts",
  "DA:1,1",
  "end_of_record",
].join("\n");

describe("computeCoverageFromLcov", () => {
  it("computes covered/total/percent across files", () => {
    // a.ts: 2/3 covered, b.ts: 0/2, test file: 1/1 → 3/6 = 50%
    assertEquals(computeCoverageFromLcov(lcov), {
      covered: 3,
      total: 6,
      percent: 50,
    });
  });

  it("applies include filters", () => {
    // only src/a.ts → 2/3 = 67%
    const r = computeCoverageFromLcov(lcov, { includes: ["src/a.ts"] });
    assertEquals(r, { covered: 2, total: 3, percent: 67 });
  });

  it("applies exclude filters", () => {
    // exclude tests/ → a.ts + b.ts = 2/5 = 40%
    const r = computeCoverageFromLcov(lcov, {
      includes: ["src/"],
      excludes: ["tests/"],
    });
    assertEquals(r, { covered: 2, total: 5, percent: 40 });
  });

  it("de-duplicates a file appearing in multiple sections (counts the first)", () => {
    const dup = [
      "SF:/repo/src/a.ts",
      "DA:1,1",
      "DA:2,1",
      "end_of_record",
      "SF:/repo/src/a.ts",
      "DA:1,0",
      "DA:2,0",
      "end_of_record",
    ].join("\n");
    // first section wins → 2/2 = 100%, not 2/4
    assertEquals(computeCoverageFromLcov(dup), {
      covered: 2,
      total: 2,
      percent: 100,
    });
  });

  it("reports 100% when there are no counted lines", () => {
    assertEquals(computeCoverageFromLcov("", { includes: ["nope"] }), {
      covered: 0,
      total: 0,
      percent: 100,
    });
  });
});
