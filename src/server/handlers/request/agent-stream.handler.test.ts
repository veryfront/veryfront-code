import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { AgentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DEFAULT_MAX_BODY_SIZE_BYTES } from "#veryfront/utils/constants/index.ts";
import { AgentStreamHandler } from "./agent-stream.handler.ts";
import {
  createAgent,
  createControlPlaneSignature,
  createCtx,
  encodeDataStreamEvent,
  readRemainingText,
  readUntil,
} from "./internal-agent-run.test-helpers.ts";

function createAgentStreamRequestBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    agentId: "assistant-1",
    threadId: "10000000-1000-4000-8000-100000000001",
    runId: "run_1",
    messages: [
      {
        id: "msg_1",
        role: "user",
        parts: [{ type: "text", text: "hello" }],
      },
    ],
    tools: [{ name: "studio_focus_component" }],
    context: [{ type: "text", text: "Current file: app.tsx" }],
    ...overrides,
  });
}

class TrackingSessionManager extends AgentRunSessionManager {
  readonly stats = {
    cancelCalls: 0,
    completeCalls: 0,
    failCalls: 0,
  };

  override cancelRun(runId: string): boolean {
    this.stats.cancelCalls += 1;
    return super.cancelRun(runId);
  }

  override completeRun(runId: string): void {
    this.stats.completeCalls += 1;
    super.completeRun(runId);
  }

  override failRun(runId: string): void {
    this.stats.failCalls += 1;
    super.failRun(runId);
  }
}

describe("server/handlers/request/agent-stream.handler", () => {
  it("streams AG-UI events for a valid signed request", async () => {
    let discoveryCalls = 0;
    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: async () => {
        discoveryCalls += 1;
      },
      getAgent: (id) => id === "assistant-1" ? createAgent("assistant-1") : undefined,
      getAllAgentIds: () => ["assistant-1"],
      sessionManager: new AgentRunSessionManager(),
      createRuntime: () => ({
        stream: async (_messages, _context, callbacks) => {
          callbacks?.onFinish?.({
            text: "hello from runtime",
            messages: [],
            toolCalls: [],
            status: "completed",
            usage: {
              promptTokens: 21,
              completionTokens: 13,
              totalTokens: 34,
            },
            metadata: {
              finishReason: "stop",
            },
          });

          return new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encodeDataStreamEvent({ type: "message-start", messageId: "assistant-msg-1" }),
              );
              controller.enqueue(encodeDataStreamEvent({ type: "step-start" }));
              controller.enqueue(encodeDataStreamEvent({ type: "text-start", id: "text-1" }));
              controller.enqueue(
                encodeDataStreamEvent({
                  type: "text-delta",
                  id: "text-1",
                  delta: "hello from runtime",
                }),
              );
              controller.enqueue(encodeDataStreamEvent({ type: "text-end", id: "text-1" }));
              controller.enqueue(encodeDataStreamEvent({ type: "step-end" }));
              controller.close();
            },
          });
        },
      }),
    });

    const body = createAgentStreamRequestBody();
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/internal/agents/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(discoveryCalls, 1);
    assertEquals(result.response.headers.get("content-type"), "text/event-stream");

    const text = await result.response.text();
    assertStringIncludes(text, "event: RunStarted");
    assertStringIncludes(text, "event: TextMessageContent");
    assertStringIncludes(text, "event: RunFinished");
    assertStringIncludes(text, '"inputTokens":21');
  });

  it("rejects oversized internal agent stream payloads before parsing", async () => {
    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: async () => {},
      getAgent: () => createAgent("assistant-1"),
      getAllAgentIds: () => ["assistant-1"],
      sessionManager: new AgentRunSessionManager(),
    });

    const body = createAgentStreamRequestBody({
      context: [{ type: "text", text: "x".repeat(DEFAULT_MAX_BODY_SIZE_BYTES + 1024) }],
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/internal/agents/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 413);
    assertEquals(await result.response.json(), { error: "Payload too large" });
  });

  it("emits a cancellation error instead of finishing after an abort during a pending read", async () => {
    const sessionManager = new TrackingSessionManager();
    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: async () => {},
      getAgent: (id) => id === "assistant-1" ? createAgent("assistant-1") : undefined,
      getAllAgentIds: () => ["assistant-1"],
      sessionManager,
      createRuntime: () => ({
        stream: async () =>
          new ReadableStream<Uint8Array>({
            cancel() {
              return Promise.resolve();
            },
          }),
      }),
    });

    const body = createAgentStreamRequestBody();
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/internal/agents/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertExists(result.response.body);

    const reader = result.response.body.getReader();
    let text = await readUntil(reader, (chunk) => chunk.includes("event: RunStarted"));

    assertEquals(sessionManager.cancelRun("run_1"), true);

    text += await readRemainingText(reader);

    assertStringIncludes(text, "event: RunError");
    assertStringIncludes(text, '"code":"CANCELLED"');
    assertEquals(text.includes("event: RunFinished"), false);
    assertEquals(sessionManager.stats.completeCalls, 0);
    assertEquals(sessionManager.stats.failCalls, 0);
  });
});
