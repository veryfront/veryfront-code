import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { RunResumeSessionManager } from "../index.ts";
import { createAgUiRuntimeHandler } from "./runtime-handler.ts";
import { AgentRuntime } from "../runtime/index.ts";
import type { Agent, Message } from "../types.ts";

const encoder = new TextEncoder();

function encodeDataStreamEvent(payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

function createTestAgent() {
  let clearMemoryCalls = 0;
  let capturedMessages: Message[] = [];
  let capturedContext: Record<string, unknown> | undefined;

  const agent: Agent = {
    id: "assistant-1",
    config: {
      id: "assistant-1",
      system: "You are helpful.",
      model: "anthropic/claude-sonnet-4-6",
    } as Agent["config"],
    generate: async () => {
      throw new Error("not used");
    },
    stream: async (input) => {
      capturedMessages = input.messages ?? [];
      capturedContext = input.context;

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encodeDataStreamEvent({ type: "message-start", messageId: "assistant-msg-1" }),
          );
          controller.enqueue(
            encodeDataStreamEvent({
              type: "data",
              data: {
                model: "anthropic/claude-sonnet-4-6",
                inferenceMode: "cloud",
              },
            }),
          );
          controller.enqueue(encodeDataStreamEvent({ type: "text-start", id: "text-1" }));
          controller.enqueue(
            encodeDataStreamEvent({
              type: "text-delta",
              id: "text-1",
              delta: "hello from runtime",
            }),
          );
          controller.enqueue(encodeDataStreamEvent({ type: "text-end", id: "text-1" }));
          controller.close();
        },
      });

      return {
        toDataStreamResponse: () =>
          new Response(stream, {
            headers: { "Content-Type": "text/event-stream" },
          }),
      };
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
    clearMemory: async () => {
      clearMemoryCalls += 1;
    },
  };

  return {
    agent,
    get clearMemoryCalls() {
      return clearMemoryCalls;
    },
    get capturedMessages() {
      return capturedMessages;
    },
    get capturedContext() {
      return capturedContext;
    },
  };
}

describe("agent/ag-ui-runtime-handler", () => {
  it("streams AG-UI events from the canonical runtime request contract", async () => {
    const testAgent = createTestAgent();
    const threadId = crypto.randomUUID();
    const handler = createAgUiRuntimeHandler({
      agent: testAgent.agent,
      context: { tenant: "acme" },
    });

    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          runId: "run_runtime_1",
          messages: [
            { id: "sys-1", role: "system", content: "Behave." },
            { id: "user-1", role: "user", content: "Hello" },
          ],
          context: [{ type: "text", text: "Current file: app.tsx" }],
          state: { step: "draft" },
          forwardedProps: { traceId: "trace-1" },
        }),
      }),
    );

    assertEquals(response.status, 200);
    assertEquals(response.headers.get("content-type"), "text/event-stream");
    assertEquals(testAgent.clearMemoryCalls, 1);
    assertEquals(testAgent.capturedMessages.length, 2);
    assertEquals(testAgent.capturedMessages[0]?.parts[0]?.type, "text");
    assertEquals(testAgent.capturedMessages[1]?.parts[0]?.type, "text");
    assertEquals(testAgent.capturedContext?.tenant, "acme");
    assertEquals(testAgent.capturedContext?.runId, "run_runtime_1");
    assertEquals(testAgent.capturedContext?.threadId, threadId);
    assertEquals(
      testAgent.capturedContext?.agUi,
      {
        context: [{ type: "text", text: "Current file: app.tsx" }],
        forwardedProps: { traceId: "trace-1" },
      },
    );

    const body = await response.text();
    assertStringIncludes(body, "event: RunStarted");
    assertStringIncludes(body, '"runId":"run_runtime_1"');
    assertStringIncludes(body, "event: StateSnapshot");
    assertStringIncludes(body, '"snapshot":{"step":"draft"}');
    assertStringIncludes(body, "event: MessagesSnapshot");
    assertStringIncludes(body, '"role":"user","parts":[{"type":"text","text":"Hello"}]');
    assertStringIncludes(body, "event: TextMessageContent");
  });

  it("hands parsed runtime requests to a custom execute hook", async () => {
    const threadId = crypto.randomUUID();
    const handler = createAgUiRuntimeHandler({
      execute: async ({ agUiInput, context, createDefaultResponse }) => {
        assertEquals(createDefaultResponse, undefined);
        assertEquals(context.hook, "present");
        return Response.json({
          threadId: agUiInput.threadId,
          runId: agUiInput.runId,
          messageCount: agUiInput.messages.length,
        });
      },
      context: { hook: "present" },
    });

    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          runId: "run_runtime_2",
          messages: [{ id: "user-1", role: "user", content: "Hello" }],
        }),
      }),
    );

    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      threadId,
      runId: "run_runtime_2",
      messageCount: 1,
    });
  });

  it("lets hosts short-circuit before parsing the runtime request body", async () => {
    let beforeParseCalls = 0;
    let executeCalls = 0;
    const handler = createAgUiRuntimeHandler({
      beforeParse: ({ request }) => {
        beforeParseCalls += 1;
        assertEquals(request.url, "http://localhost/api/ag-ui");
        return Response.json({ errorCode: "UNAUTHENTICATED" }, { status: 401 });
      },
      execute: () => {
        executeCalls += 1;
        return Response.json({ ok: true });
      },
    });

    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not-json",
      }),
    );

    assertEquals(response.status, 401);
    assertEquals(await response.json(), { errorCode: "UNAUTHENTICATED" });
    assertEquals(beforeParseCalls, 1);
    assertEquals(executeCalls, 0);
  });

  it("lets hosts preserve their validation-error response shape", async () => {
    let executeCalls = 0;
    const handler = createAgUiRuntimeHandler({
      validationErrorResponse: async ({ response }) => {
        const body = await response.json();
        return Response.json(
          {
            errorCode: "VALIDATION_ERROR",
            source: body,
          },
          { status: response.status },
        );
      },
      execute: () => {
        executeCalls += 1;
        return Response.json({ ok: true });
      },
    });

    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: crypto.randomUUID(),
          runId: "run_invalid_runtime_request",
          messages: "not-an-array",
        }),
      }),
    );

    assertEquals(response.status, 400);
    assertEquals(executeCalls, 0);
    const body = await response.json();
    assertEquals(body.errorCode, "VALIDATION_ERROR");
    assertEquals(body.source.error, "Invalid AG-UI runtime request");
  });

  it("calls runtime lifecycle hooks for direct hosted AG-UI streams", async () => {
    const testAgent = createTestAgent();
    const threadId = crypto.randomUUID();
    let finishedRunId: string | undefined;
    let seenToolCallId: string | undefined;

    testAgent.agent.stream = async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encodeDataStreamEvent({ type: "message-start", messageId: "assistant-msg-1" }),
          );
          controller.enqueue(
            encodeDataStreamEvent({
              type: "tool-input-start",
              toolCallId: "tool-call-42",
              toolName: "client_confirm",
            }),
          );
          controller.enqueue(
            encodeDataStreamEvent({
              type: "tool-input-delta",
              toolCallId: "tool-call-42",
              inputTextDelta: '{"approved":true}',
            }),
          );
          controller.enqueue(
            encodeDataStreamEvent({
              type: "tool-input-available",
              toolCallId: "tool-call-42",
            }),
          );
          controller.close();
        },
      });

      return {
        toDataStreamResponse: () =>
          new Response(stream, {
            headers: { "Content-Type": "text/event-stream" },
          }),
      };
    };

    const handler = createAgUiRuntimeHandler({
      agent: testAgent.agent,
      onToolCallSeen: ({ request, toolCallId }) => {
        finishedRunId = request.runId;
        seenToolCallId = toolCallId;
      },
      onFinish: ({ request }) => {
        finishedRunId = request.runId;
      },
    });

    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          runId: "run_runtime_hooks_1",
          messages: [{ id: "user-1", role: "user", content: "Hello" }],
        }),
      }),
    );

    assertEquals(response.status, 200);
    await response.text();
    assertEquals(finishedRunId, "run_runtime_hooks_1");
    assertEquals(seenToolCallId, "tool-call-42");
  });

  it("calls onError when the runtime AG-UI stream fails", async () => {
    const testAgent = createTestAgent();
    const threadId = crypto.randomUUID();
    let seenRunId: string | undefined;
    let seenError: string | undefined;

    testAgent.agent.stream = async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encodeDataStreamEvent({ type: "message-start", messageId: "assistant-msg-1" }),
          );
          controller.error(new Error("runtime stream exploded"));
        },
      });

      return {
        toDataStreamResponse: () =>
          new Response(stream, {
            headers: { "Content-Type": "text/event-stream" },
          }),
      };
    };

    const handler = createAgUiRuntimeHandler({
      agent: testAgent.agent,
      onError: ({ request, error }) => {
        seenRunId = request.runId;
        seenError = error instanceof Error ? error.message : String(error);
      },
    });

    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          runId: "run_runtime_hooks_2",
          messages: [{ id: "user-1", role: "user", content: "Hello" }],
        }),
      }),
    );

    assertEquals(response.status, 200);
    const body = await response.text();
    assertStringIncludes(body, "event: RunError");
    assertEquals(seenRunId, "run_runtime_hooks_2");
    assertEquals(seenError, "runtime stream exploded");
  });

  it("swallows rejected lifecycle callback promises during normal streaming", async () => {
    const testAgent = createTestAgent();
    const threadId = crypto.randomUUID();
    const handler = createAgUiRuntimeHandler({
      agent: testAgent.agent,
      onFinish: async () => {
        throw new Error("telemetry exploded");
      },
    });

    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          runId: "run_runtime_hooks_3",
          messages: [{ id: "user-1", role: "user", content: "Hello" }],
        }),
      }),
    );

    assertEquals(response.status, 200);
    const body = await response.text();
    assertStringIncludes(body, "event: RunFinished");
  });

  it("calls onError when direct hosted stream setup fails before a stream exists", async () => {
    const testAgent = createTestAgent();
    const threadId = crypto.randomUUID();
    let seenRunId: string | undefined;
    let seenError: string | undefined;

    testAgent.agent.clearMemory = async () => {
      throw new Error("clearMemory exploded");
    };

    const handler = createAgUiRuntimeHandler({
      agent: testAgent.agent,
      onError: ({ request, error }) => {
        seenRunId = request.runId;
        seenError = error instanceof Error ? error.message : String(error);
      },
    });

    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          runId: "run_runtime_hooks_4",
          messages: [{ id: "user-1", role: "user", content: "Hello" }],
        }),
      }),
    );

    assertEquals(response.status, 500);
    assertEquals(await response.json(), { error: "clearMemory exploded" });
    assertEquals(seenRunId, "run_runtime_hooks_4");
    assertEquals(seenError, "clearMemory exploded");
  });

  it("forwards lifecycle callbacks through the injected-tools runtime path", async () => {
    const sessionManager = new RunResumeSessionManager<{
      result: unknown;
      isError: boolean;
    }>();
    const originalStream = AgentRuntime.prototype.stream;
    let seenToolCallId: string | undefined;
    let finishedRunId: string | undefined;

    AgentRuntime.prototype.stream = async function (
      messages,
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

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          void (async () => {
            controller.enqueue(
              encodeDataStreamEvent({
                type: "message-start",
                messageId: "assistant-msg-1",
              }),
            );
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
            controller.enqueue(
              encodeDataStreamEvent({
                type: "tool-input-available",
                toolCallId: "tool-call-1",
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

      assertEquals(messages[0]?.role, "user");
      assertEquals(context?.runId, "run_runtime_4");
      return stream;
    };

    try {
      const handler = createAgUiRuntimeHandler({
        agent: createTestAgent().agent,
        sessionManager,
        onToolCallSeen: ({ toolCallId }) => {
          seenToolCallId = toolCallId;
        },
        onFinish: ({ request }) => {
          finishedRunId = request.runId;
        },
      });

      const response = await handler(
        new Request("http://localhost/api/ag-ui", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId: crypto.randomUUID(),
            runId: "run_runtime_4",
            messages: [{ id: "msg-1", role: "user", content: "hello" }],
            tools: [{ name: "client_confirm" }],
          }),
        }),
      );

      const bodyPromise = response.text();
      const submitOutcome = sessionManager.submitSignal("run_runtime_4", {
        waitKey: "tool-call-1",
        value: { result: { approved: true }, isError: false },
      });
      assertEquals(submitOutcome, { accepted: true });

      const body = await bodyPromise;
      assertStringIncludes(body, "event: ToolCallStart");
      assertEquals(seenToolCallId, "tool-call-1");
      assertEquals(finishedRunId, "run_runtime_4");
    } finally {
      AgentRuntime.prototype.stream = originalStream;
    }
  });

  it("does not prepare browser resume waits for source project tools", async () => {
    class TrackingSessionManager extends RunResumeSessionManager<{
      result: unknown;
      isError: boolean;
    }> {
      prepareCalls: Array<{ runId: string; waitKey: string }> = [];

      override prepareForSignal(runId: string, waitKey: string): void {
        this.prepareCalls.push({ runId, waitKey });
        super.prepareForSignal(runId, waitKey);
      }
    }

    const sessionManager = new TrackingSessionManager();
    const originalStream = AgentRuntime.prototype.stream;
    const agent = createTestAgent().agent;
    let sourceToolCalled = false;

    agent.config = {
      ...agent.config,
      tools: {
        "number-generator": {
          id: "number-generator",
          description: "Generate a number.",
          inputSchema: defineSchema((v) =>
            v.object({
              min: v.number(),
              max: v.number(),
            })
          )(),
          execute: () => {
            sourceToolCalled = true;
            return { randomNumber: 42 };
          },
        },
      },
    } as Agent["config"];

    AgentRuntime.prototype.stream = async function (): Promise<ReadableStream<Uint8Array>> {
      const runtimeConfig = this as unknown as {
        config: {
          tools?: Record<string, {
            execute: (
              input: Record<string, unknown>,
              context?: { toolCallId?: string },
            ) => Promise<unknown> | unknown;
          }>;
        };
      };

      const sourceTool = runtimeConfig.config.tools?.["number-generator"];
      if (!sourceTool) {
        throw new Error("Expected source project tool to be preserved in the runtime config");
      }

      return new ReadableStream<Uint8Array>({
        start(controller) {
          void (async () => {
            controller.enqueue(
              encodeDataStreamEvent({
                type: "message-start",
                messageId: "assistant-msg-1",
              }),
            );
            controller.enqueue(
              encodeDataStreamEvent({
                type: "tool-input-start",
                toolCallId: "tool-call-source-1",
                toolName: "number-generator",
              }),
            );
            controller.enqueue(
              encodeDataStreamEvent({
                type: "tool-input-delta",
                toolCallId: "tool-call-source-1",
                inputTextDelta: '{"min":1,"max":100}',
              }),
            );
            controller.enqueue(
              encodeDataStreamEvent({
                type: "tool-input-available",
                toolCallId: "tool-call-source-1",
              }),
            );

            const result = await sourceTool.execute(
              { min: 1, max: 100 },
              { toolCallId: "tool-call-source-1" },
            );

            controller.enqueue(
              encodeDataStreamEvent({
                type: "tool-output-available",
                toolCallId: "tool-call-source-1",
                output: result,
              }),
            );
            controller.close();
          })();
        },
      });
    };

    try {
      const handler = createAgUiRuntimeHandler({
        agent,
        sessionManager,
      });

      const response = await handler(
        new Request("http://localhost/api/ag-ui", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId: crypto.randomUUID(),
            runId: "run_runtime_source_tool_1",
            messages: [{ id: "msg-1", role: "user", content: "generate" }],
            tools: [{ name: "number-generator" }],
          }),
        }),
      );

      const body = await response.text();
      assertStringIncludes(body, "event: ToolCallResult");
      assertStringIncludes(body, '"randomNumber":42');
      assertEquals(sourceToolCalled, true);
      assertEquals(sessionManager.prepareCalls, []);
    } finally {
      AgentRuntime.prototype.stream = originalStream;
    }
  });

  it("requires a session manager when injected runtime tools are present and the default path is used", async () => {
    const testAgent = createTestAgent();
    const threadId = crypto.randomUUID();
    const handler = createAgUiRuntimeHandler({ agent: testAgent.agent });

    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          runId: "run_runtime_3",
          messages: [{ id: "user-1", role: "user", content: "Hello" }],
          tools: [{ name: "ui_search" }],
        }),
      }),
    );

    assertEquals(response.status, 501);
    assertEquals(await response.json(), {
      error:
        "Injected AG-UI tools require a public RunResumeSessionManager on createAgUiRuntimeHandler().",
    });
  });

  it("rejects invalid runtime request bodies", async () => {
    const testAgent = createTestAgent();
    const handler = createAgUiRuntimeHandler({ agent: testAgent.agent });

    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [] }),
      }),
    );

    assertEquals(response.status, 400);
    assertStringIncludes(await response.text(), "Invalid AG-UI runtime request");
  });
});
