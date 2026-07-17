import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ChatUiMessageChunk } from "../../chat/types.ts";
import type { ToolExecutionDataEvent } from "../../tool/types.ts";
import { getActiveSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import {
  createHostedChatRuntimeAgentAdapter,
  type HostedChatRuntimeAgentAdapterInput,
} from "./chat-runtime-agent-adapter.ts";

const encoder = new TextEncoder();
const unrestrictedSourceIntegrationPolicy = {
  schemaVersion: 1,
  mode: "unrestricted",
} as const;

async function collectChunks(
  stream: AsyncIterable<ChatUiMessageChunk>,
): Promise<ChatUiMessageChunk[]> {
  const chunks: ChatUiMessageChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

function createSseResponse(events: Array<Record<string, unknown>>): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        controller.close();
      },
    }),
  );
}

function publishDataEventFrom(
  input: Parameters<HostedChatRuntimeAgentAdapterInput["runtimeAgent"]["stream"]>[0] | undefined,
  event: ToolExecutionDataEvent,
): void {
  const publishDataEvent = input?.context?.publishDataEvent;
  if (typeof publishDataEvent !== "function") {
    throw new Error("Runtime context did not receive a publishDataEvent callback");
  }

  publishDataEvent(event);
}

describe("createHostedChatRuntimeAgentAdapter", () => {
  it("keeps the source policy active through lazy stream construction and consumption", async () => {
    const observedPolicies: Array<ReturnType<typeof getActiveSourceIntegrationPolicy>> = [];
    const runtimeAgent: HostedChatRuntimeAgentAdapterInput["runtimeAgent"] = {
      stream() {
        observedPolicies.push(getActiveSourceIntegrationPolicy());
        return Promise.resolve({
          toDataStreamResponse: () => {
            observedPolicies.push(getActiveSourceIntegrationPolicy());
            return new Response(
              new ReadableStream<Uint8Array>({
                pull(controller) {
                  observedPolicies.push(getActiveSourceIntegrationPolicy());
                  controller.enqueue(encoder.encode('data: {"type":"message-finish"}\n\n'));
                  controller.close();
                },
              }),
            );
          },
        });
      },
    };
    const adapter = createHostedChatRuntimeAgentAdapter({
      runtimeAgent,
      sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
    });

    const result = await adapter.stream({
      messages: [],
      abortSignal: new AbortController().signal,
    });
    await collectChunks(
      result.toUIMessageStream({ generateMessageId: () => "assistant-message" }),
    );

    assertEquals(observedPolicies, [
      unrestrictedSourceIntegrationPolicy,
      unrestrictedSourceIntegrationPolicy,
      unrestrictedSourceIntegrationPolicy,
    ]);
  });

  it("runs a framework runtime agent under the host runner and maps its data stream", async () => {
    let capturedInput:
      | Parameters<HostedChatRuntimeAgentAdapterInput["runtimeAgent"]["stream"]>[0]
      | undefined;
    let runnerCalled = false;
    let observedSourcePolicy: ReturnType<typeof getActiveSourceIntegrationPolicy>;
    const abortController = new AbortController();
    const runtimeAgent: HostedChatRuntimeAgentAdapterInput["runtimeAgent"] = {
      stream(input) {
        observedSourcePolicy = getActiveSourceIntegrationPolicy();
        capturedInput = input;
        return Promise.resolve({
          toDataStreamResponse: () =>
            createSseResponse([
              { type: "message-start", messageId: "framework-message" },
              { type: "step-start" },
              { type: "text-start", id: "text-1" },
              { type: "text-delta", id: "text-1", delta: "Hello from adapter" },
              { type: "step-end" },
              { type: "text-end", id: "text-1" },
              { type: "message-finish" },
            ]),
        });
      },
    };
    const adapter = createHostedChatRuntimeAgentAdapter({
      runtimeAgent,
      sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
      agentId: "agent-1",
      runId: "run-1",
      authToken: "run-token-1",
      runStream: async (operation) => {
        runnerCalled = true;
        return await operation();
      },
    });

    const result = await adapter.stream({
      messages: [
        {
          id: "user-message",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
          timestamp: 1,
        },
      ],
      abortSignal: abortController.signal,
    });
    const chunks = await collectChunks(
      result.toUIMessageStream({ generateMessageId: () => "assistant-message" }),
    );

    assertEquals(runnerCalled, true);
    assertEquals(observedSourcePolicy, unrestrictedSourceIntegrationPolicy);
    assertEquals(capturedInput?.messages?.[0]?.id, "user-message");
    assertEquals(capturedInput?.context?.abortSignal, abortController.signal);
    assertEquals(capturedInput?.context?.agentId, "agent-1");
    assertEquals(capturedInput?.context?.runId, "run-1");
    assertEquals(capturedInput?.context?.authToken, "run-token-1");
    const expectedChunks = [
      { type: "start", messageId: "assistant-message" },
      { type: "start-step" },
      { type: "text-start", id: "assistant-message", contentId: "text-1" },
      {
        type: "text-delta",
        id: "assistant-message",
        contentId: "text-1",
        delta: "Hello from adapter",
      },
      { type: "finish-step" },
      { type: "text-end", id: "assistant-message", contentId: "text-1" },
      { type: "finish", finishReason: "stop" },
    ] as unknown as ChatUiMessageChunk[];
    assertEquals(chunks, expectedChunks);
  });

  it("bridges host-published tool data events into the UI message stream", async () => {
    let capturedInput:
      | Parameters<HostedChatRuntimeAgentAdapterInput["runtimeAgent"]["stream"]>[0]
      | undefined;
    let baseController: ReadableStreamDefaultController<Uint8Array> | null = null;
    let resolveBaseReadStarted = () => {};
    const baseReadStarted = new Promise<void>((resolve) => {
      resolveBaseReadStarted = resolve;
    });
    const runtimeAgent: HostedChatRuntimeAgentAdapterInput["runtimeAgent"] = {
      stream(input) {
        capturedInput = input;
        return Promise.resolve({
          toDataStreamResponse: () =>
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  baseController = controller;
                },
                pull() {
                  resolveBaseReadStarted();
                },
              }),
            ),
        });
      },
    };
    const adapter = createHostedChatRuntimeAgentAdapter({
      runtimeAgent,
      sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
    });

    const result = await adapter.stream({
      messages: [
        {
          id: "user-message",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
          timestamp: 1,
        },
      ],
      abortSignal: new AbortController().signal,
    });
    const chunksPromise = collectChunks(
      result.toUIMessageStream({ generateMessageId: () => "assistant-message" }),
    );
    await baseReadStarted;
    const controller = baseController as ReadableStreamDefaultController<Uint8Array> | null;
    if (controller === null) {
      throw new Error("Base response stream did not start");
    }

    publishDataEventFrom(capturedInput, {
      type: "tool-progress",
      data: { step: 1 },
      name: "tool-progress",
      value: { step: 1 },
    });
    controller.enqueue(encoder.encode('data: {"type":"message-finish"}\n\n'));
    controller.close();

    assertEquals(await chunksPromise, [
      { type: "start", messageId: "assistant-message" },
      { type: "data-tool-progress", data: { step: 1 } },
      { type: "finish", finishReason: "stop" },
    ]);
  });

  it("reports orphaned tool input warnings with a bounded preview", async () => {
    const warnings: Array<
      { message: string; metadata: { toolCallId: string; inputPreview: string } }
    > = [];
    const runtimeAgent: HostedChatRuntimeAgentAdapterInput["runtimeAgent"] = {
      stream() {
        return Promise.resolve({
          toDataStreamResponse: () =>
            createSseResponse([
              { type: "step-start" },
              {
                type: "tool-input-delta",
                toolCallId: "tool-orphan",
                inputTextDelta: "x".repeat(510),
              },
              { type: "message-finish" },
            ]),
        });
      },
    };
    const adapter = createHostedChatRuntimeAgentAdapter({
      runtimeAgent,
      sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
      warnOrphanedToolInput: (message, metadata) => warnings.push({ message, metadata }),
    });

    await collectChunks(
      (
        await adapter.stream({
          messages: [],
          abortSignal: new AbortController().signal,
        })
      ).toUIMessageStream({ generateMessageId: () => "assistant-message" }),
    );

    assertEquals(warnings, [
      {
        message:
          "Dropping orphan AG-UI runtime tool-input-delta stream without a matching lifecycle",
        metadata: {
          toolCallId: "tool-orphan",
          inputPreview: `${"x".repeat(500)}...`,
        },
      },
    ]);
  });
});
