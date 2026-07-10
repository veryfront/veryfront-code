import "#veryfront/schemas/_test-setup.ts";
/**
 * Step Executor Tests
 */

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { step } from "../dsl/step.ts";
import type { RetryConfig, WorkflowContext, WorkflowNode } from "../types.ts";
import { StepExecutor } from "./step-executor.ts";
import { TIMEOUT_ERROR } from "#veryfront/errors";

/** A step whose tool throws `error`, counting how many times it is invoked. */
function makeThrowingStepNode(
  retry: RetryConfig,
  error: unknown,
): { node: WorkflowNode; getCalls: () => number } {
  let calls = 0;
  const node = step("throwing-step", {
    tool: {
      id: "throwing",
      description: "always throws",
      // deno-lint-ignore require-await
      execute: async () => {
        calls++;
        throw error;
      },
      // deno-lint-ignore no-explicit-any
    } as any,
    retry,
  });
  return { node, getCalls: () => calls };
}

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

describe("StepExecutor retry classification", () => {
  const retry: RetryConfig = {
    maxAttempts: 3,
    backoff: "fixed",
    initialDelay: 1,
    maxDelay: 1,
  };

  it("retries a VeryfrontError with a retryable status", async () => {
    const executor = new StepExecutor({});
    const { node, getCalls } = makeThrowingStepNode(
      retry,
      TIMEOUT_ERROR.create({ detail: "step timed out" }), // status 408 -> retryable
    );

    const result = await executor.execute(node, makeContext());
    assertEquals(result.success, false);
    assertEquals(getCalls(), 3); // exhausted all attempts
  });

  it("does NOT retry a plain error whose message merely contains '429'", async () => {
    const executor = new StepExecutor({});
    const { node, getCalls } = makeThrowingStepNode(
      retry,
      new Error("Found 429 items exceeding limit"),
    );

    const result = await executor.execute(node, makeContext());
    assertEquals(result.success, false);
    assertEquals(getCalls(), 1); // no retry — not a transient error
  });

  it("retries a system error with a transient network code", async () => {
    const executor = new StepExecutor({});
    const err = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    const { node, getCalls } = makeThrowingStepNode(retry, err);

    const result = await executor.execute(node, makeContext());
    assertEquals(result.success, false);
    assertEquals(getCalls(), 3);
  });
});
