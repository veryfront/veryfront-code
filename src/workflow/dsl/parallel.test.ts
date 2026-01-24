/**
 * Parallel DSL Tests
 */

import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parallel } from "./parallel.ts";
import { step } from "./step.ts";
import type { ParallelNodeConfig } from "../types.ts";

function getConfig(node: { config: unknown }): ParallelNodeConfig {
  return node.config as ParallelNodeConfig;
}

describe("parallel()", () => {
  it("should create a parallel node with children", () => {
    const node = parallel("generate", [
      step("write", { agent: "writer" }),
      step("images", { tool: "imageGen" }),
    ]);

    assertEquals(node.id, "generate");
    assertEquals(node.config.type, "parallel");

    const config = getConfig(node);
    assertEquals(config.nodes?.length, 2);
    // parallel() prefixes child IDs
    assertEquals(config.nodes?.[0]?.id, "generate/write");
    assertEquals(config.nodes?.[1]?.id, "generate/images");
  });

  it("should support strategy option", () => {
    const node = parallel(
      "batch",
      [
        step("task1", { agent: "a" }),
        step("task2", { agent: "a" }),
        step("task3", { agent: "a" }),
      ],
      { strategy: "race" },
    );

    assertEquals(getConfig(node).strategy, "race");
  });

  it("should support allSettled strategy", () => {
    const node = parallel(
      "critical",
      [step("a", { agent: "a" }), step("b", { agent: "b" })],
      { strategy: "allSettled" },
    );

    assertEquals(getConfig(node).strategy, "allSettled");
  });

  it("should throw for empty children array", () => {
    assertThrows(
      () => parallel("empty", []),
      Error,
      "must have at least one child node",
    );
  });

  it("should handle single child", () => {
    const node = parallel("single", [step("only", { agent: "a" })]);

    assertEquals(getConfig(node).nodes?.length, 1);
  });

  it("should support nested parallel nodes", () => {
    const node = parallel("outer", [
      parallel("inner1", [
        step("a", { agent: "a" }),
        step("b", { agent: "b" }),
      ]),
      parallel("inner2", [
        step("c", { agent: "c" }),
        step("d", { agent: "d" }),
      ]),
    ]);

    const config = getConfig(node);
    assertEquals(config.nodes?.length, 2);
    assertEquals(config.nodes?.[0]?.config.type, "parallel");
    assertEquals(config.nodes?.[1]?.config.type, "parallel");
  });

  it("should default strategy to all", () => {
    const node = parallel("test", [step("a", { agent: "a" })]);

    assertEquals(getConfig(node).strategy, "all");
  });

  it("should support timeout option", () => {
    const node = parallel("test", [step("a", { agent: "a" })], { timeout: "5m" });

    assertEquals(getConfig(node).timeout, "5m");
  });
});
