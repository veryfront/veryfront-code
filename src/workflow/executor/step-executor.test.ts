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
import type { Agent } from "#veryfront/agent/types.ts";
import type { ToolExecutionContext } from "#veryfront/tool";

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

describe("StepExecutor cancellation", () => {
  it("forwards the abort signal to agent steps", async () => {
    const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    let started!: () => void;
    const agentStarted = new Promise<void>((resolve) => started = resolve);
    const cancellationError = new Error("workflow cancelled");
    const agent = {
      generate(input: { abortSignal?: AbortSignal }) {
        observedSignal = input.abortSignal;
        started();
        return new Promise((_resolve, reject) => {
          input.abortSignal?.addEventListener(
            "abort",
            () => reject(input.abortSignal?.reason),
            { once: true },
          );
        });
      },
    } as Agent;
    const node = step("agent-step", { agent });
    const executor = new StepExecutor({});

    const execution = executor.execute(node, makeContext(), controller.signal);
    await agentStarted;
    controller.abort(cancellationError);

    await assertRejects(() => execution, Error, cancellationError.message);
    assertEquals(observedSignal?.aborted, true);
    assertEquals(observedSignal?.reason, cancellationError);
  });

  it("waits for timed-out step cleanup before retrying", async () => {
    let calls = 0;
    let observedTimeoutReason: unknown;
    let markTimedOut!: () => void;
    const timedOut = new Promise<void>((resolve) => markTimedOut = resolve);
    let finishCleanup!: () => void;
    const cleanupGate = new Promise<void>((resolve) => finishCleanup = resolve);

    const node = step("timeout-retry", {
      tool: {
        id: "timeout-retry-tool",
        description: "Times out once, then succeeds",
        execute: (_input: unknown, context?: ToolExecutionContext) => {
          calls++;
          if (calls > 1) return Promise.resolve({ ok: true });

          const signal = context?.abortSignal;
          return new Promise((_resolve, reject) => {
            signal?.addEventListener("abort", () => {
              observedTimeoutReason = signal.reason;
              markTimedOut();
              void cleanupGate.then(() => reject(signal.reason));
            }, { once: true });
          });
        },
        // deno-lint-ignore no-explicit-any
      } as any,
      timeout: 1,
      retry: {
        maxAttempts: 2,
        backoff: "fixed",
        initialDelay: 0,
        maxDelay: 0,
      },
    });
    const executor = new StepExecutor({});
    let executionSettled = false;
    const execution = executor.execute(node, makeContext()).finally(() => executionSettled = true);

    await timedOut;
    await new Promise((resolve) => setTimeout(resolve, 0));

    assertEquals(calls, 1);
    assertEquals(executionSettled, false);
    assertEquals(
      observedTimeoutReason instanceof Error && observedTimeoutReason.message,
      'Step "timeout-retry" timed out after 1ms',
    );

    finishCleanup();
    const result = await execution;

    assertEquals(result.success, true);
    assertEquals(result.output, { ok: true });
    assertEquals(calls, 2);
  });
});
