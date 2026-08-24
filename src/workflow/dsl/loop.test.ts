import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { doWhile, loop, type LoopContext, times } from "./loop.ts";
import type { LoopNodeConfig, WorkflowContext, WorkflowNode } from "../types.ts";

function expectLoopConfig(node: WorkflowNode): LoopNodeConfig {
  if (node.config.type !== "loop") {
    throw new Error(`Expected loop node, got ${node.config.type}`);
  }
  return node.config;
}

function loopContext(overrides: Partial<LoopContext> = {}): LoopContext {
  return {
    iteration: 0,
    totalIterations: 0,
    previousResults: [],
    isFirstIteration: false,
    isLastAllowedIteration: false,
    ...overrides,
  };
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
      assertThrows(
        () => loop("", { while: () => true, steps: [] }),
        VeryfrontError,
        "non-empty",
      );
    });

    it("should throw for missing while condition", () => {
      assertThrows(
        () => loop("test", { while: undefined as unknown as () => boolean, steps: [] }),
        VeryfrontError,
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
        VeryfrontError,
        "steps",
      );
    });

    it("should throw for maxIterations < 1", () => {
      assertThrows(
        () => loop("test", { while: () => true, steps: [], maxIterations: 0 }),
        VeryfrontError,
        "at least 1",
      );
    });

    it("should throw for maxIterations > 100", () => {
      assertThrows(
        () => loop("test", { while: () => true, steps: [], maxIterations: 101 }),
        VeryfrontError,
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

    it("rejects non-integer maxIterations", () => {
      for (const maxIterations of [1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
        assertThrows(
          () => loop("test", { while: () => true, steps: [], maxIterations }),
          VeryfrontError,
          "integer between 1 and 100",
        );
      }
    });
  });

  describe("doWhile", () => {
    it("runs the first iteration before consulting until", async () => {
      let calls = 0;
      const node = doWhile("poll", {
        until: () => {
          calls++;
          return calls > 1;
        },
        steps: [],
      });
      const config = expectLoopConfig(node);
      const first = { isFirstIteration: true } as never;
      const later = { isFirstIteration: false } as never;

      assertEquals(await config.while({ input: {} }, first), true);
      assertEquals(calls, 0);
      assertEquals(await config.while({ input: {} }, later), true);
      assertEquals(await config.while({ input: {} }, later), false);
    });

    it("rejects a missing until condition", () => {
      assertThrows(
        () => doWhile("poll", { until: undefined as never, steps: [] }),
        VeryfrontError,
        "until",
      );
    });
  });

  describe("doWhile", () => {
    const context = {} as WorkflowContext;

    it("should always run the first iteration even when until is already satisfied", async () => {
      const node = doWhile("dw", { until: () => true, steps: [] });
      const predicate = expectLoopConfig(node).while;

      assertEquals(
        await predicate(context, loopContext({ isFirstIteration: true, iteration: 5 })),
        true,
        "doWhile must always run its first iteration regardless of until",
      );
    });

    it("should stop once until is satisfied", async () => {
      const node = doWhile("dw", { until: () => true, steps: [] });
      const predicate = expectLoopConfig(node).while;

      assertEquals(
        await predicate(context, loopContext({ iteration: 1 })),
        false,
        "doWhile must stop once until is satisfied",
      );
    });

    it("should continue while until is unsatisfied", async () => {
      const node = doWhile("dw", { until: () => false, steps: [] });
      const predicate = expectLoopConfig(node).while;

      assertEquals(
        await predicate(context, loopContext({ iteration: 1 })),
        true,
        "doWhile must continue while until is unsatisfied",
      );
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

    it("rejects a fractional count", () => {
      assertThrows(
        () => times("fractional", 1.5, []),
        VeryfrontError,
        "integer between 1 and 100",
      );
    });
  });
});
