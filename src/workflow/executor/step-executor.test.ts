import "#veryfront/schemas/_test-setup.ts";
/**
 * Step Executor Tests
 */

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { step } from "../dsl/step.ts";
import type { RetryConfig, WorkflowContext, WorkflowNode } from "../types.ts";
import { StepExecutor } from "./step-executor.ts";

function makeContext(): WorkflowContext {
  return { input: {} };
}

function makeStepNode(retry: RetryConfig): WorkflowNode {
  // Cast through unknown because RetryConfig in tests may intentionally carry
  // invalid values that the step DSL's narrower types would reject at compile time.
  return step("test-step", {
    tool: {
      id: "noop",
      description: "noop tool",
      // deno-lint-ignore require-await
      execute: async () => ({ ok: true }),
      // deno-lint-ignore no-explicit-any
    } as any,
    retry,
  });
}

describe("StepExecutor retry validation", () => {
  it("rejects negative maxAttempts before executing the step", async () => {
    const executor = new StepExecutor({});
    const node = makeStepNode({ maxAttempts: -1 } as RetryConfig);

    await assertRejects(
      () => executor.execute(node, makeContext()),
      Error,
      "maxAttempts",
    );
  });

  it("rejects when initialDelay is greater than maxDelay", async () => {
    const executor = new StepExecutor({});
    const node = makeStepNode({
      maxAttempts: 3,
      initialDelay: 5_000,
      maxDelay: 1_000,
    } as RetryConfig);

    await assertRejects(
      () => executor.execute(node, makeContext()),
      Error,
      "initialDelay",
    );
  });

  it("rejects invalid backoff strategy", async () => {
    const executor = new StepExecutor({});
    const node = makeStepNode({
      maxAttempts: 2,
      // deno-lint-ignore no-explicit-any
      backoff: "geometric" as any,
    });

    await assertRejects(
      () => executor.execute(node, makeContext()),
      Error,
      "backoff",
    );
  });

  it("accepts a valid retry config", async () => {
    const executor = new StepExecutor({});
    const node = makeStepNode({
      maxAttempts: 3,
      backoff: "exponential",
      initialDelay: 100,
      maxDelay: 1_000,
    });

    const result = await executor.execute(node, makeContext());
    assertEquals(result.success, true);
  });
});
