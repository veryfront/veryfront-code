import { assert, assertEquals, assertMatch, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { streamGoogleCompatibleParts } from "./google-stream.ts";
import { buildGoogleGenerateContentRequest } from "./google-request-builder.ts";

/**
 * Gemini 2.5 returns function calls without ids. Each model response is one
 * agent step, so a position-only fallback id (`tool-<partIndex>`) repeats in
 * every step and consumers keyed by tool call id merge or drop the later call.
 */

type StreamPart = {
  type?: string;
  id?: string;
  toolCallId?: string;
  toolName?: string;
  providerMetadata?: Record<string, unknown>;
};

function data(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\r\n\r\n`;
}

function streamFromText(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

/** Streams one model response (one agent step) with the given candidate parts. */
async function streamStep(parts: Record<string, unknown>[]): Promise<StreamPart[]> {
  const out: StreamPart[] = [];
  for await (
    const part of streamGoogleCompatibleParts(streamFromText([
      data({ candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }] }),
      "data: [DONE]\r\n\r\n",
    ].join("")))
  ) {
    out.push(part as StreamPart);
  }
  return out;
}

function toolInputStarts(parts: StreamPart[]): StreamPart[] {
  return parts.filter((part) => part.type === "tool-input-start");
}

function toolCallIds(parts: StreamPart[]): string[] {
  return parts
    .filter((part) => part.type === "tool-call")
    .map((part) => part.toolCallId as string);
}

function finishMetadata(parts: StreamPart[]): Record<string, unknown> | undefined {
  return parts.find((part) => part.type === "finish")?.providerMetadata;
}

function createWarningCollector() {
  const warnings: Array<{
    type: "unsupported-setting" | "other";
    setting?: string;
    details?: string;
    provider: string;
  }> = [];
  return {
    push(warning: (typeof warnings)[number]) {
      warnings.push(warning);
    },
    drain() {
      return warnings.slice();
    },
  };
}

const anonymousCall = (name: string, args: Record<string, unknown> = {}) => ({
  functionCall: { name, args },
});

describe("ext-llm-google/anonymous tool call ids", () => {
  it("gives id-less calls at the same position in two steps distinct ids", async () => {
    const step1 = await streamStep([anonymousCall("tool_search", { query: "list files" })]);
    const step2 = await streamStep([anonymousCall("veryfront__list_files")]);

    const [firstId] = toolCallIds(step1);
    const [secondId] = toolCallIds(step2);
    assertMatch(firstId!, /^tool-0-[0-9a-f]{16}$/);
    assertMatch(secondId!, /^tool-0-[0-9a-f]{16}$/);
    assertNotEquals(firstId, secondId);

    // Each step announces its own call, so a run-scoped start dedupe keyed by
    // id emits a TOOL_CALL_START for both.
    assertEquals(toolInputStarts(step1), [
      { type: "tool-input-start", id: firstId, toolName: "tool_search" },
    ]);
    assertEquals(toolInputStarts(step2), [
      { type: "tool-input-start", id: secondId, toolName: "veryfront__list_files" },
    ]);
  });

  it("keeps parallel id-less calls in one response distinct", async () => {
    const parts = await streamStep([anonymousCall("a"), anonymousCall("b")]);
    const ids = toolCallIds(parts);
    assertEquals(ids.length, 2);
    assertNotEquals(ids[0], ids[1]);
    assertEquals(ids.map((id) => id.split("-").slice(0, 2).join("-")), ["tool-0", "tool-1"]);
  });

  it("preserves a provider-supplied function call id and stores no nonce for it", async () => {
    const signedCall = {
      functionCall: { id: "call_provider_1", name: "lookup", args: { city: "Paris" } },
      thoughtSignature: "c2ln",
    };
    const parts = await streamStep([signedCall]);
    assertEquals(toolCallIds(parts), ["call_provider_1"]);
    assertEquals(finishMetadata(parts), { google: { rawAssistantParts: [signedCall] } });
  });

  it("round-trips signed id-less calls from two steps and pairs responses by order and name", async () => {
    // Gemini 2.5 Pro signs its function calls, so each step's raw parts are
    // replayed exactly and their ids are re-derived and validated.
    const step1Call = {
      ...anonymousCall("tool_search", { query: "files" }),
      thoughtSignature: "czE=",
    };
    const step2Call = { ...anonymousCall("veryfront__list_files"), thoughtSignature: "czI=" };
    const step1 = await streamStep([step1Call]);
    const step2 = await streamStep([step2Call]);
    const [firstId] = toolCallIds(step1);
    const [secondId] = toolCallIds(step2);
    assert(firstId && secondId);
    assertNotEquals(firstId, secondId);

    const request = buildGoogleGenerateContentRequest(
      "google",
      {
        prompt: [
          { role: "user", content: [{ type: "text", text: "count files" }] },
          {
            role: "assistant",
            content: [{
              type: "tool-call",
              toolCallId: firstId,
              toolName: "tool_search",
              input: { query: "files" },
            }],
            providerMetadata: finishMetadata(step1),
          },
          {
            role: "tool",
            content: [{
              type: "tool-result",
              toolCallId: firstId,
              toolName: "tool_search",
              output: { type: "json", value: { tools: ["veryfront__list_files"] } },
            }],
          },
          {
            role: "assistant",
            content: [{
              type: "tool-call",
              toolCallId: secondId,
              toolName: "veryfront__list_files",
              input: {},
            }],
            providerMetadata: finishMetadata(step2),
          },
          {
            role: "tool",
            content: [{
              type: "tool-result",
              toolCallId: secondId,
              toolName: "veryfront__list_files",
              output: { type: "json", value: { files: [] } },
            }],
          },
        ],
      } as Parameters<typeof buildGoogleGenerateContentRequest>[1],
      createWarningCollector(),
    );

    // The raw id-less calls go back unchanged, and each function response
    // follows its call in order with the matching name, which is how Gemini
    // 2.5 pairs them.
    const contents = request.contents as Array<{ role: string; parts: Record<string, unknown>[] }>;
    assertEquals(contents.map((content) => content.role), [
      "user",
      "model",
      "user",
      "model",
      "user",
    ]);
    assertEquals(contents[1]!.parts, [step1Call]);
    assertEquals(contents[3]!.parts, [step2Call]);
    assertEquals(
      [contents[2]!, contents[4]!].map((
        content,
      ) => (content.parts[0]!.functionResponse as { id: string; name: string })).map((
        { id, name },
      ) => ({ id, name })),
      [
        { id: firstId, name: "tool_search" },
        { id: secondId, name: "veryfront__list_files" },
      ],
    );
  });

  it("still replays a history persisted with legacy position-only ids", () => {
    const signedCall = { ...anonymousCall("lookup"), thoughtSignature: "c2ln" };
    const request = buildGoogleGenerateContentRequest(
      "google",
      {
        prompt: [{
          role: "assistant",
          content: [{ type: "tool-call", toolCallId: "tool-0", toolName: "lookup", input: {} }],
          providerMetadata: { google: { rawAssistantParts: [signedCall] } },
        }],
      } as Parameters<typeof buildGoogleGenerateContentRequest>[1],
      createWarningCollector(),
    );
    assertEquals(request.contents, [{ role: "model", parts: [signedCall] }]);
  });
});
