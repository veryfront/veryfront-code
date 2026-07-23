import "#veryfront/schemas/_test-setup.ts";
/**
 * Step Executor Tests
 */

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
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

describe("workflow tenant registry scoping", () => {
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
            "scope-v1:31:workflow-environment-project-id:10:production:11:environment:11:Development",
          );
          assertEquals(getCurrentRequestContext()?.environmentName, "Development");
        }),
    );
  });
});

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
