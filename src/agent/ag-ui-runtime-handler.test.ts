import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createAgUiRuntimeHandler } from "./ag-ui-runtime-handler.ts";
import type { Agent, Message } from "./types.ts";

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
