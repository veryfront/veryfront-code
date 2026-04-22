import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type HostedChildLifecycleAdapter,
  runHostedChildLifecycle,
} from "./hosted-child-lifecycle.ts";

describe("agent/hosted-child-lifecycle", () => {
  it("runs pending, running, and completed around successful execution", async () => {
    const calls: string[] = [];
    const adapter: HostedChildLifecycleAdapter = {
      pending: () => calls.push("pending"),
      running: () => calls.push("running"),
      completed: () => calls.push("completed"),
    };

    const result = await runHostedChildLifecycle({
      adapter,
      execute: async () => "ok",
      resolveCompletedState: () => ({
        status: "completed",
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      }),
      resolveErrorState: () => ({
        status: "failed",
        terminalErrorCode: "FAILED",
        terminalErrorMessage: "failed",
      }),
    });

    assertEquals(calls, ["pending", "running", "completed"]);
    assertEquals(result, {
      status: "completed",
      result: "ok",
      terminalState: {
        status: "completed",
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      },
    });
  });

  it("dispatches failed state and returns the original error", async () => {
    const calls: string[] = [];
    const error = new Error("boom");
    const adapter: HostedChildLifecycleAdapter = {
      pending: () => calls.push("pending"),
      running: () => calls.push("running"),
      failed: (terminalState) => calls.push(`failed:${terminalState.terminalErrorCode}`),
    };

    const result = await runHostedChildLifecycle({
      adapter,
      execute: async () => {
        throw error;
      },
      resolveErrorState: (caught) => ({
        status: "failed",
        terminalErrorCode: "STREAM_ERROR",
        terminalErrorMessage: caught instanceof Error ? caught.message : String(caught),
      }),
    });

    assertEquals(calls, ["pending", "running", "failed:STREAM_ERROR"]);
    assertEquals(result.status, "failed");
    assertEquals(result.error, error);
    assertEquals(result.terminalState.terminalErrorMessage, "boom");
  });

  it("dispatches cancelled state and returns the original error", async () => {
    const calls: string[] = [];
    const error = new Error("aborted");
    const adapter: HostedChildLifecycleAdapter = {
      pending: () => calls.push("pending"),
      running: () => calls.push("running"),
      cancelled: (terminalState) => calls.push(`cancelled:${terminalState.terminalErrorCode}`),
    };

    const result = await runHostedChildLifecycle({
      adapter,
      execute: async () => {
        throw error;
      },
      resolveErrorState: () => ({
        status: "cancelled",
        terminalErrorCode: "CANCELLED",
        terminalErrorMessage: "Child run cancelled",
      }),
    });

    assertEquals(calls, ["pending", "running", "cancelled:CANCELLED"]);
    assertEquals(result.status, "cancelled");
    assertEquals(result.error, error);
  });

  it("reports terminal hook errors through onLifecycleError for failure states", async () => {
    const lifecycleErrors: unknown[] = [];
    const adapter: HostedChildLifecycleAdapter = {
      failed: () => {
        throw new Error("persist failed");
      },
    };

    const result = await runHostedChildLifecycle({
      adapter,
      execute: async () => {
        throw new Error("boom");
      },
      resolveErrorState: () => ({
        status: "failed",
        terminalErrorCode: "STREAM_ERROR",
        terminalErrorMessage: "boom",
      }),
      onLifecycleError: (error) => {
        lifecycleErrors.push(error);
      },
    });

    assertEquals(result.status, "failed");
    assertEquals(lifecycleErrors.length, 1);
    assertEquals(
      lifecycleErrors[0] instanceof Error ? lifecycleErrors[0].message : String(lifecycleErrors[0]),
      "persist failed",
    );
  });

  it("still throws lifecycle hook errors on successful completion", async () => {
    const adapter: HostedChildLifecycleAdapter = {
      completed: () => {
        throw new Error("persist failed");
      },
    };

    await assertRejects(
      () =>
        runHostedChildLifecycle({
          adapter,
          execute: async () => "ok",
          resolveErrorState: () => ({
            status: "failed",
            terminalErrorCode: "STREAM_ERROR",
            terminalErrorMessage: "boom",
          }),
        }),
      Error,
      "persist failed",
    );
  });
});
