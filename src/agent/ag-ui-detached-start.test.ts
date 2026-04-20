import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  AgentRuntime,
  AgUiDetachedStartRequestSchema,
  createAgUiDetachedStartHandler,
  RunResumeSessionManager,
} from "./index.ts";
import type { Agent, Message } from "./types.ts";

const encoder = new TextEncoder();

function encodeDataStreamEvent(payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

function createTestAgent(): Agent {
  return {
    id: "assistant-1",
    config: {
      id: "assistant-1",
      system: "You are helpful.",
      model: "anthropic/claude-sonnet-4-6",
    } as Agent["config"],
    generate: async () => {
      throw new Error("not used");
    },
    stream: async () => {
      throw new Error("not used");
    },
    respond: async () => new Response("not used"),
    getMemory: () => {
      throw new Error("not used");
    },
    getMemoryStats: async () => ({
      totalMessages: 0,
      estimatedTokens: 0,
      type: "conversation",
    }),
    clearMemory: async () => {},
  };
}

function createDetachedRequest(
  overrides: Record<string, unknown> = {},
): Request {
  return new Request("http://localhost/api/ag-ui/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      runId: "run_1",
      threadId: crypto.randomUUID(),
      messages: [{
        id: "msg-1",
        role: "user",
        parts: [{ type: "text", text: "hello" }],
      }],
      ...overrides,
    }),
  });
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

describe("agent/ag-ui-detached-start", () => {
  it("requires explicit run and thread ids", () => {
    const parsed = AgUiDetachedStartRequestSchema.parse({
      runId: "run_1",
      threadId: crypto.randomUUID(),
      messages: [{
        id: "msg-1",
        role: "user",
        parts: [{ type: "text", text: "hello" }],
      }],
    });

    assertEquals(parsed.runId, "run_1");
    assertExists(parsed.threadId);
  });

  it("starts a detached run and returns accepted duplicate false", async () => {
    const sessionManager = new RunResumeSessionManager<{
      result: unknown;
      isError: boolean;
    }>();
    const originalStream = AgentRuntime.prototype.stream;
    let acceptedRunId: string | null = null;
    let finishedRunId: string | null = null;

    AgentRuntime.prototype.stream = async function (
      messages: Message[],
      context,
    ): Promise<ReadableStream<Uint8Array>> {
      assertEquals(messages[0]?.role, "user");
      assertEquals(context?.runId, "run_1");

      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encodeDataStreamEvent({ type: "message-start", messageId: "assistant-1" }),
          );
          controller.enqueue(encodeDataStreamEvent({ type: "text-start", id: "text-1" }));
          controller.enqueue(
            encodeDataStreamEvent({ type: "text-delta", id: "text-1", delta: "hello" }),
          );
          controller.enqueue(encodeDataStreamEvent({ type: "text-end", id: "text-1" }));
          controller.close();
        },
      });
    };

    try {
      const request = createDetachedRequest();
      const requestPayload = await request.clone().json() as { threadId: string };
      const handler = createAgUiDetachedStartHandler({
        agent: createTestAgent(),
        sessionManager,
        onAccepted: ({ runId }) => {
          acceptedRunId = runId;
        },
        onFinish: ({ runId }) => {
          finishedRunId = runId;
        },
      });

      const response = await handler(request);

      assertEquals(response.status, 202);
      assertEquals(await response.json(), {
        accepted: true,
        duplicate: false,
        runId: "run_1",
        threadId: requestPayload.threadId,
      });
    } finally {
      AgentRuntime.prototype.stream = originalStream;
    }

    assertEquals(acceptedRunId, "run_1");
    await flushAsyncWork();
    assertEquals(finishedRunId, "run_1");
    assertEquals(sessionManager.getRunStatus("run_1"), null);
  });

  it("returns accepted duplicate true for an already active run", async () => {
    const sessionManager = new RunResumeSessionManager<{
      result: unknown;
      isError: boolean;
    }>();
    const threadId = crypto.randomUUID();
    sessionManager.startRun({ runId: "run_1", threadId });
    let duplicateRunId: string | null = null;

    const handler = createAgUiDetachedStartHandler({
      agent: createTestAgent(),
      sessionManager,
      onDuplicate: ({ runId }) => {
        duplicateRunId = runId;
      },
    });

    const response = await handler(createDetachedRequest({ threadId }));

    assertEquals(response.status, 202);
    assertEquals(await response.json(), {
      accepted: true,
      duplicate: true,
      runId: "run_1",
      threadId,
    });
    assertEquals(duplicateRunId, "run_1");
    sessionManager.cancelRun("run_1");
  });

  it("returns 400 for malformed detached start payloads", async () => {
    const handler = createAgUiDetachedStartHandler({
      agent: createTestAgent(),
      sessionManager: new RunResumeSessionManager<{ result: unknown; isError: boolean }>(),
    });

    const response = await handler(
      new Request("http://localhost/api/ag-ui/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [],
        }),
      }),
    );

    assertEquals(response.status, 400);
    const payload = await response.json();
    assertExists(payload);
    assertEquals(payload.error, "Invalid AG-UI detached start request");
  });

  it("supports injected client tools in detached runs", async () => {
    const sessionManager = new RunResumeSessionManager<{
      result: unknown;
      isError: boolean;
    }>();
    const originalStream = AgentRuntime.prototype.stream;
    let finishedRunId: string | null = null;

    AgentRuntime.prototype.stream = async function (
      _messages,
      context,
    ): Promise<ReadableStream<Uint8Array>> {
      const runtimeConfig = this as unknown as {
        config: {
          tools?: Record<string, {
            execute: (
              input: Record<string, unknown>,
              context?: { toolCallId?: string },
            ) => Promise<unknown>;
          }>;
        };
      };

      const injectedTool = runtimeConfig.config.tools?.client_confirm;
      if (!injectedTool) {
        throw new Error("Expected injected tool to be merged into the runtime config");
      }

      assertEquals(context?.runId, "run_1");

      return new ReadableStream<Uint8Array>({
        start(controller) {
          void (async () => {
            controller.enqueue(
              encodeDataStreamEvent({
                type: "tool-input-start",
                toolCallId: "tool-call-1",
                toolName: "client_confirm",
              }),
            );
            controller.enqueue(
              encodeDataStreamEvent({
                type: "tool-input-delta",
                toolCallId: "tool-call-1",
                inputTextDelta: '{"approved":true}',
              }),
            );

            const result = await injectedTool.execute(
              { approved: true },
              { toolCallId: "tool-call-1" },
            );

            controller.enqueue(
              encodeDataStreamEvent({
                type: "tool-output-available",
                toolCallId: "tool-call-1",
                output: result,
              }),
            );
            controller.close();
          })();
        },
      });
    };

    try {
      const handler = createAgUiDetachedStartHandler({
        agent: createTestAgent(),
        sessionManager,
        onFinish: ({ runId }) => {
          finishedRunId = runId;
        },
      });

      const threadId = crypto.randomUUID();
      const response = await handler(createDetachedRequest({
        threadId,
        tools: [{ name: "client_confirm" }],
      }));

      assertEquals(response.status, 202);
      assertEquals(await response.json(), {
        accepted: true,
        duplicate: false,
        runId: "run_1",
        threadId,
      });

      const submitOutcome = sessionManager.submitSignal("run_1", {
        waitKey: "tool-call-1",
        value: { result: { approved: true }, isError: false },
      });
      assertEquals(submitOutcome, { accepted: true });
    } finally {
      AgentRuntime.prototype.stream = originalStream;
    }

    await flushAsyncWork();
    assertEquals(finishedRunId, "run_1");
  });

  it("preserves tool-* call variants during detached request normalization", async () => {
    const sessionManager = new RunResumeSessionManager<{
      result: unknown;
      isError: boolean;
    }>();
    const originalStream = AgentRuntime.prototype.stream;

    AgentRuntime.prototype.stream = async function (
      messages: Message[],
    ): Promise<ReadableStream<Uint8Array>> {
      assertEquals(messages[0]?.parts[0], {
        type: "tool-input-available",
        toolCallId: "tool-call-1",
        toolName: "client_confirm",
        args: { approved: true },
      });

      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      });
    };

    try {
      const handler = createAgUiDetachedStartHandler({
        agent: createTestAgent(),
        sessionManager,
      });

      const response = await handler(createDetachedRequest({
        messages: [{
          id: "assistant-1",
          role: "assistant",
          parts: [{
            type: "tool-input-available",
            toolCallId: "tool-call-1",
            toolName: "client_confirm",
            input: { approved: true },
          }],
        }],
      }));

      assertEquals(response.status, 202);
      const payload = await response.json();
      assertEquals(payload.accepted, true);
      assertEquals(payload.duplicate, false);
    } finally {
      AgentRuntime.prototype.stream = originalStream;
    }
  });

  it("drops oversize detached text parts the same way as the direct AG-UI handler", async () => {
    const sessionManager = new RunResumeSessionManager<{
      result: unknown;
      isError: boolean;
    }>();
    const originalStream = AgentRuntime.prototype.stream;

    AgentRuntime.prototype.stream = async function (
      messages: Message[],
    ): Promise<ReadableStream<Uint8Array>> {
      assertEquals(messages[0]?.parts.length, 0);

      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      });
    };

    try {
      const handler = createAgUiDetachedStartHandler({
        agent: createTestAgent(),
        sessionManager,
      });

      const response = await handler(createDetachedRequest({
        messages: [{
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "x".repeat(10_001) }],
        }],
      }));

      assertEquals(response.status, 202);
      const payload = await response.json();
      assertEquals(payload.accepted, true);
      assertEquals(payload.duplicate, false);
    } finally {
      AgentRuntime.prototype.stream = originalStream;
    }
  });

  it("calls onError when background execution fails after acceptance", async () => {
    const sessionManager = new RunResumeSessionManager<{
      result: unknown;
      isError: boolean;
    }>();
    const originalStream = AgentRuntime.prototype.stream;
    let acceptedRunId: string | null = null;
    let capturedError: string | null = null;

    AgentRuntime.prototype.stream = async function (): Promise<ReadableStream<Uint8Array>> {
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error("background boom"));
        },
      });
    };

    try {
      const handler = createAgUiDetachedStartHandler({
        agent: createTestAgent(),
        sessionManager,
        onAccepted: ({ runId }) => {
          acceptedRunId = runId;
        },
        onError: ({ error }) => {
          capturedError = error instanceof Error ? error.message : String(error);
        },
      });

      const response = await handler(createDetachedRequest());

      assertEquals(response.status, 202);
      const payload = await response.json();
      assertEquals(payload.accepted, true);
      assertEquals(payload.duplicate, false);
    } finally {
      AgentRuntime.prototype.stream = originalStream;
    }

    assertEquals(acceptedRunId, "run_1");
    await flushAsyncWork();
    assertStringIncludes(String(capturedError), "background boom");
    assertEquals(sessionManager.getRunStatus("run_1"), null);
  });
});
