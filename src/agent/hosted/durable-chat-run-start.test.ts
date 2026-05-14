import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ChatUiMessage } from "#veryfront/chat/types.ts";
import {
  type AgUiResumeValue,
  createDetachedRunTracker,
  type ParsedHostedChatRequest,
} from "../index.ts";
import {
  executeHostedDurableChatRun,
  resolveHostedDurableRunSetupErrorResponse,
} from "./durable-chat-run-start.ts";

const userMessage: ChatUiMessage = {
  id: "message-1",
  role: "user",
  parts: [{ type: "text", text: "Hello" }],
};

function createParsedRequest(
  overrides: Partial<ParsedHostedChatRequest> = {},
): ParsedHostedChatRequest {
  const conversationId = crypto.randomUUID();
  return {
    userId: "user-1",
    authToken: "token-1",
    messages: [userMessage],
    validatedContext: {
      conversationId,
      projectId: "project-1",
      branchId: "branch-1",
    },
    projectId: "project-1",
    conversationId,
    parentRunId: "run-1",
    upstreamParentConversationId: undefined,
    upstreamParentRunId: undefined,
    spawnedFromToolCallId: undefined,
    model: "anthropic/claude-sonnet-4-6",
    allowDelegation: true,
    forwardedProps: { activeChatId: "chat-1" },
    runtimeOverrides: undefined,
    durableRootRun: {
      runId: "run-1",
      messageId: "message-1",
    },
    persistLatestUserMessageBeforeDurableRun: false,
    ...overrides,
  };
}

function createRequest(): Request {
  return new Request("https://agent.example.com/api/runs", { method: "POST" });
}

async function readJson(response: Response): Promise<unknown> {
  return await response.json();
}

describe("agent/hosted-durable-chat-run-start", () => {
  it("starts a detached durable chat run through the shared AG-UI start flow", async () => {
    const tracker = createDetachedRunTracker<AgUiResumeValue>();
    const preparedExecution = { id: "execution-1" };
    let prepared = false;
    let started = false;

    const response = await executeHostedDurableChatRun({
      req: createParsedRequest(),
      rawRequest: createRequest(),
      tracker,
      prepareExecution: async () => {
        prepared = true;
        return preparedExecution;
      },
      startDetachedExecution: async ({ execution }) => {
        assertEquals(execution, preparedExecution);
        started = true;
      },
    });

    assertEquals(response.status, 202);
    assertEquals(await readJson(response), { accepted: true, duplicate: false });
    assertEquals(prepared, true);
    assertEquals(started, true);
  });

  it("short-circuits duplicate active runs before preparing execution", async () => {
    const tracker = createDetachedRunTracker<AgUiResumeValue>();
    const req = createParsedRequest();
    if (!req.durableRootRun || !req.conversationId) {
      throw new Error("Expected durable request");
    }
    tracker.sessionManager.startRun({
      runId: req.durableRootRun.runId,
      threadId: req.conversationId,
    });
    let prepared = false;

    const response = await executeHostedDurableChatRun({
      req,
      rawRequest: createRequest(),
      tracker,
      prepareExecution: async () => {
        prepared = true;
        return {};
      },
      startDetachedExecution: async () => {},
    });

    assertEquals(response.status, 202);
    assertEquals(await readJson(response), { accepted: true, duplicate: true });
    assertEquals(prepared, false);
  });

  it("returns a stable error when durable conversation context is missing", async () => {
    const tracker = createDetachedRunTracker<AgUiResumeValue>();

    const response = await executeHostedDurableChatRun({
      req: createParsedRequest({
        conversationId: undefined,
        durableRootRun: undefined,
      }),
      rawRequest: createRequest(),
      tracker,
      prepareExecution: async () => ({}),
      startDetachedExecution: async () => {},
    });

    assertEquals(response.status, 400);
    assertEquals(await readJson(response), {
      errorCode: "DURABLE_CHAT_ROOT_REQUIRES_CONVERSATION",
    });
  });

  it("maps auth setup failures with the supplied auth resolver", async () => {
    const tracker = createDetachedRunTracker<AgUiResumeValue>();

    const response = await executeHostedDurableChatRun({
      req: createParsedRequest(),
      rawRequest: createRequest(),
      tracker,
      prepareExecution: async () => {
        throw new Error("denied");
      },
      startDetachedExecution: async () => {},
      resolveAuthError: (error) =>
        error instanceof Error && error.message === "denied"
          ? { errorCode: "FORBIDDEN", statusCode: 403 }
          : null,
    });

    assertEquals(response.status, 403);
    assertEquals(await readJson(response), { errorCode: "FORBIDDEN" });
  });

  it("maps provider setup failures to durable setup responses", async () => {
    const tracker = createDetachedRunTracker<AgUiResumeValue>();

    const response = await executeHostedDurableChatRun({
      req: createParsedRequest(),
      rawRequest: createRequest(),
      tracker,
      prepareExecution: async () => {
        throw new Error("prompt is too long");
      },
      startDetachedExecution: async () => {},
    });

    assertEquals(response.status, 413);
    assertEquals(await readJson(response), { errorCode: "CONTEXT_LENGTH_EXCEEDED" });
  });

  it("resolves missing conversation setup errors to a bad request", () => {
    assertEquals(
      resolveHostedDurableRunSetupErrorResponse({
        code: "UNKNOWN_ERROR",
        originalError: new Error("DURABLE_CHAT_ROOT_REQUIRES_CONVERSATION"),
      }),
      {
        errorCode: "DURABLE_CHAT_ROOT_REQUIRES_CONVERSATION",
        statusCode: 400,
      },
    );
  });
});
