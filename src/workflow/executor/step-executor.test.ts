import "#veryfront/schemas/_test-setup.ts";
/**
 * Step Executor Tests
 */

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import { step } from "../dsl/step.ts";
import type { NodeState, RetryConfig, WorkflowContext, WorkflowNode } from "../types.ts";
import { runWithWorkflowTenant, StepExecutor } from "./step-executor.ts";
import { TIMEOUT_ERROR, VeryfrontError } from "#veryfront/errors";
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
            "workflow-environment-project-id:production:environment:Development",
          );
          assertEquals(getCurrentRequestContext()?.environmentName, "Development");
        }),
    );
  });

  it("scopes the distributed cache to the release of a release-backed tenant", async () => {
    const tenant: CapturedTenantContext = {
      projectSlug: "workflow-release-project",
      projectId: "workflow-release-project-id",
      token: "<TOKEN>",
      productionMode: true,
      releaseId: "release-1",
      environmentName: "production",
    };

    await runWithCacheKeyContext(
      { projectId: "outer-project", mode: "production", versionId: "outer-release" },
      () =>
        runWithWorkflowTenant(tenant, () => {
          assertEquals(
            tryGetCacheKeyContext(),
            {
              projectId: "workflow-release-project-id",
              mode: "production",
              versionId: "release-1",
            },
            "a release-backed tenant must scope the distributed cache to its own release",
          );
          return Promise.resolve();
        }),
    );
  });

  it("scopes the distributed cache to the branch of a preview tenant", async () => {
    const tenant: CapturedTenantContext = {
      projectSlug: "workflow-preview-project",
      projectId: "workflow-preview-project-id",
      token: "<TOKEN>",
      productionMode: false,
      releaseId: null,
      branch: "feature/x",
      environmentName: "preview",
    };

    await runWithCacheKeyContext(
      { projectId: "outer-project", mode: "production", versionId: "outer-release" },
      () =>
        runWithWorkflowTenant(tenant, () => {
          assertEquals(
            tryGetCacheKeyContext(),
            {
              projectId: "workflow-preview-project-id",
              mode: "preview",
              versionId: "feature/x",
            },
            "a preview tenant must scope the distributed cache to its own branch",
          );
          return Promise.resolve();
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
      VeryfrontError,
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
      VeryfrontError,
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
      VeryfrontError,
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

  it("does not re-execute a successful tool when the completion hook fails", async () => {
    let toolCalls = 0;
    let errorHooks = 0;
    const executor = new StepExecutor({
      onStepComplete: () => {
        throw TIMEOUT_ERROR.create({ detail: "completion hook failed" });
      },
      onStepError: () => errorHooks++,
    });
    const node = step("successful-side-effect", {
      tool: {
        id: "side-effect",
        description: "Counts successful side effects",
        execute: () => {
          toolCalls++;
          return { ok: true };
        },
      } as never,
      retry: {
        maxAttempts: 3,
        backoff: "fixed",
        initialDelay: 0,
        maxDelay: 0,
      },
    });

    const result = await executor.execute(node, makeContext());

    assertEquals(result.success, false);
    assertEquals(result.error, "completion hook failed");
    assertEquals(toolCalls, 1);
    assertEquals(errorHooks, 1);
  });
});

describe("StepExecutor admission", () => {
  it("rejects a raw step with both an agent and a tool before either executes", async () => {
    let agentCalls = 0;
    let toolCalls = 0;
    const node = {
      id: "ambiguous-step",
      config: {
        type: "step",
        agent: {
          id: "agent",
          generate: () => {
            agentCalls++;
            return Promise.resolve({ text: "agent", status: "completed" });
          },
        },
        tool: {
          id: "tool",
          execute: () => {
            toolCalls++;
            return { source: "tool" };
          },
        },
      },
    } as unknown as WorkflowNode;

    await assertRejects(
      () => new StepExecutor({}).execute(node, makeContext()),
      VeryfrontError,
      "exactly one of 'agent' or 'tool'",
    );
    assertEquals(agentCalls, 0);
    assertEquals(toolCalls, 0);
  });

  it("rejects a zero step timeout before executing the tool", async () => {
    let toolCalls = 0;
    const node = step("zero-timeout", {
      tool: {
        id: "tool",
        description: "Must not execute",
        execute: () => {
          toolCalls++;
          return { ok: true };
        },
      } as never,
      timeout: 0,
    });

    await assertRejects(
      () => new StepExecutor({}).execute(node, makeContext()),
      VeryfrontError,
      "timeout must be greater than zero",
    );
    assertEquals(toolCalls, 0);
  });
});

describe("StepExecutor timeout isolation", () => {
  it("stops waiting after the cancellation grace when a timed-out tool never settles", async () => {
    using time = new FakeTime();
    const operation = Promise.withResolvers<unknown>();
    const started = Promise.withResolvers<void>();
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
          started.resolve();
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
    try {
      const execution = executor.execute(node, makeContext());
      await started.promise;
      await time.tickAsync(5);
      await time.tickAsync(5);
      result = await execution;
    } finally {
      // A late rejection must remain observed after the public execution settles.
      operation.reject(new Error("late tool rejection"));
      await Promise.resolve();
    }

    assertEquals(result.success, false);
    assertEquals(result.error?.includes("timed out after 5ms"), true);
    assertEquals(receivedSignal instanceof AbortSignal, true);
    assertEquals(receivedSignal?.aborted, true);
    assertEquals(completions, 0);
    assertEquals(attempts, 1);
  });

  it("does not overlap retries when a timed-out tool ignores cancellation", async () => {
    using time = new FakeTime();
    const firstStarted = Promise.withResolvers<void>();
    const secondStarted = Promise.withResolvers<void>();
    const operations: Array<PromiseWithResolvers<void>> = [];
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
          const operation = Promise.withResolvers<void>();
          operations.push(operation);
          (attempts === 1 ? firstStarted : secondStarted).resolve();
          try {
            await operation.promise;
            return { ok: true };
          } finally {
            active--;
          }
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

    const execution = new StepExecutor({}).execute(node, makeContext());
    await firstStarted.promise;
    await time.tickAsync(5);
    assertEquals(attempts, 1);
    assertEquals(active, 1);
    operations[0]!.resolve();
    await time.tickAsync(1);
    await secondStarted.promise;
    await time.tickAsync(5);
    operations[1]!.resolve();
    const result = await execution;

    assertEquals(result.success, false);
    assertEquals(attempts, 2);
    assertEquals(maxActive, 1);
    assertEquals(signals.every((signal) => signal instanceof AbortSignal), true);
    assertEquals(signals.every((signal) => signal?.aborted), true);
  });
});

describe("StepExecutor run scoping", () => {
  it("passes the run id to every step lifecycle hook", async () => {
    const started: Array<[string, string | undefined]> = [];
    const completed: Array<[string, string | undefined]> = [];

    const executor = new StepExecutor({
      toolRegistry: {
        get: () => ({
          id: "echo",
          execute: () => ({ ok: true }),
        }),
      } as never,
      onStepStart: (nodeId, _input, runId) => started.push([nodeId, runId]),
      onStepComplete: (nodeId, _output, runId) => completed.push([nodeId, runId]),
    });

    const node = { id: "s1", config: { type: "step", tool: "echo" } } as never;
    await executor.execute(node, { input: {} } as never, undefined, "run-abc");

    assertEquals(started, [["s1", "run-abc"]]);
    assertEquals(completed, [["s1", "run-abc"]]);
  });

  it("reports the run id for a failing step", async () => {
    const errors: Array<[string, string | undefined]> = [];

    const executor = new StepExecutor({
      toolRegistry: {
        get: () => ({
          id: "boom",
          execute: () => {
            throw new Error("nope");
          },
        }),
      } as never,
      onStepError: (nodeId, _error, runId) => errors.push([nodeId, runId]),
    });

    const node = { id: "s2", config: { type: "step", tool: "boom" } } as never;
    const result = await executor.execute(node, { input: {} } as never, undefined, "run-xyz");

    assertEquals(result.success, false);
    assertEquals(errors, [["s2", "run-xyz"]]);
  });
});

describe("StepExecutor agent structured output", () => {
  /** An agent whose `generate()` returns `response`, as the real runtime does. */
  function makeAgentStepNode(response: Record<string, unknown>): WorkflowNode {
    return step("extract", {
      agent: {
        id: "extractor",
        generate: () => Promise.resolve(response),
        // deno-lint-ignore no-explicit-any
      } as any,
    });
  }

  it("forwards the validated object from an agent declaring an outputSchema", async () => {
    const node = makeAgentStepNode({
      text: '{"name":"Max"}',
      object: { name: "Max" },
      status: "completed",
      usage: { totalTokens: 7 },
    });

    const result = await new StepExecutor({}).execute(node, makeContext());

    assertEquals(result.success, true);
    // A later step reads `context.extract.object`; dropping it here makes the
    // agent's structured output unreachable from inside a workflow.
    assertEquals((result.output as { object?: unknown }).object, { name: "Max" });
  });

  it("still forwards the other response fields alongside the object", async () => {
    const toolCalls = [{ id: "c1", name: "lookup", args: {} }];
    const node = makeAgentStepNode({
      text: '{"name":"Max"}',
      object: { name: "Max" },
      toolCalls,
      status: "completed",
      usage: { totalTokens: 7 },
    });

    const result = await new StepExecutor({}).execute(node, makeContext());

    assertEquals(result.output, {
      text: '{"name":"Max"}',
      toolCalls,
      status: "completed",
      usage: { totalTokens: 7 },
      object: { name: "Max" },
    });
  });

  it("survives a durable round-trip unchanged", async () => {
    // The durable path persists workflow context with JSON.stringify, which
    // drops undefined-valued keys. If the stored output carried any, the same
    // run would present one shape in memory and another after a pause/resume.
    const node = makeAgentStepNode({
      text: "hi",
      toolCalls: undefined,
      object: undefined,
      status: "completed",
      usage: undefined,
    });

    const result = await new StepExecutor({}).execute(node, makeContext());

    assertEquals(result.output, JSON.parse(JSON.stringify(result.output)));
  });

  it("omits response fields the agent did not produce", async () => {
    // Not just `object`: `toolCalls` and `usage` were stored as present-but-
    // undefined keys, so `"usage" in ctx.step` answered differently before and
    // after a resume.
    const node = makeAgentStepNode({ text: "hi", status: "completed" });

    const result = await new StepExecutor({}).execute(node, makeContext());

    assertEquals(Object.keys(result.output as object), ["text", "status"]);
  });

  it("omits the object key entirely for an agent with no outputSchema", async () => {
    const node = makeAgentStepNode({
      text: "plain text",
      status: "completed",
      usage: { totalTokens: 3 },
    });

    const result = await new StepExecutor({}).execute(node, makeContext());

    // Absent, not present-and-undefined, so a schemaless agent's output gains
    // no key and the fields it did produce are untouched.
    assertEquals(Object.hasOwn(result.output as object, "object"), false);
    assertEquals((result.output as { usage?: unknown }).usage, { totalTokens: 3 });
  });
});

describe("StepExecutor node states", () => {
  it("removes stale terminal fields when a step changes outcome", () => {
    const executor = new StepExecutor({});
    const failed: NodeState = {
      nodeId: "step",
      status: "failed",
      attempt: 1,
      startedAt: new Date(0),
      completedAt: new Date(1),
      error: "old failure",
    };
    const completed: NodeState = {
      nodeId: "step",
      status: "completed",
      attempt: 1,
      startedAt: new Date(0),
      completedAt: new Date(1),
      output: { stale: true },
    };

    const success = executor.createCompletedState(
      { success: true, output: { fresh: true }, executionTime: 1 },
      failed,
    );
    const failure = executor.createCompletedState(
      { success: false, error: "new failure", executionTime: 1 },
      completed,
    );

    assertEquals(success.status, "completed");
    assertEquals(success.output, { fresh: true });
    assertEquals(Object.hasOwn(success, "error"), false);
    assertEquals(failure.status, "failed");
    assertEquals(failure.error, "new failure");
    assertEquals(Object.hasOwn(failure, "output"), false);
  });
});
