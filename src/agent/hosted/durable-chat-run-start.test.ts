import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  AGENT_NOT_FOUND,
  NETWORK_ERROR,
  NOT_SUPPORTED,
  PERMISSION_DENIED,
  TIMEOUT_ERROR,
} from "#veryfront/errors";
import type { ChatUiMessage } from "#veryfront/chat/types.ts";
import {
  type AgUiResumeValue,
  createDetachedRunTracker,
  type ParsedHostedChatRequest,
  RunResumeSessionManager,
} from "../index.ts";
import {
  durableChatRunStartInternals,
  executeHostedDurableChatRun,
  prepareDetachedStartMessages,
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
    agentId: undefined,
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

    const rawRequest = createRequest();
    const response = await executeHostedDurableChatRun({
      req: createParsedRequest(),
      rawRequest,
      tracker,
      prepareExecution: async () => {
        prepared = true;
        return preparedExecution;
      },
      startDetachedExecution: async ({ execution, rawRequest: detachedRawRequest }) => {
        assertEquals(execution, preparedExecution);
        assertEquals(detachedRawRequest === rawRequest, false);
        assertEquals(detachedRawRequest.url, rawRequest.url);
        assertEquals(detachedRawRequest.method, rawRequest.method);
        started = true;
      },
    });

    assertEquals(response.status, 202);
    assertEquals(await readJson(response), { accepted: true, duplicate: false });
    assertEquals(prepared, true);
    assertEquals(started, true);
  });

  it("bounds historical tool inputs before building detached start payloads", () => {
    const childPromptMarker = "DETACHED_CHILD_PROMPT_MARKER";
    const messages: ChatUiMessage[] = [
      {
        id: "user-old",
        role: "user",
        parts: [{ type: "text", text: "Build the graph viewer." }],
      },
      {
        id: "assistant-old",
        role: "assistant",
        parts: [{
          type: "dynamic-tool",
          toolName: "invoke_agent",
          toolCallId: "tool-invoke",
          input: {
            agent_id: "codegen",
            description: "Build WebGL graph renderer",
            prompt: `${childPromptMarker}:${"child prompt ".repeat(4000)}`,
          },
          state: "output-available",
          output: { error: "timeout" },
        }],
      },
      {
        id: "user-new",
        role: "user",
        parts: [{ type: "text", text: "Make it draggable." }],
      },
    ];

    const prepared = prepareDetachedStartMessages(messages);
    const serialized = JSON.stringify(prepared);

    assertEquals(serialized.includes(childPromptMarker), false);
    assertStringIncludes(serialized, "historical_tool_input_summary");
    assertStringIncludes(serialized, "Build WebGL graph renderer");
  });

  it("rejects malformed accepted detached-start responses", async () => {
    await assertRejects(
      () =>
        durableChatRunStartInternals.parseAcceptedDetachedStartResponse(
          new Response("{", { status: 202 }),
        ),
      Error,
      "Invalid detached start accepted response",
    );
    await assertRejects(
      () =>
        durableChatRunStartInternals.parseAcceptedDetachedStartResponse(
          new Response(JSON.stringify({ accepted: "yes" }), { status: 202 }),
        ),
      Error,
      "Invalid detached start accepted response: invalid payload",
      "a 202 body that fails the accepted schema must be rejected",
    );
    assertEquals(
      await durableChatRunStartInternals.parseAcceptedDetachedStartResponse(
        new Response(
          JSON.stringify({
            accepted: true,
            duplicate: true,
            runId: "run-1",
            threadId: "11111111-1111-4111-8111-111111111111",
          }),
          { status: 202 },
        ),
      ),
      { accepted: true, duplicate: true },
      "valid payload must map accepted and duplicate flags",
    );
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

  it("releases a prepared execution when the run becomes a duplicate during start", async () => {
    const tracker = createDetachedRunTracker<AgUiResumeValue>();
    const req = createParsedRequest();
    if (!req.durableRootRun || !req.conversationId) {
      throw new Error("Expected durable request");
    }
    const runId = req.durableRootRun.runId;
    const conversationId = req.conversationId;
    const execution = { id: "execution-1" };
    const cleanupCalls: unknown[] = [];

    const response = await executeHostedDurableChatRun({
      req,
      rawRequest: createRequest(),
      tracker,
      prepareExecution: async () => {
        tracker.sessionManager.startRun({ runId, threadId: conversationId });
        return execution;
      },
      cleanupExecution: async (input) => {
        cleanupCalls.push(input);
      },
      startDetachedExecution: async () => {},
    });

    assertEquals(response.status, 202);
    assertEquals(await readJson(response), { accepted: true, duplicate: true });
    assertEquals(
      cleanupCalls,
      [{ execution, runId, conversationId }],
      "duplicate detected after prepare must release the prepared execution",
    );
  });

  it("releases a prepared execution when cancellation wins before start", async () => {
    const tracker = createDetachedRunTracker<AgUiResumeValue>();
    const req = createParsedRequest();
    if (!req.durableRootRun || !req.conversationId) {
      throw new Error("Expected durable request");
    }
    const runId = req.durableRootRun.runId;
    const conversationId = req.conversationId;
    const execution = { id: "execution-1" };
    const cleanupCalls: unknown[] = [];
    tracker.sessionManager.cancelRun(runId, { rememberIfMissing: true });

    const response = await executeHostedDurableChatRun({
      req,
      rawRequest: createRequest(),
      tracker,
      prepareExecution: async () => execution,
      cleanupExecution: async (input) => {
        cleanupCalls.push(input);
      },
      startDetachedExecution: async () => {},
    });

    assertEquals(response.status, 410);
    assertEquals(
      cleanupCalls,
      [{ execution, runId, conversationId }],
      "cancel-before-start must release the prepared execution",
    );
  });

  it("releases a prepared execution when detached admission throws", async () => {
    const sessionManager = new RunResumeSessionManager<AgUiResumeValue>({
      maxConcurrentSessions: 1,
    });
    sessionManager.startRun({ runId: "existing-run", threadId: crypto.randomUUID() });
    const tracker = createDetachedRunTracker<AgUiResumeValue>({ sessionManager });
    const execution = { id: "execution-1" };
    const cleanupCalls: unknown[] = [];

    const response = await executeHostedDurableChatRun({
      req: createParsedRequest(),
      rawRequest: createRequest(),
      tracker,
      prepareExecution: async () => execution,
      cleanupExecution: async (input) => {
        cleanupCalls.push(input);
      },
      startDetachedExecution: async () => {},
    });

    assertEquals(response.status, 500);
    assertEquals(cleanupCalls.length, 1);
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

  it("maps thrown platform errors to their real code and status with a warn-level log", async () => {
    const tracker = createDetachedRunTracker<AgUiResumeValue>();
    const warnLogs: Array<Record<string, unknown> | undefined> = [];
    const errorLogs: Array<Record<string, unknown> | undefined> = [];

    const response = await executeHostedDurableChatRun({
      req: createParsedRequest(),
      rawRequest: createRequest(),
      tracker,
      prepareExecution: async () => {
        throw PERMISSION_DENIED.create({
          detail: 'Client "unknown" is not allowed to use Studio MCP.',
        });
      },
      startDetachedExecution: async () => {},
      logger: {
        warn: (_message, metadata) => {
          warnLogs.push(metadata);
        },
        error: (_message, metadata) => {
          errorLogs.push(metadata);
        },
      },
    });

    assertEquals(response.status, 403);
    assertEquals(await readJson(response), { errorCode: "PERMISSION_DENIED" });
    assertEquals(errorLogs, []);
    assertEquals(warnLogs.length, 1);
    assertEquals(warnLogs[0]?.errorCode, "PERMISSION_DENIED");
    assertEquals(warnLogs[0]?.statusCode, 403);
  });

  it("invokes object-backed warn loggers with their receiver", async () => {
    const tracker = createDetachedRunTracker<AgUiResumeValue>();
    const logger = {
      entries: [] as Array<Record<string, unknown> | undefined>,
      warn(_message: string, metadata?: Record<string, unknown>) {
        this.entries.push(metadata);
      },
      error(_message: string, metadata?: Record<string, unknown>) {
        this.entries.push(metadata);
      },
    };

    const response = await executeHostedDurableChatRun({
      req: createParsedRequest(),
      rawRequest: createRequest(),
      tracker,
      prepareExecution: async () => {
        throw PERMISSION_DENIED.create({ detail: "denied" });
      },
      startDetachedExecution: async () => {},
      logger,
    });

    assertEquals(response.status, 403);
    assertEquals(await readJson(response), { errorCode: "PERMISSION_DENIED" });
    assertEquals(logger.entries.length, 1);
  });

  it("preserves not-found status for missing code agents", async () => {
    const tracker = createDetachedRunTracker<AgUiResumeValue>();

    const response = await executeHostedDurableChatRun({
      req: createParsedRequest(),
      rawRequest: createRequest(),
      tracker,
      prepareExecution: async () => {
        throw AGENT_NOT_FOUND.create({ detail: 'Code agent "missing" was not discovered.' });
      },
      startDetachedExecution: async () => {},
    });

    assertEquals(response.status, 404);
    assertEquals(await readJson(response), { errorCode: "AGENT_NOT_FOUND" });
  });

  it("preserves registered remote MCP setup statuses", async () => {
    for (
      const [error, status, errorCode] of [
        [TIMEOUT_ERROR.create({ detail: "timed out" }), 408, "TIMEOUT_ERROR"],
        [NETWORK_ERROR.create({ detail: "unavailable" }), 502, "NETWORK_ERROR"],
      ] as const
    ) {
      const response = await executeHostedDurableChatRun({
        req: createParsedRequest(),
        rawRequest: createRequest(),
        tracker: createDetachedRunTracker<AgUiResumeValue>(),
        prepareExecution: async () => {
          throw error;
        },
        startDetachedExecution: async () => {},
      });

      assertEquals(response.status, status);
      assertEquals(await readJson(response), { errorCode });
    }
  });

  it("preserves not-supported status for unsupported hosted models", async () => {
    const response = await executeHostedDurableChatRun({
      req: createParsedRequest(),
      rawRequest: createRequest(),
      tracker: createDetachedRunTracker<AgUiResumeValue>(),
      prepareExecution: async () => {
        throw NOT_SUPPORTED.create({ detail: "Unsupported hosted model" });
      },
      startDetachedExecution: async () => {},
    });

    assertEquals(response.status, 501);
    assertEquals(await readJson(response), { errorCode: "NOT_SUPPORTED" });
  });

  it("keeps error-level logging for setup failures that resolve to 5xx", async () => {
    const tracker = createDetachedRunTracker<AgUiResumeValue>();
    const warnLogs: Array<Record<string, unknown> | undefined> = [];
    const errorLogs: Array<Record<string, unknown> | undefined> = [];

    const response = await executeHostedDurableChatRun({
      req: createParsedRequest(),
      rawRequest: createRequest(),
      tracker,
      prepareExecution: async () => {
        throw new Error("provider exploded");
      },
      startDetachedExecution: async () => {},
      logger: {
        warn: (_message, metadata) => {
          warnLogs.push(metadata);
        },
        error: (_message, metadata) => {
          errorLogs.push(metadata);
        },
      },
    });

    assertEquals(response.status, 500);
    assertEquals(await readJson(response), { errorCode: "EXTERNAL_SERVICE_ERROR" });
    assertEquals(warnLogs, []);
    assertEquals(errorLogs.length, 1);
    assertEquals(errorLogs[0]?.errorCode, "EXTERNAL_SERVICE_ERROR");
    assertEquals(errorLogs[0]?.statusCode, 500);
  });

  it("falls back to error-level logging for sub-500 failures when warn is unavailable", async () => {
    const tracker = createDetachedRunTracker<AgUiResumeValue>();
    const errorLogs: Array<Record<string, unknown> | undefined> = [];

    const response = await executeHostedDurableChatRun({
      req: createParsedRequest(),
      rawRequest: createRequest(),
      tracker,
      prepareExecution: async () => {
        throw PERMISSION_DENIED.create({ detail: "denied" });
      },
      startDetachedExecution: async () => {},
      logger: {
        error: (_message, metadata) => {
          errorLogs.push(metadata);
        },
      },
    });

    assertEquals(response.status, 403);
    assertEquals(await readJson(response), { errorCode: "PERMISSION_DENIED" });
    assertEquals(errorLogs.length, 1);
    assertEquals(errorLogs[0]?.errorCode, "PERMISSION_DENIED");
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
