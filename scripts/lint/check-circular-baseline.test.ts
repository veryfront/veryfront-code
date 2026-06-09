import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import {
  getCircularDependencyCheckResult,
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

  it("fails when the circular dependency command fails without a summary", () => {
    const result = getCircularDependencyCheckResult({
      commandSucceeded: false,
      output: "error: failed to download jsr package",
      baseline: 0,
    });

    assertEquals(result.ok, false);
    assertEquals(result.count, null);
    assertEquals(result.reason, "command_failed");
  });
});
