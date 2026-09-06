import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildProviderError } from "#veryfront/provider/runtime-loader/provider-http.ts";
import type {
  ChildRunExecutionResult,
  ChildRunExecutionSnapshot,
} from "../child-run/execution-snapshot.ts";
import {
  HOSTED_CHILD_FINALIZATION_FAILED_CODE,
  type HostedChildLifecycleAdapter,
  runHostedChildExecutionLifecycle,
  runHostedChildLifecycle,
  shouldSkipHostedChildTerminalPersistence,
} from "./child-lifecycle.ts";
import { handleHostedChildForkFailure } from "./child-fork-stream-execution.ts";
import { HostedChildTerminalStateError } from "./child-status.ts";
import { getHostedStreamErrorText } from "./stream-terminal-error.ts";
import { ForkRuntimeStreamError } from "../streaming/fork-runtime-types.ts";

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

  it("keeps the bare cancelled message for a genuine abort", async () => {
    const abortController = new AbortController();
    abortController.abort();
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";

    const result = await runHostedChildExecutionLifecycle({
      adapter: {},
      executionFailedCode: "INVOKE_AGENT_FAILED",
      abortSignal: abortController.signal,
      execute: () => {
        throw abortError;
      },
      getExecutionSnapshot: () => null,
    });

    assertEquals(result.status, "cancelled", "an abort is still a cancellation");
    assertEquals(
      result.terminalState.terminalErrorMessage,
      "Child run cancelled",
      "a real abort carries no extra cause",
    );
  });

  it("preserves the real cause when an error merely coincides with an abort", async () => {
    const abortController = new AbortController();
    abortController.abort();

    const result = await runHostedChildExecutionLifecycle({
      adapter: {},
      executionFailedCode: "INVOKE_AGENT_FAILED",
      abortSignal: abortController.signal,
      execute: () => {
        throw new Error("upstream connection reset");
      },
      getExecutionSnapshot: () => null,
    });

    assertEquals(
      result.status,
      "cancelled",
      "a torn-down run still reports cancelled, not failed",
    );
    assertEquals(
      result.terminalState.terminalErrorCode,
      "CANCELLED",
      "the contractual code is unchanged",
    );
    assertEquals(
      result.terminalState.terminalErrorMessage,
      "Child run cancelled: upstream connection reset",
      "the underlying cause survives instead of being overwritten",
    );
  });

  it("strips credentials from a coincident cause before persisting it", async () => {
    const abortController = new AbortController();
    abortController.abort();

    const result = await runHostedChildExecutionLifecycle({
      adapter: {},
      executionFailedCode: "INVOKE_AGENT_FAILED",
      abortSignal: abortController.signal,
      execute: () => {
        throw new Error("fetch failed for https://user:hunter2@api.example.com/v1/run");
      },
      getExecutionSnapshot: () => null,
    });

    const message = result.terminalState.terminalErrorMessage ?? "";
    assertEquals(
      message.includes("hunter2"),
      false,
      "url credentials must not reach the durable run record",
    );
    assertEquals(
      message.startsWith("Child run cancelled: "),
      true,
      "the sanitized cause is still carried",
    );
  });

  it("bounds a bulk coincident cause to an excerpt", async () => {
    const abortController = new AbortController();
    abortController.abort();

    const result = await runHostedChildExecutionLifecycle({
      adapter: {},
      executionFailedCode: "INVOKE_AGENT_FAILED",
      abortSignal: abortController.signal,
      execute: () => {
        throw new Error("x".repeat(5_000));
      },
      getExecutionSnapshot: () => null,
    });

    const message = result.terminalState.terminalErrorMessage ?? "";
    assertEquals(
      message.length < 250,
      true,
      "a provider response body must not be persisted whole",
    );
    assertEquals(message.endsWith("..."), true, "truncation is visible in the message");
  });

  it("strips credentials from a failed run's message", async () => {
    const result = await runHostedChildExecutionLifecycle({
      adapter: {},
      executionFailedCode: "INVOKE_AGENT_FAILED",
      execute: () => {
        throw new Error("post to https://svc:hunter2@api.example.com/v1/chat failed");
      },
      getExecutionSnapshot: () => null,
    });

    assertEquals(result.status, "failed", "the run still reports failed");
    // Exact rather than substring checks: this pins that only the password is
    // masked and the rest of the message survives verbatim.
    assertEquals(
      result.terminalState.terminalErrorMessage,
      "post to https://svc:[REDACTED]@api.example.com/v1/chat failed",
      "the password is masked while the actionable message survives",
    );
  });

  it("keeps a realistic provider error intact", async () => {
    const providerError = "Invalid request: messages[3].content must be a string, got object. " +
      "See https://docs.example.com/errors#invalid-request for details.";

    const result = await runHostedChildExecutionLifecycle({
      adapter: {},
      executionFailedCode: "INVOKE_AGENT_FAILED",
      execute: () => {
        throw new Error(providerError);
      },
      getExecutionSnapshot: () => null,
    });

    assertEquals(
      result.terminalState.terminalErrorMessage,
      providerError,
      "a normal provider error is not truncated — this is what a user reads to debug",
    );
  });

  it("cuts a bulk payload out of a failed run's message", async () => {
    const result = await runHostedChildExecutionLifecycle({
      adapter: {},
      executionFailedCode: "INVOKE_AGENT_FAILED",
      execute: () => {
        throw new Error("z".repeat(60_000));
      },
      getExecutionSnapshot: () => null,
    });

    const message = result.terminalState.terminalErrorMessage ?? "";
    assertEquals(
      message.length <= 4_000,
      true,
      "a response body must not be persisted whole",
    );
    assertEquals(message.endsWith("..."), true, "truncation is visible in the message");
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

  it("reports terminal hook errors through onLifecycleError for completed states", async () => {
    const calls: string[] = [];
    const lifecycleErrors: unknown[] = [];
    const adapter: HostedChildLifecycleAdapter = {
      completed: () => {
        calls.push("completed");
        throw new Error("Required durable run event was not flushed");
      },
      failed: () => {
        calls.push("failed");
      },
    };

    const result = await runHostedChildLifecycle({
      adapter,
      execute: async () => "ok",
      resolveErrorState: () => ({
        status: "failed",
        terminalErrorCode: "STREAM_ERROR",
        terminalErrorMessage: "boom",
      }),
      onLifecycleError: (error) => {
        lifecycleErrors.push(error);
      },
    });

    assertEquals(lifecycleErrors.length, 1);
    // The adapter already rejected this terminal state; dispatching again would
    // write a second terminal state for the same run.
    assertEquals(calls, ["completed"]);
    assertEquals(result.status, "failed");
    assertEquals(
      result.terminalState.terminalErrorCode,
      HOSTED_CHILD_FINALIZATION_FAILED_CODE,
    );
  });

  it("keeps the finalization outcome when onLifecycleError itself throws", async () => {
    const calls: string[] = [];
    let lifecycleErrorCalls = 0;
    const adapter: HostedChildLifecycleAdapter = {
      completed: () => {
        calls.push("completed");
        throw new Error("persist failed");
      },
      failed: () => {
        calls.push("failed");
      },
    };

    const result = await runHostedChildLifecycle({
      adapter,
      execute: async () => "ok",
      resolveErrorState: () => ({
        status: "failed",
        terminalErrorCode: "STREAM_ERROR",
        terminalErrorMessage: "boom",
      }),
      onLifecycleError: () => {
        lifecycleErrorCalls += 1;
        throw new Error("reporting failed");
      },
    });

    // A failing observability callback must not relabel the outcome, trigger a
    // second terminal dispatch, or be reported more than once.
    assertEquals(calls, ["completed"]);
    assertEquals(lifecycleErrorCalls, 1);
    assertEquals(result.status, "failed");
    assertEquals(
      result.terminalState.terminalErrorCode,
      HOSTED_CHILD_FINALIZATION_FAILED_CODE,
    );
    assertEquals(result.terminalState.terminalErrorMessage, "persist failed");
  });

  it("keeps completion usage on a finalization failure", async () => {
    const adapter: HostedChildLifecycleAdapter = {
      completed: () => {
        throw new Error("persist failed");
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
        terminalErrorCode: "STREAM_ERROR",
        terminalErrorMessage: "boom",
      }),
      onLifecycleError: () => {},
    });

    assertEquals(result.status, "failed");
    assertEquals(result.terminalState.usage, {
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
    });
  });

  it("does not relabel a completion persistence failure as an execution failure", async () => {
    const calls: string[] = [];
    const adapter: HostedChildLifecycleAdapter = {
      completed: () => {
        calls.push("completed");
        throw new Error("Required durable run event was not flushed");
      },
      failed: () => {
        calls.push("failed");
      },
    };
    const localResult: ChildRunExecutionResult = {
      success: true,
      description: "Search docs",
      summary: { text: "Found docs" },
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
      onLifecycleError: () => {},
    });

    assertEquals(calls, ["completed"]);
    assertEquals(result.status, "failed");
    assertEquals(
      result.terminalState.terminalErrorCode,
      HOSTED_CHILD_FINALIZATION_FAILED_CODE,
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

    assertEquals(calls, ["failed:INSUFFICIENT_CREDITS:Insufficient AI credits"]);
    assertEquals(result.status, "failed");
    assertEquals(result.terminalState.terminalErrorCode, "INSUFFICIENT_CREDITS");
    assertEquals(result.terminalState.terminalErrorMessage, "Insufficient AI credits");
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

  it("skips cancelled terminal persistence for externally cancelled durable children", async () => {
    const calls: string[] = [];
    const adapter: HostedChildLifecycleAdapter = {
      cancelled: () => {
        calls.push("cancelled");
      },
      failed: () => {
        calls.push("failed");
      },
    };

    const result = await runHostedChildExecutionLifecycle({
      adapter,
      executionFailedCode: "DURABLE_CHILD_FAILED",
      execute: () => {
        throw new HostedChildTerminalStateError("cancelled", {
          childConversationId: "conversation-1",
          childRunId: "run-1",
          childMessageId: "message-1",
          latestEventId: 1,
          latestExternalEventSequence: 1,
        });
      },
      getExecutionSnapshot: () => null,
      skipTerminalPersistence: shouldSkipHostedChildTerminalPersistence,
    });

    assertEquals(
      calls,
      [],
      "externally cancelled child must not re-persist a cancelled terminal state",
    );
    assertEquals(result.status, "cancelled");
    assertEquals(result.terminalState.terminalErrorCode, "DURABLE_CHILD_CANCELLED");
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

  it("returns externally completed terminal states without rethrowing unexpected final status", async () => {
    const result = await runHostedChildExecutionLifecycle({
      adapter: {
        completed: () => {
          throw new Error("completed terminal persistence must be skipped");
        },
      },
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

    assertEquals(result.status, "failed");
    assertEquals(result.terminalState, {
      status: "completed",
      terminalErrorCode: "DURABLE_CHILD_COMPLETED_EXTERNALLY",
      terminalErrorMessage:
        "Hosted child run run-1 became completed before local execution finished",
    });
  });

  it("keeps a child run's schema rejection classified across the run boundary", async () => {
    // The child run boundary is the route the plain-message matcher in
    // `resolveKnownProviderTerminalError` exists for, so walk it end to end
    // with the real helpers on both sides instead of a hand-built error.
    const providerError = await buildProviderError(
      "anthropic",
      new Response(
        JSON.stringify({
          type: "error",
          error: {
            type: "invalid_request_error",
            message:
              "output_config.format.schema: For 'object' type, 'additionalProperties' must be explicitly set to false",
          },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );

    // Child side. The stream error becomes text (what the runtime's `onError`
    // does), and `handleHostedChildForkFailure` copies that text into the
    // failure snapshot. Nothing structured survives the hop, so the message is
    // all the parent gets.
    const snapshots: ChildRunExecutionSnapshot[] = [];
    const childResult = await handleHostedChildForkFailure({
      error: new Error(getHostedStreamErrorText(providerError)),
      description: "Summarize the repo",
      kind: "invoke_agent",
      finalText: "",
      toolCalls: [],
      toolResults: [],
      startTime: Date.now(),
      onSettled: (snapshot) => {
        snapshots.push(snapshot);
      },
    });

    // Asserted before the leak check below, so that check cannot pass on an
    // empty snapshot list.
    assertEquals(snapshots.length, 1, "the child settles exactly one failure snapshot");
    assertEquals(
      (snapshots[0]?.error ?? "").includes("output_config.format.schema"),
      false,
      "the parent gets our curated wording, not the provider's raw rejection",
    );

    // Parent side. The lifecycle rebuilds the snapshot string as a bare
    // `HostedChildExecutionFailure` and re-classifies it.
    const result = await runHostedChildExecutionLifecycle({
      adapter: {},
      executionFailedCode: "INVOKE_AGENT_FAILED",
      execute: () => Promise.resolve(childResult),
      getExecutionSnapshot: () => snapshots[0] ?? null,
    });

    assertEquals(result.status, "failed");
    // The round trip survives only because the curated message still names
    // both things the matcher keys on. Rewording it, dropping the message from
    // the snapshot, or rebuilding the failure without it all land here as
    // INVOKE_AGENT_FAILED, which is what this assertion catches.
    assertEquals(
      result.terminalState.terminalErrorCode,
      "OUTPUT_SCHEMA_NOT_CLOSED",
      "a child run's schema rejection stays classified after crossing the boundary",
    );
  });

  it("preserves a fork runtime terminal code across the hosted child boundary", async () => {
    const snapshots: ChildRunExecutionSnapshot[] = [];
    const childResult = await handleHostedChildForkFailure({
      error: new ForkRuntimeStreamError(
        "Resource limit exceeded",
        "RESOURCE_LIMIT_EXCEEDED",
      ),
      description: "Summarize the repo",
      kind: "invoke_agent",
      finalText: "",
      toolCalls: [],
      toolResults: [],
      startTime: Date.now(),
      onSettled: (snapshot) => {
        snapshots.push(snapshot);
      },
    });
    const result = await runHostedChildExecutionLifecycle({
      adapter: {},
      executionFailedCode: "INVOKE_AGENT_FAILED",
      execute: () => Promise.resolve(childResult),
      getExecutionSnapshot: () => snapshots[0] ?? null,
    });

    assertEquals(result.status, "failed");
    assertEquals(result.terminalState.terminalErrorCode, "RESOURCE_LIMIT_EXCEEDED");
    assertEquals(result.terminalState.terminalErrorMessage, "Resource limit exceeded");
  });
});
