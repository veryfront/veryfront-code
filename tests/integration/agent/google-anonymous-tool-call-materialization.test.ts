import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type ChatUiMessageStreamFinish,
  createChatUiMessageStreamFromDataStream,
} from "#veryfront/agent/streaming/chat-ui-message-stream.ts";
// The extension's public entrypoint exports providers only; like the other
// executor/model integration tests, this reaches the stream adapter directly.
import { streamGoogleCompatibleParts } from "../../../extensions/ext-llm-google/src/google-stream.ts";

/**
 * Gemini 2.5 returns function calls without ids. Two agent steps that each
 * call one tool must still materialize as two tool cards: the hosted chat
 * stream keys tool parts by tool call id, so an id that repeats across steps
 * would merge the second call into the first card.
 *
 * Regression coverage for the fix in #4816
 * (fix(google): scope generated tool call IDs per response).
 */

const sseEncoder = new TextEncoder();

/** Veryfront data stream framing, as the hosted runtime emits it. */
function dataStream(events: unknown[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(sseEncoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });
}

/** Gemini `streamGenerateContent?alt=sse` framing. */
function sse(events: unknown[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(sseEncoder.encode(`data: ${JSON.stringify(event)}\r\n\r\n`));
      }
      controller.enqueue(sseEncoder.encode("data: [DONE]\r\n\r\n"));
      controller.close();
    },
  });
}

type AdapterToolCall = { toolCallId: string; toolName: string; input: string };

/** Runs one Gemini response through the adapter and returns its tool calls in order. */
async function geminiResponseToolCalls(toolNames: string[]): Promise<AdapterToolCall[]> {
  const calls: AdapterToolCall[] = [];
  for await (
    const part of streamGoogleCompatibleParts(sse([{
      candidates: [{
        content: {
          role: "model",
          parts: toolNames.map((name) => ({ functionCall: { name, args: {} } })),
        },
        finishReason: "STOP",
      }],
    }]))
  ) {
    const typed = part as { type?: string; toolCallId?: string; toolName?: string; input?: string };
    if (typed.type === "tool-call") {
      calls.push({ toolCallId: typed.toolCallId!, toolName: typed.toolName!, input: typed.input! });
    }
  }
  assertEquals(calls.map((call) => call.toolName), toolNames);
  return calls;
}

/** Runs one Gemini response through the adapter and returns its single tool call. */
async function geminiStepToolCall(toolName: string): Promise<AdapterToolCall> {
  const [call] = await geminiResponseToolCalls([toolName]);
  return call!;
}

describe("Google anonymous tool call materialization across agent steps", () => {
  it("materializes one tool card per step for id-less Gemini calls", async () => {
    const first = await geminiStepToolCall("tool_search");
    const second = await geminiStepToolCall("veryfront__list_files");
    assertNotEquals(first.toolCallId, second.toolCallId);

    const step = (call: typeof first, output: unknown) => [
      { type: "step-start" },
      { type: "tool-input-start", toolCallId: call.toolCallId, toolName: call.toolName },
      { type: "tool-input-delta", toolCallId: call.toolCallId, inputTextDelta: call.input },
      {
        type: "tool-input-available",
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: JSON.parse(call.input),
      },
      { type: "tool-output-available", toolCallId: call.toolCallId, output },
      { type: "step-end" },
    ];

    let finish: ChatUiMessageStreamFinish | undefined;
    const chunks: Array<{ type: string; toolCallId?: string; toolName?: string }> = [];
    for await (
      const chunk of createChatUiMessageStreamFromDataStream(
        {
          stream: dataStream([
            { type: "message-start", messageId: "framework-message" },
            ...step(first, { tools: ["veryfront__list_files"] }),
            ...step(second, { files: [] }),
            { type: "message-finish" },
          ]),
        },
        {
          generateMessageId: () => "assistant-message",
          onFinish: (value) => {
            finish = value;
          },
        },
      )
    ) {
      chunks.push(chunk as { type: string; toolCallId?: string; toolName?: string });
    }

    // Both tool-input-start events must be emitted with distinct ids.
    // Before #4816 the second anonymous call reused tool-0, so the encoder's
    // emittedToolInputStartIds set suppressed its start event.
    assertEquals(
      chunks
        .filter((chunk) => chunk.type === "tool-input-start")
        .map(({ toolCallId, toolName }) => ({ toolCallId, toolName })),
      [
        { toolCallId: first.toolCallId, toolName: "tool_search" },
        { toolCallId: second.toolCallId, toolName: "veryfront__list_files" },
      ],
    );

    // Both steps must produce a separate tool card in the final message.
    // Before #4816 the second card would overwrite the first because they
    // shared an id, leaving only one entry in the parts array.
    // Select tool parts by type, not by field presence, and require every one
    // to carry an id: a renamed part type must fail here, not filter to [].
    const toolCards = (finish?.responseMessage.parts ?? []).filter((part) =>
      part.type === "dynamic-tool" || part.type.startsWith("tool-")
    ) as Array<{ type: string; toolCallId?: string; toolName?: string; state?: string }>;
    assertEquals(toolCards.length, 2);
    for (const card of toolCards) assertEquals(typeof card.toolCallId, "string");
    assertEquals(
      toolCards.map(({ toolCallId, toolName, state }) => ({ toolCallId, toolName, state })),
      [
        { toolCallId: first.toolCallId, toolName: "tool_search", state: "output-available" },
        {
          toolCallId: second.toolCallId,
          toolName: "veryfront__list_files",
          state: "output-available",
        },
      ],
    );
  });

  it("gives two id-less calls in one Gemini response distinct ids", async () => {
    const calls = await geminiResponseToolCalls(["tool_search", "veryfront__list_files"]);
    assertNotEquals(calls[0]!.toolCallId, calls[1]!.toolCallId);

    // A later response must not reuse either id from the earlier one.
    const next = await geminiStepToolCall("tool_search");
    assertEquals(calls.some((call) => call.toolCallId === next.toolCallId), false);
  });
});
