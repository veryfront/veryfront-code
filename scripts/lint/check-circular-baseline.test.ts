import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import {
  isWithinCircularDependencyBaseline,
  parseCircularDependencyCount,
} from "./check-circular-baseline.ts";

describe("check-circular-baseline", () => {
  it("parses the circular dependency count from deno-circular-deps output", () => {
    const output = [
      "📦 1624 modules",
      "📁 1570 local modules",
      "🚨 43 circular dependencies detected",
    ].join("\n");

    assertEquals(parseCircularDependencyCount(output), 43);
  });

  it("treats no circular dependency summary as zero cycles", () => {
    assertEquals(parseCircularDependencyCount("No circular dependencies found"), 0);
  });

  it("allows the current baseline but rejects regressions", () => {
    assertEquals(isWithinCircularDependencyBaseline(43, 43), true);
    assertEquals(isWithinCircularDependencyBaseline(44, 43), false);
  });
});
