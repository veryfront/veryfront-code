import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createConversationHostedTerminalAdapter,
  toConversationHostedTerminalState,
} from "./conversation-hosted-terminal.ts";

type RecordedCall = {
  input: string | URL | Request;
  init: RequestInit | undefined;
  body: Record<string, unknown> | null;
};

const calls: RecordedCall[] = [];

function installFetchMock() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
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
  };
  return () => {
    globalThis.fetch = originalFetch;
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
            usage: { inputTokens: 1, outputTokens: 2, cachedInputTokens: 3 },
          },
        },
      }),
      {
        status: "failed",
        terminalErrorCode: "ERR",
        terminalErrorMessage: "boom",
        metadata: {
          modelId: "fallback-model",
          usage: { inputTokens: 1, outputTokens: 2, cachedInputTokens: 3 },
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
          status: "running",
        },
        fallbackModelId: "fallback-model",
        resolveProvider: (modelId) => `provider:${modelId}`,
      });

      await adapter.finalizeRun({
        status: "completed",
        metadata: {
          usage: { inputTokens: 4, outputTokens: 6, cachedInputTokens: 2 },
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
});
