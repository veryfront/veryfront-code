import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ChildRunExecutionResult } from "../child-run/execution-snapshot.ts";
import {
  type HostedChildLifecycleAdapter,
  runHostedChildExecutionLifecycle,
  runHostedChildLifecycle,
  shouldSkipHostedChildTerminalPersistence,
} from "./child-lifecycle.ts";
import { HostedChildTerminalStateError } from "./child-status.ts";

describe("agent/hosted-child-lifecycle", () => {
  it("identifies externally persisted terminal states", () => {
    assertEquals(
      shouldSkipHostedChildTerminalPersistence({ terminalErrorCode: "DURABLE_CHILD_CANCELLED" }),
      true,
    );
    assertEquals(
      shouldSkipHostedChildTerminalPersistence({ terminalErrorCode: "DURABLE_CHILD_FAILED" }),
      true,
    );
    assertEquals(
      shouldSkipHostedChildTerminalPersistence({
        terminalErrorCode: "DURABLE_CHILD_COMPLETED_EXTERNALLY",
      }),
      true,
    );
    assertEquals(shouldSkipHostedChildTerminalPersistence({ terminalErrorCode: "OTHER" }), false);
    assertEquals(shouldSkipHostedChildTerminalPersistence({ terminalErrorCode: null }), false);
  });

  it("runs pending, running, and completed around successful execution", async () => {
    const calls: string[] = [];
    const adapter: HostedChildLifecycleAdapter = {
      pending: () => {
        calls.push("pending");
      },
      running: () => {
        calls.push("running");
      },
      completed: () => {
        calls.push("completed");
      },
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
      pending: () => {
        calls.push("pending");
      },
      running: () => {
        calls.push("running");
      },
      failed: (terminalState) => {
        calls.push(`failed:${terminalState.terminalErrorCode}`);
      },
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
    if (result.status !== "completed") {
      assertEquals(result.error, error);
    }
    assertEquals(result.terminalState.terminalErrorMessage, "boom");
  });

  it("dispatches cancelled state and returns the original error", async () => {
    const calls: string[] = [];
    const error = new Error("aborted");
    const adapter: HostedChildLifecycleAdapter = {
      pending: () => {
        calls.push("pending");
      },
      running: () => {
        calls.push("running");
      },
      cancelled: (terminalState) => {
        calls.push(`cancelled:${terminalState.terminalErrorCode}`);
      },
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
    if (result.status !== "completed") {
      assertEquals(result.error, error);
    }
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

  it("runs child execution lifecycle and snapshots successful local results", async () => {
    const calls: string[] = [];
    const adapter: HostedChildLifecycleAdapter = {
      pending: () => {
        calls.push("pending");
      },
      running: () => {
        calls.push("running");
      },
      completed: (terminalState) => {
        calls.push(`completed:${terminalState.usage?.totalTokens ?? 0}`);
      },
    };
    const localResult: ChildRunExecutionResult = {
      success: true,
      description: "Search docs",
      summary: { text: "Found docs" },
      steps: 2,
      toolCalls: [],
      toolResults: [],
      usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
      durationMs: 12,
    };

    const result = await runHostedChildExecutionLifecycle({
      adapter,
      executionFailedCode: "INVOKE_AGENT_FAILED",
      execute: () => localResult,
      getExecutionSnapshot: () => null,
    });

    assertEquals(calls, ["pending", "running", "completed:7"]);
    assertEquals(result.status, "completed");
    if (result.status === "completed") {
      assertEquals(result.result, localResult);
      assertEquals(result.snapshot.fullResultText, "Found docs");
    }
  });

  it("maps failed child execution snapshots to terminal failed states", async () => {
    const calls: string[] = [];
    const adapter: HostedChildLifecycleAdapter = {
      failed: (terminalState) => {
        calls.push(`failed:${terminalState.terminalErrorCode}`);
      },
    };
    const localResult: ChildRunExecutionResult = {
      success: false,
      description: "Search docs",
      error: "search failed",
      steps: 1,
      toolCalls: [],
      toolResults: [],
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      durationMs: 4,
    };

    const result = await runHostedChildExecutionLifecycle({
      adapter,
      executionFailedCode: "INVOKE_AGENT_FAILED",
      execute: () => localResult,
      getExecutionSnapshot: () => null,
    });

    assertEquals(calls, ["failed:INVOKE_AGENT_FAILED"]);
    assertEquals(result.status, "failed");
    assertEquals(result.terminalState.terminalErrorMessage, "search failed");
    assertEquals(result.terminalState.usage?.totalTokens, 3);
  });

  it("maps known provider errors from failed child snapshots to terminal failed states", async () => {
    const calls: string[] = [];
    const adapter: HostedChildLifecycleAdapter = {
      failed: (terminalState) => {
        calls.push(
          `failed:${terminalState.terminalErrorCode}:${terminalState.terminalErrorMessage}`,
        );
      },
    };
    const localResult: ChildRunExecutionResult = {
      success: false,
      description: "Search docs",
      error:
        'veryfront-cloud request failed: {"slug":"insufficient-credits","error":"AI credit limit exceeded","suggestion":"Purchase credits."}',
      steps: 0,
      toolCalls: [],
      toolResults: [],
      durationMs: 4,
    };

    const result = await runHostedChildExecutionLifecycle({
      adapter,
      executionFailedCode: "INVOKE_AGENT_FAILED",
      execute: () => localResult,
      getExecutionSnapshot: () => null,
    });

    assertEquals(calls, ["failed:INSUFFICIENT_CREDITS:Purchase credits."]);
    assertEquals(result.status, "failed");
    assertEquals(result.terminalState.terminalErrorCode, "INSUFFICIENT_CREDITS");
    assertEquals(result.terminalState.terminalErrorMessage, "Purchase credits.");
  });

  it("skips selected terminal persistence while preserving failure state", async () => {
    const calls: string[] = [];
    const adapter: HostedChildLifecycleAdapter = {
      failed: () => {
        calls.push("failed");
      },
    };
    const localResult: ChildRunExecutionResult = {
      success: false,
      description: "Search docs",
      error: "already persisted",
      steps: 1,
      toolCalls: [],
      toolResults: [],
      durationMs: 4,
    };

    const result = await runHostedChildExecutionLifecycle({
      adapter,
      executionFailedCode: "DURABLE_CHILD_FAILED",
      execute: () => localResult,
      getExecutionSnapshot: () => null,
      skipTerminalPersistence: (terminalState) =>
        terminalState.terminalErrorCode === "DURABLE_CHILD_FAILED",
    });

    assertEquals(calls, []);
    assertEquals(result.status, "failed");
    assertEquals(result.terminalState.terminalErrorCode, "DURABLE_CHILD_FAILED");
  });

  it("preserves external terminal status without re-persisting it", async () => {
    const calls: string[] = [];
    const adapter: HostedChildLifecycleAdapter = {
      completed: () => {
        calls.push("completed");
      },
      failed: () => {
        calls.push("failed");
      },
      cancelled: () => {
        calls.push("cancelled");
      },
    };

    const result = await runHostedChildExecutionLifecycle({
      adapter,
      executionFailedCode: "INVOKE_AGENT_FAILED",
      execute: () => {
        throw new HostedChildTerminalStateError("completed", {
          childConversationId: "conversation-1",
          childRunId: "run-1",
          childMessageId: "message-1",
          latestEventId: 1,
          latestExternalEventSequence: 1,
        });
      },
      getExecutionSnapshot: () => null,
    });

    assertEquals(calls, []);
    assertEquals(result.status, "failed");
    assertEquals(result.terminalState.status, "completed");
    assertEquals(result.terminalState.terminalErrorCode, "DURABLE_CHILD_COMPLETED_EXTERNALLY");
  });
});
