import "#veryfront/schemas/_test-setup.ts";
/**
 * Step Executor Tests
 */

import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { step } from "../dsl/step.ts";
import type { RetryConfig, WorkflowContext, WorkflowNode } from "../types.ts";
import { runWithWorkflowTenant, StepExecutor } from "./step-executor.ts";
import { TIMEOUT_ERROR } from "#veryfront/errors";
import {
  runWithCacheKeyContext,
  tryGetCacheKeyContext,
  tryGetRegistryScopeId,
} from "#veryfront/cache/cache-key-builder.ts";
import {
  getCurrentRequestContext,
  runWithRequestContext,
} from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { ProjectScopedRegistryManager } from "#veryfront/registry/project-scoped-registry-manager.ts";
import type { CapturedTenantContext } from "../types.ts";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils";

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
  // Construct the raw node boundary intentionally. The public DSL rejects an
  // invalid retry policy at definition time; this helper verifies that the
  // executor still fails closed for deserialized or manually constructed nodes.
  return {
    id: "test-step",
    config: {
      type: "step",
      tool: {
        id: "noop",
        description: "noop tool",
        // deno-lint-ignore require-await
        execute: async () => ({ ok: true }),
        // deno-lint-ignore no-explicit-any
      } as any,
      retry,
    },
  };
}

describe("workflow tenant registry scoping", () => {
  it("rejects preview workflow tenants without branch authority", async () => {
    await assertRejects(
      () =>
        runWithWorkflowTenant(
          {
            projectSlug: "missing-branch-project",
            token: "<TOKEN>",
            productionMode: false,
          },
          () => Promise.resolve(),
        ),
      Error,
      "requires an explicit branch",
    );
  });

  it("restores a release-less production environment without a synthetic cache scope", async () => {
    const tenant: CapturedTenantContext = {
      projectSlug: "workflow-environment-project",
      projectId: "workflow-environment-project-id",
      token: "<TOKEN>",
      productionMode: true,
      releaseId: null,
      environmentName: "Development",
    };
    const manager = new ProjectScopedRegistryManager<string>("skill");

    await runWithRequestContext(tenant, async () => {
      manager.register("environment-skill", "available");
    });

    await runWithCacheKeyContext(
      { projectId: "outer-project", mode: "production", versionId: "outer-release" },
      () =>
        runWithWorkflowTenant(tenant, async () => {
          assertEquals(manager.get("environment-skill"), "available");
          assertEquals(tryGetCacheKeyContext(), null);
          assertEquals(
            tryGetRegistryScopeId(),
            "workflow-environment-project-id:production:environment:Development",
          );
          assertEquals(getCurrentRequestContext()?.environmentName, "Development");
        }),
    );
  });
});

describe("StepExecutor retry validation", () => {
  it("rejects a raw string retry before input, lifecycle, or tool callbacks", async () => {
    const calls = { input: 0, start: 0, complete: 0, error: 0, tool: 0 };
    const executor = new StepExecutor({
      onStepStart: () => calls.start++,
      onStepComplete: () => calls.complete++,
      onStepError: () => calls.error++,
    });
    const node: WorkflowNode = {
      id: "raw-string-retry",
      config: {
        type: "step",
        retry: "three" as unknown as RetryConfig,
        input: () => {
          calls.input++;
          return {};
        },
        tool: {
          id: "must-not-run",
          description: "must not run when retry admission fails",
          execute: () => {
            calls.tool++;
            return { ok: true };
          },
          // deno-lint-ignore no-explicit-any
        } as any,
      },
    };

    await assertRejects(
      () => executor.execute(node, makeContext()),
      Error,
      "plain record",
    );
    assertEquals(calls, { input: 0, start: 0, complete: 0, error: 0, tool: 0 });
  });

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

describe("StepExecutor timer validation", () => {
  it("rejects invalid default timeouts at construction", () => {
    for (
      const defaultTimeout of [
        0,
        -1,
        0.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        MAX_TIMER_DELAY_MS + 1,
      ]
    ) {
      assertThrows(
        () => new StepExecutor({ defaultTimeout }),
        Error,
        "defaultTimeout",
      );
    }
  });

  it("accepts zero cancellation grace but rejects invalid values", () => {
    new StepExecutor({ cancellationGracePeriod: 0 });

    for (
      const cancellationGracePeriod of [
        -1,
        0.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        MAX_TIMER_DELAY_MS + 1,
      ]
    ) {
      assertThrows(
        () => new StepExecutor({ cancellationGracePeriod }),
        Error,
        "cancellationGracePeriod",
      );
    }
  });

  it("rejects raw zero and NaN step timeouts before any callbacks", async () => {
    const calls = { input: 0, start: 0, complete: 0, error: 0, tool: 0 };
    const executor = new StepExecutor({
      onStepStart: () => calls.start++,
      onStepComplete: () => calls.complete++,
      onStepError: () => calls.error++,
    });

    for (const timeout of [0, Number.NaN]) {
      const node: WorkflowNode = {
        id: `invalid-timeout-${String(timeout)}`,
        config: {
          type: "step",
          timeout,
          input: () => {
            calls.input++;
            return {};
          },
          tool: {
            id: "must-not-run",
            description: "must not run when timeout admission fails",
            // deno-lint-ignore require-await
            execute: async () => {
              calls.tool++;
              return { ok: true };
            },
            // deno-lint-ignore no-explicit-any
          } as any,
        },
      };

      const result = await executor.execute(node, makeContext());
      assertEquals(result.success, false);
      assertEquals(result.error?.includes("timeout"), true);
    }

    assertEquals(calls, { input: 0, start: 0, complete: 0, error: 0, tool: 0 });
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

describe("StepExecutor timeout isolation", () => {
  it("stops waiting after the cancellation grace when a timed-out tool never settles", async () => {
    const operation = Promise.withResolvers<unknown>();
    let receivedSignal: AbortSignal | undefined;
    let completions = 0;
    let attempts = 0;
    const executor = new StepExecutor({
      cancellationGracePeriod: 5,
      onStepComplete: () => completions++,
    });
    const node = step("never-settling-step", {
      tool: {
        id: "never-settling-tool",
        description: "Never settles and ignores cancellation",
        execute: (_input: unknown, context?: { abortSignal?: AbortSignal }) => {
          attempts++;
          receivedSignal = context?.abortSignal;
          return operation.promise;
        },
        // deno-lint-ignore no-explicit-any
      } as any,
      timeout: 5,
      retry: {
        maxAttempts: 2,
        backoff: "fixed",
        initialDelay: 1,
        maxDelay: 1,
      },
    });

    let result;
    let watchdogId: ReturnType<typeof setTimeout> | undefined;
    try {
      result = await Promise.race([
        executor.execute(node, makeContext()),
        new Promise<never>((_, reject) =>
          watchdogId = setTimeout(
            () => reject(new Error("Step execution did not stop after timeout")),
            100,
          )
        ),
      ]);
    } finally {
      if (watchdogId !== undefined) clearTimeout(watchdogId);
      // A late rejection must remain observed after the public execution settles.
      operation.reject(new Error("late tool rejection"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    assertEquals(result.success, false);
    assertEquals(result.error?.includes("timed out after 5ms"), true);
    assertEquals(receivedSignal instanceof AbortSignal, true);
    assertEquals(receivedSignal?.aborted, true);
    assertEquals(completions, 0);
    assertEquals(attempts, 1);
    assertEquals(Object.keys(result).sort(), ["error", "executionTime", "success"]);
    assertEquals(Object.hasOwn(result, "failureCause"), false);
    assertEquals(
      Object.keys(JSON.parse(JSON.stringify(result))).sort(),
      ["error", "executionTime", "success"],
    );
  });

  it("does not overlap retries when a timed-out tool ignores cancellation", async () => {
    let attempts = 0;
    let active = 0;
    let maxActive = 0;
    const signals: Array<AbortSignal | undefined> = [];
    const node = step("slow-step", {
      tool: {
        id: "slow-tool",
        description: "Ignores cancellation and settles later",
        execute: async (_input: unknown, context?: { abortSignal?: AbortSignal }) => {
          attempts++;
          active++;
          maxActive = Math.max(maxActive, active);
          signals.push(context?.abortSignal);
          await new Promise((resolve) => setTimeout(resolve, 20));
          active--;
          return { ok: true };
        },
        // deno-lint-ignore no-explicit-any
      } as any,
      timeout: 5,
      retry: {
        maxAttempts: 2,
        backoff: "fixed",
        initialDelay: 1,
        maxDelay: 1,
      },
    });

    const result = await new StepExecutor({}).execute(node, makeContext());
    await new Promise((resolve) => setTimeout(resolve, 25));

    assertEquals(result.success, false);
    assertEquals(attempts, 2);
    assertEquals(maxActive, 1);
    assertEquals(signals.every((signal) => signal instanceof AbortSignal), true);
    assertEquals(signals.every((signal) => signal?.aborted), true);
  });
});
