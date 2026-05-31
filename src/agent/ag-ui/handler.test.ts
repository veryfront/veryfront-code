import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertMatch, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { AgUiRequestSchema, createAgUiHandler } from "./handler.ts";
import { AgentRuntime, RunResumeSessionManager } from "../index.ts";
import type { Agent, Message } from "../types.ts";

const encoder = new TextEncoder();

function encodeDataStreamEvent(payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

function createTestAgent() {
  let clearMemoryCalls = 0;
  let capturedMessages: Message[] = [];
  let capturedContext: Record<string, unknown> | undefined;
  let capturedModel: string | undefined;
  let capturedMaxOutputTokens: number | undefined;

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
      capturedModel = input.model;
      capturedMaxOutputTokens = input.maxOutputTokens;

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
    get capturedModel() {
      return capturedModel;
    },
    get capturedMaxOutputTokens() {
      return capturedMaxOutputTokens;
    },
  };
}

describe("agent/ag-ui-handler", () => {
  it("applies defaults for optional AG-UI fields", () => {
    const parsed = AgUiRequestSchema.parse({
      messages: [{
        id: "msg-1",
        role: "user",
        parts: [{ type: "text", text: "hello" }],
      }],
    });

    assertEquals(parsed.tools, []);
    assertEquals(parsed.context, []);
  });

  it("streams AG-UI events from a direct agent instance", async () => {
    const testAgent = createTestAgent();
    const handler = createAgUiHandler({
      agent: testAgent.agent,
      context: { tenant: "acme" },
    });

    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          }],
          context: [{ type: "text", text: "Current file: app.tsx" }],
          forwardedProps: { traceId: "trace-1" },
          model: "anthropic/claude-sonnet-4-6",
          maxOutputTokens: 512,
        }),
      }),
    );

    assertEquals(response.status, 200);
    assertEquals(response.headers.get("content-type"), "text/event-stream");
    assertEquals(testAgent.clearMemoryCalls, 1);
    assertEquals(testAgent.capturedMessages.length, 1);
    assertEquals(testAgent.capturedMessages[0]?.role, "user");
    assertEquals(testAgent.capturedModel, "anthropic/claude-sonnet-4-6");
    assertEquals(testAgent.capturedMaxOutputTokens, 512);
    assertEquals(testAgent.capturedContext?.tenant, "acme");
    assertEquals(testAgent.capturedContext?.threadId !== undefined, true);
    assertEquals(testAgent.capturedContext?.runId !== undefined, true);
    assertEquals(
      testAgent.capturedContext?.agUi,
      {
        context: [{ type: "text", text: "Current file: app.tsx" }],
        forwardedProps: { traceId: "trace-1" },
      },
    );

    const body = await response.text();
    assertStringIncludes(body, "event: RunStarted");
    assertStringIncludes(body, "event: StateSnapshot");
    assertStringIncludes(body, 'data: {"snapshot":{}');
    assertStringIncludes(body, "event: MessagesSnapshot");
    assertStringIncludes(body, '"messages":[{"id":"msg-1","role":"user"');
    assertStringIncludes(body, "event: TextMessageStart");
    assertStringIncludes(body, "event: TextMessageContent");
    assertStringIncludes(body, "event: TextMessageEnd");
    assertStringIncludes(body, "event: RunFinished");
    assertStringIncludes(body, '"provider":"anthropic"');
    assertStringIncludes(body, '"model":"anthropic/claude-sonnet-4-6"');
    assertStringIncludes(body, '"delta":"hello from runtime"');
  });

  it("bridges direct tool data events into the AG-UI stream", async () => {
    const testAgent = createTestAgent();
    testAgent.agent.stream = async (input) => {
      const publishDataEvent = input.context?.publishDataEvent;
      if (typeof publishDataEvent === "function") {
        await publishDataEvent({
          type: "test.report",
          name: "test.report",
          value: { status: "ready" },
        });
      }

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encodeDataStreamEvent({ type: "message-start", messageId: "assistant-msg-1" }),
          );
          controller.enqueue(encodeDataStreamEvent({ type: "text-start", id: "text-1" }));
          controller.enqueue(
            encodeDataStreamEvent({ type: "text-delta", id: "text-1", delta: "done" }),
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
    };

    const handler = createAgUiHandler({ agent: testAgent.agent });
    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          }],
        }),
      }),
    );

    const body = await response.text();
    assertStringIncludes(body, "event: Custom");
    assertStringIncludes(body, '"name":"test.report"');
    assertStringIncludes(body, '"status":"ready"');
  });

  it("runs beforeStream before direct AG-UI streaming", async () => {
    const testAgent = createTestAgent();
    const handler = createAgUiHandler({
      agent: testAgent.agent,
      context: { tenant: "acme" },
      beforeStream: ({ lastUserText, context }) => ({
        prepend: [{
          role: "user",
          parts: [{
            type: "text",
            text: `Retrieved context for: ${lastUserText}`,
          }],
        }],
        context: { ...context, retrieval: "complete" },
      }),
    });

    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "What changed?" }],
          }],
        }),
      }),
    );

    assertEquals(response.status, 200);
    assertEquals(testAgent.capturedMessages.length, 2);
    assertEquals(testAgent.capturedMessages[0]?.role, "user");
    assertEquals(
      testAgent.capturedMessages[0]?.parts[0],
      {
        type: "text",
        text: "Retrieved context for: What changed?",
      },
    );
    assertEquals(testAgent.capturedMessages[1]?.id, "msg-1");
    assertEquals(testAgent.capturedContext?.retrieval, "complete");
  });

  it("lets beforeStream short-circuit AG-UI requests", async () => {
    const testAgent = createTestAgent();
    const handler = createAgUiHandler({
      agent: testAgent.agent,
      beforeStream: () => Response.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "blocked" }],
          }],
        }),
      }),
    );

    assertEquals(response.status, 401);
    assertEquals(await response.json(), { error: "Unauthorized" });
    assertEquals(testAgent.capturedMessages.length, 0);
  });

  it("rejects oversized text parts before the agent runs", async () => {
    const testAgent = createTestAgent();
    const handler = createAgUiHandler({ agent: testAgent.agent });

    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "x".repeat(10_001) }],
          }],
        }),
      }),
    );

    assertEquals(response.status, 400);
    assertEquals(testAgent.clearMemoryCalls, 0);
    assertEquals(testAgent.capturedMessages.length, 0);
    const body = await response.json();
    assertEquals(body.error, "Invalid AG-UI request");
    assertStringIncludes(
      body.details[0]?.message ?? "",
      "Text message parts must include text less than 10000 characters",
    );
  });

  it("returns browser fallback metadata when no agent runtime is available", async () => {
    const testAgent = createTestAgent();
    const noAiAvailable = toError(createError({
      type: "no_ai_available",
      message: "Local AI unavailable",
    }));
    testAgent.agent.stream = async () => {
      throw noAiAvailable;
    };

    const handler = createAgUiHandler({ agent: testAgent.agent });

    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "fallback" }],
          }],
        }),
      }),
    );

    assertEquals(response.status, 503);
    assertEquals(await response.json(), {
      code: "NO_AI_AVAILABLE",
      fallback: "browser",
      model: "smollm2-135m",
    });
  });

  it("returns sanitized server errors when AG-UI agent streaming fails", async () => {
    const testAgent = createTestAgent();
    testAgent.agent.stream = async () => {
      throw new Error("provider secret detail");
    };

    const handler = createAgUiHandler({ agent: testAgent.agent });

    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          }],
        }),
      }),
    );

    assertEquals(response.status, 500);
    assertEquals(await response.json(), { error: "Internal server error" });
  });

  it("flushes the final runtime data event when the upstream stream ends without a trailing blank line", async () => {
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
      stream: async () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encodeDataStreamEvent({ type: "message-start", messageId: "assistant-msg-1" }),
            );
            controller.enqueue(
              encoder.encode('data: {"type":"text-delta","delta":"tail event survives"}'),
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
    const handler = createAgUiHandler({ agent });

    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          }],
        }),
      }),
    );

    const body = await response.text();
    assertStringIncludes(body, "event: TextMessageStart");
    assertStringIncludes(body, '"delta":"tail event survives"');
  });

  it("accepts a Pages Router style request wrapper and generates default ids", async () => {
    const testAgent = createTestAgent();
    const handler = createAgUiHandler({ agent: testAgent.agent });

    const request = new Request("http://localhost/api/ag-ui", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "hello" }],
        }],
      }),
    });

    const response = await handler({ request });

    assertEquals(response.status, 200);
    assertMatch(String(testAgent.capturedContext?.threadId), /^[0-9a-f-]{36}$/);
    assertMatch(String(testAgent.capturedContext?.runId), /^run_[a-z0-9]+$/);
  });

  it("supports injected client tools when a public session manager is provided", async () => {
    const sessionManager = new RunResumeSessionManager<{
      result: unknown;
      isError: boolean;
    }>();
    const originalStream = AgentRuntime.prototype.stream;

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
                type: "data",
                data: {
                  model: "anthropic/claude-sonnet-4-6",
                  inferenceMode: "cloud",
                },
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
      assertEquals(context?.runId, "run_1");
      return stream;
    };

    try {
      const handler = createAgUiHandler({
        agent: createTestAgent().agent,
        sessionManager,
      });

      const response = await handler(
        new Request("http://localhost/api/ag-ui", {
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
            tools: [{ name: "client_confirm" }],
          }),
        }),
      );

      assertEquals(response.status, 200);

      const bodyPromise = response.text();
      const submitOutcome = sessionManager.submitSignal("run_1", {
        waitKey: "tool-call-1",
        value: { result: { approved: true }, isError: false },
      });
      assertEquals(submitOutcome, { accepted: true });

      const body = await bodyPromise;
      assertStringIncludes(body, "event: ToolCallStart");
      assertStringIncludes(body, "event: ToolCallEnd");
      assertStringIncludes(body, "event: ToolCallResult");
      assertStringIncludes(body, '"toolCallId":"tool-call-1"');
      assertStringIncludes(body, '"approved":true');
      assertStringIncludes(body, "event: RunFinished");
    } finally {
      AgentRuntime.prototype.stream = originalStream;
    }
  });

  it("rejects injected client tools when no public session manager is provided", async () => {
    const testAgent = createTestAgent();
    const handler = createAgUiHandler({ agent: testAgent.agent });

    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          }],
          tools: [{ name: "client_confirm" }],
        }),
      }),
    );

    assertEquals(response.status, 501);
    assertEquals(testAgent.clearMemoryCalls, 0);
    assertStringIncludes(
      await response.text(),
      "Injected AG-UI tools require a public RunResumeSessionManager",
    );
  });
});
