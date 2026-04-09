import { assertEquals, assertMatch, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { AgUiRequestSchema, createAgUiHandler } from "./ag-ui-handler.ts";
import type { Agent, Message } from "./types.ts";

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
    assertStringIncludes(body, "event: TextMessageStart");
    assertStringIncludes(body, "event: TextMessageContent");
    assertStringIncludes(body, "event: TextMessageEnd");
    assertStringIncludes(body, "event: RunFinished");
    assertStringIncludes(body, '"provider":"anthropic"');
    assertStringIncludes(body, '"model":"anthropic/claude-sonnet-4-6"');
    assertStringIncludes(body, '"delta":"hello from runtime"');
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

  it("rejects injected client tools until wait/resume primitives exist", async () => {
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
    assertStringIncludes(await response.text(), "Injected AG-UI tools are not supported");
  });
});
