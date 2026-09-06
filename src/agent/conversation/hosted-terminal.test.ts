import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type ConversationHostedTerminalRuntimeAdapter,
  type ConversationHostedTerminalStateInput,
  createConversationHostedTerminalAdapter,
  dispatchConversationHostedStreamErrorState,
  dispatchConversationHostedTerminalState,
  resolveConversationHostedStreamErrorState,
  resolveConversationHostedTerminalState,
  toConversationHostedTerminalState,
} from "./hosted-terminal.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";

type RecordedCall = {
  input: string | URL | Request;
  init: RequestInit | undefined;
  body: Record<string, unknown> | null;
};

const calls: RecordedCall[] = [];

function installFetchMock() {
  installMockFetch(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      input,
      init,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return new Response(
      JSON.stringify({
        completed: true,
        run: { runId: "run-1", status: "completed" },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  });
  return () => {
    restoreMockFetch();
  };
}

describe("agent/conversation-hosted-terminal", () => {
  it("fills hosted terminal metadata with the fallback model", () => {
    assertEquals(
      toConversationHostedTerminalState({
        fallbackModelId: "fallback-model",
        state: {
          status: "failed",
          terminalErrorCode: "ERR",
          terminalErrorMessage: "boom",
          metadata: {
            usage: {
              inputTokens: 1,
              outputTokens: 2,
              cachedInputTokens: 3,
            },
            usageCaptureStatus: "complete",
          },
        },
      }),
      {
        status: "failed",
        terminalErrorCode: "ERR",
        terminalErrorMessage: "boom",
        metadata: {
          modelId: "fallback-model",
          usage: {
            inputTokens: 1,
            outputTokens: 2,
            cachedInputTokens: 3,
          },
          usageCaptureStatus: "complete",
        },
      },
    );
  });

  it("finalizes a durable run with normalized model and usage", async () => {
    calls.length = 0;
    const restoreFetch = installFetchMock();
    try {
      const adapter = createConversationHostedTerminalAdapter({
        authToken: "tok",
        apiUrl: "https://api.example.com",
        run: {
          conversationId: "conv-1",
          runId: "run-1",
          messageId: "msg-1",
          latestEventId: 0,
          latestExternalEventSequence: 0,
          waitingToolCallId: null,
          waitingToolName: null,
          streamProtocolVersion: 2,
          status: "running",
        },
        fallbackModelId: "fallback-model",
        resolveProvider: (modelId) => `provider:${modelId}`,
      });

      await adapter.finalizeRun({
        status: "completed",
        metadata: {
          usage: {
            inputTokens: 4,
            outputTokens: 6,
            cachedInputTokens: 2,
          },
          usageCaptureStatus: "complete",
        },
      });

      assertEquals(calls.length, 1);
      assertEquals(calls[0]?.body, {
        status: "completed",
        metadata: {
          provider: "provider:fallback-model",
          model: "fallback-model",
          inputTokens: 4,
          outputTokens: 6,
          usageCaptureStatus: "complete",
          finishReason: "stop",
        },
        terminal_error_code: null,
        terminal_error_message: null,
      });
    } finally {
      restoreFetch();
    }
  });

  it("preserves an explicit missing usage status without token metadata", async () => {
    calls.length = 0;
    const restoreFetch = installFetchMock();
    try {
      const adapter = createConversationHostedTerminalAdapter({
        authToken: "tok",
        apiUrl: "https://api.example.com",
        run: {
          conversationId: "conv-1",
          runId: "run-1",
          messageId: "msg-1",
          latestEventId: 0,
          latestExternalEventSequence: 0,
          waitingToolCallId: null,
          waitingToolName: null,
          streamProtocolVersion: 2,
          status: "running",
        },
        fallbackModelId: "fallback-model",
        resolveProvider: (modelId) => `provider:${modelId}`,
      });

      await adapter.finalizeRun({
        status: "completed",
        metadata: { usageCaptureStatus: "missing" },
      });

      assertEquals(calls[0]?.body, {
        status: "completed",
        metadata: {
          provider: "provider:fallback-model",
          model: "fallback-model",
          inputTokens: 0,
          outputTokens: 0,
          usageCaptureStatus: "missing",
          finishReason: "stop",
        },
        terminal_error_code: null,
        terminal_error_message: null,
      });
    } finally {
      restoreFetch();
    }
  });

  it("dispatches terminal state observers even without a durable run", async () => {
    const seen: unknown[] = [];
    const adapter = createConversationHostedTerminalAdapter({
      authToken: "tok",
      apiUrl: "https://api.example.com",
      run: null,
      fallbackModelId: "fallback-model",
      resolveProvider: (modelId) => modelId,
      onTerminalState: (terminalState) => {
        seen.push(terminalState);
      },
    });

    const terminalState = await adapter.dispatch({
      status: "completed",
      metadata: {
        modelId: "resolved-model",
        usage: { inputTokens: 1, outputTokens: 2 },
      },
    });

    assertEquals(terminalState, {
      status: "completed",
      metadata: {
        modelId: "resolved-model",
        usage: { inputTokens: 1, outputTokens: 2 },
      },
    });
    assertEquals(seen, [terminalState]);
  });

  it("dispatches a durable run only once but still calls observers on later terminal states", async () => {
    calls.length = 0;
    const seen: string[] = [];
    const restoreFetch = installFetchMock();
    try {
      const adapter = createConversationHostedTerminalAdapter({
        authToken: "tok",
        apiUrl: "https://api.example.com",
        run: {
          conversationId: "conv-1",
          runId: "run-1",
          messageId: "msg-1",
          latestEventId: 0,
          latestExternalEventSequence: 0,
          waitingToolCallId: null,
          waitingToolName: null,
          streamProtocolVersion: 2,
          status: "running",
        },
        fallbackModelId: "fallback-model",
        resolveProvider: (modelId) => modelId,
        onTerminalState: (terminalState) => {
          seen.push(terminalState.status);
        },
      });

      await adapter.dispatch({ status: "completed" });
      await adapter.dispatch({
        status: "failed",
        terminalErrorCode: "ERR",
        terminalErrorMessage: "boom",
      });

      assertEquals(calls.length, 1);
      assertEquals(seen, ["completed", "failed"]);
    } finally {
      restoreFetch();
    }
  });

  it("retries the durable finalize after a failed completion request", async () => {
    const attempts: string[] = [];
    installMockFetch(async (input: string | URL | Request, _init?: RequestInit) => {
      attempts.push(String(input));
      if (attempts.length === 1) {
        return new Response(JSON.stringify({ error: "boom" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          completed: true,
          run: { runId: "run-1", status: "completed" },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    try {
      const adapter = createConversationHostedTerminalAdapter({
        authToken: "tok",
        apiUrl: "https://api.example.com",
        run: {
          conversationId: "conv-1",
          runId: "run-1",
          messageId: "msg-1",
          latestEventId: 0,
          latestExternalEventSequence: 0,
          waitingToolCallId: null,
          waitingToolName: null,
          streamProtocolVersion: 2,
          status: "running",
        },
        fallbackModelId: "fallback-model",
        resolveProvider: (modelId) => modelId,
      });

      await assertRejects(
        () => adapter.dispatch({ status: "completed" }),
        Error,
        undefined,
        "a failed completion request must reject the dispatch",
      );

      await adapter.dispatch({ status: "completed" });

      assertEquals(
        attempts.length,
        2,
        "a failed finalize must leave the durable run finalizable",
      );
      assertEquals(
        attempts[1],
        "https://api.example.com/runs/run-1/complete",
        "the retry must target the same durable run completion endpoint",
      );
    } finally {
      restoreMockFetch();
    }
  });

  it("resolves reusable terminal states from stream conditions", () => {
    assertEquals(
      resolveConversationHostedTerminalState({
        isAborted: true,
        hasIncompleteToolParts: true,
      }),
      {
        status: "cancelled",
        terminalErrorCode: "ABORTED",
        terminalErrorMessage: "Chat stream aborted",
      },
    );

    assertEquals(
      resolveConversationHostedTerminalState({
        isAborted: false,
        hasIncompleteToolParts: true,
      }),
      {
        status: "failed",
        terminalErrorCode: "INCOMPLETE_TOOL_CALLS",
        terminalErrorMessage: "Assistant completed before tool execution completed",
      },
    );

    assertEquals(
      resolveConversationHostedTerminalState({
        isAborted: false,
        hasIncompleteToolParts: false,
      }),
      { status: "completed" },
    );
  });

  it("resolves reusable stream error terminal states", () => {
    assertEquals(resolveConversationHostedStreamErrorState(new Error("boom")), {
      status: "failed",
      terminalErrorCode: "STREAM_ERROR",
      terminalErrorMessage: "boom",
    });
    assertEquals(resolveConversationHostedStreamErrorState("raw"), {
      status: "failed",
      terminalErrorCode: "STREAM_ERROR",
      terminalErrorMessage: "raw",
    });
  });

  it("preserves structured insufficient-credit stream errors", () => {
    const error = Object.assign(
      new Error("veryfront-cloud request failed: Provider request failed with status 402"),
      {
        responseBody: JSON.stringify({
          slug: "insufficient-credits",
          error: "AI credit limit exceeded",
          suggestion: "Purchase additional credits or select a lower-cost model.",
        }),
      },
    );

    assertEquals(resolveConversationHostedStreamErrorState(error), {
      status: "failed",
      terminalErrorCode: "INSUFFICIENT_CREDITS",
      terminalErrorMessage:
        "Insufficient AI credits. Purchase additional credits or upgrade your subscription plan.",
    });
  });

  it("dispatches reusable terminal runtime adapters", async () => {
    const calls: string[] = [];
    const adapter: ConversationHostedTerminalRuntimeAdapter = {
      terminal: {
        toTerminalState: (state: ConversationHostedTerminalStateInput) => ({
          status: state.status,
          ...(state.terminalErrorCode !== undefined
            ? { terminalErrorCode: state.terminalErrorCode }
            : {}),
          ...(state.terminalErrorMessage !== undefined
            ? { terminalErrorMessage: state.terminalErrorMessage }
            : {}),
        }),
        finalizeRun: async (state) => {
          calls.push(`finalize:${state.status}`);
        },
        cancelRun: async (state) => {
          calls.push(`cancel:${state.status}`);
        },
        onTerminalState: async (state) => {
          calls.push(`observed:${state.status}`);
        },
      },
    };

    await dispatchConversationHostedTerminalState(adapter, { status: "completed" });
    await dispatchConversationHostedTerminalState(adapter, { status: "cancelled" });

    assertEquals(calls, [
      "finalize:completed",
      "observed:completed",
      "cancel:cancelled",
      "observed:cancelled",
    ]);
  });

  it("skips durable run finalization when the run is already terminal server-side", async () => {
    const calls: string[] = [];
    const adapter: ConversationHostedTerminalRuntimeAdapter = {
      terminal: {
        toTerminalState: (state: ConversationHostedTerminalStateInput) => ({
          status: state.status,
          ...(state.terminalErrorCode !== undefined
            ? { terminalErrorCode: state.terminalErrorCode }
            : {}),
          ...(state.terminalErrorMessage !== undefined
            ? { terminalErrorMessage: state.terminalErrorMessage }
            : {}),
        }),
        finalizeRun: async (state) => {
          calls.push(`finalize:${state.status}`);
        },
        cancelRun: async (state) => {
          calls.push(`cancel:${state.status}`);
        },
        onTerminalState: async (state) => {
          calls.push(`observed:${state.status}`);
        },
      },
    };

    const completedState = await dispatchConversationHostedTerminalState(
      adapter,
      { status: "completed" },
      { skipDurableRunFinalization: true },
    );
    const cancelledState = await dispatchConversationHostedTerminalState(
      adapter,
      { status: "cancelled" },
      { skipDurableRunFinalization: true },
    );

    assertEquals(
      calls,
      ["observed:completed", "observed:cancelled"],
      "skipDurableRunFinalization must suppress finalizeRun and cancelRun while still reporting the terminal state",
    );
    assertEquals(
      completedState.status,
      "completed",
      "a skipped finalization still reports the completed terminal state",
    );
    assertEquals(
      cancelledState.status,
      "cancelled",
      "a skipped finalization still reports the cancelled terminal state",
    );
  });

  it("dispatches reusable stream error states", async () => {
    const seen: unknown[] = [];
    const adapter: ConversationHostedTerminalRuntimeAdapter = {
      terminal: {
        toTerminalState: (state: ConversationHostedTerminalStateInput) => ({
          status: state.status,
          ...(state.terminalErrorCode !== undefined
            ? { terminalErrorCode: state.terminalErrorCode }
            : {}),
          ...(state.terminalErrorMessage !== undefined
            ? { terminalErrorMessage: state.terminalErrorMessage }
            : {}),
        }),
        finalizeRun: async (state) => {
          seen.push(["finalize", state]);
        },
        cancelRun: async (state) => {
          seen.push(["cancel", state]);
        },
        onTerminalState: async (state) => {
          seen.push(["observed", state]);
        },
      },
    };

    const terminalState = await dispatchConversationHostedStreamErrorState(
      adapter,
      new Error("boom"),
    );

    assertEquals(terminalState, {
      status: "failed",
      terminalErrorCode: "STREAM_ERROR",
      terminalErrorMessage: "boom",
    });
    assertEquals(seen, [
      ["finalize", terminalState],
      ["observed", terminalState],
    ]);
  });
});
