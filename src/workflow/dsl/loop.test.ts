import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { loop, times } from "./loop.ts";
import type { LoopNodeConfig, WorkflowNode } from "../types.ts";

function expectLoopConfig(node: WorkflowNode): LoopNodeConfig {
  if (node.config.type !== "loop") {
    throw new Error(`Expected loop node, got ${node.config.type}`);
  }
  return node.config;
}

describe("workflow/dsl/loop", () => {
  describe("loop", () => {
    it("should create a loop node with defaults", () => {
      const node = loop("my-loop", {
        while: () => true,
        steps: [],
      });

      const config = expectLoopConfig(node);
      assertEquals(node.id, "my-loop");
      assertEquals(config.type, "loop");
      assertEquals(config.maxIterations, 10);
      assertEquals(config.checkpoint, true);
    });

    it("should accept custom maxIterations", () => {
      const node = loop("my-loop", {
        while: () => true,
        steps: [],
        maxIterations: 50,
      });

      const config = expectLoopConfig(node);
      assertEquals(config.maxIterations, 50);
    });

    it("should throw for empty id", () => {
      assertThrows(() => loop("", { while: () => true, steps: [] }), Error, "non-empty");
    });

    it("should throw for missing while condition", () => {
      assertThrows(
        () => loop("test", { while: undefined as unknown as () => boolean, steps: [] }),
        Error,
        "while",
      );
    });

    it("should throw for missing steps", () => {
      assertThrows(
        () =>
          loop("test", {
            while: () => true,
            steps: undefined as unknown as [],
          }),
        Error,
        "steps",
      );
    });

    it("should throw for maxIterations < 1", () => {
      assertThrows(
        () => loop("test", { while: () => true, steps: [], maxIterations: 0 }),
        Error,
        "at least 1",
      );
    });

    it("should throw for maxIterations > 100", () => {
      assertThrows(
        () => loop("test", { while: () => true, steps: [], maxIterations: 101 }),
        Error,
        "cannot exceed 100",
      );
    });

    it("should allow checkpoint false", () => {
      const node = loop("test", {
        while: () => true,
        steps: [],
        checkpoint: false,
      });

      const config = expectLoopConfig(node);
      assertEquals(config.checkpoint, false);
    });
  });

  describe("times", () => {
    it("should create a loop with count-based iteration", () => {
      const node = times("repeat-3", 3, []);

      const config = expectLoopConfig(node);
      assertEquals(node.id, "repeat-3");
      assertEquals(config.type, "loop");
      assertEquals(config.maxIterations, 3);
    });
  });
});
