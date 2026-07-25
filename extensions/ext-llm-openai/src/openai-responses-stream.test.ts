import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ProviderRequestError } from "veryfront/provider/shared";
import {
  MAX_OPENAI_RESPONSES_STREAM_CONTENT_PARTS,
  MAX_OPENAI_RESPONSES_STREAM_OUTPUT_ITEMS,
  MAX_OPENAI_STREAM_MESSAGE_SNAPSHOT_BYTES,
  streamOpenAIResponsesParts,
} from "./openai-responses-stream.ts";
import {
  MAX_OPENAI_STREAM_TOOL_ARGUMENT_BYTES,
  MAX_OPENAI_STREAM_TOOL_ARGUMENT_FRAGMENTS,
} from "./openai-tool-input.ts";
import {
  MAX_OPENAI_STREAM_IDENTIFIER_BYTES,
  MAX_OPENAI_STREAM_TOOL_NAME_BYTES,
} from "./openai-stream-metadata.ts";

function streamFromText(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function streamFromTexts(texts: Iterable<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = texts[Symbol.iterator]();
  return new ReadableStream({
    pull(controller) {
      const next = iterator.next();
      if (next.done) {
        controller.close();
      } else {
        controller.enqueue(encoder.encode(next.value));
      }
    },
  });
}

async function collectParts(
  stream: ReadableStream<Uint8Array>,
  context?: {
    providerKind?: "openai" | "mistral" | "moonshotai";
    providerLabel?: string;
    webSearchToolName?: string;
    preserveRawOutputItems?: boolean;
  },
): Promise<unknown[]> {
  const parts: unknown[] = [];
  for await (const part of streamOpenAIResponsesParts(stream, context)) {
    parts.push(part);
  }
  return parts;
}

function data(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\r\n\r\n`;
}

describe("ext-llm-openai/openai-responses-stream", () => {
  it("preserves reasoning, text, tool-call assembly, usage, and finish events", async () => {
    const parts = await collectParts(
      streamFromText([
        data({ type: "response.output_item.added", item: { id: "rs_1", type: "reasoning" } }),
        data({
          type: "response.reasoning_summary_text.delta",
          item_id: "rs_1",
          delta: "Thinking",
        }),
        data({
          type: "response.output_item.done",
          item: {
            id: "rs_1",
            type: "reasoning",
            summary: [{ type: "summary_text", text: "Thinking" }],
          },
        }),
        data({
          type: "response.output_item.added",
          item: { id: "fc_1", type: "function_call", call_id: "call_1", name: "lookup" },
        }),
        data({
          type: "response.function_call_arguments.delta",
          item_id: "fc_1",
          delta: '{"id":',
        }),
        data({
          type: "response.function_call_arguments.delta",
          item_id: "fc_1",
          delta: '"abc"}',
        }),
        data({
          type: "response.function_call_arguments.done",
          item_id: "fc_1",
          name: "lookup",
          arguments: '{"id":"abc"}',
        }),
        data({
          type: "response.output_item.done",
          item: {
            id: "fc_1",
            type: "function_call",
            call_id: "call_1",
            name: "lookup",
            arguments: '{"id":"abc"}',
          },
        }),
        data({
          type: "response.output_item.added",
          item: { id: "msg_1", type: "message", role: "assistant", content: [] },
        }),
        data({
          type: "response.output_text.delta",
          item_id: "msg_1",
          delta: "Done.",
        }),
        data({
          type: "response.output_item.done",
          item: {
            id: "msg_1",
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Done." }],
          },
        }),
        data({
          type: "response.completed",
          response: {
            status: "completed",
            usage: {
              input_tokens: 5,
              output_tokens: 7,
              total_tokens: 12,
              input_tokens_details: { cached_tokens: 3 },
              output_tokens_details: { reasoning_tokens: 2 },
            },
          },
        }),
        "data: [DONE]\r\n\r\n",
      ].join("")),
      { preserveRawOutputItems: true },
    );

    assertEquals(parts, [
      { type: "reasoning-start", id: "reasoning-0" },
      { type: "reasoning-delta", id: "reasoning-0", delta: "Thinking" },
      { type: "reasoning-end", id: "reasoning-0" },
      { type: "tool-input-start", id: "call_1", toolName: "lookup" },
      { type: "tool-input-delta", id: "call_1", delta: '{"id":' },
      { type: "tool-input-delta", id: "call_1", delta: '"abc"}' },
      {
        type: "tool-call",
        toolCallId: "call_1",
        toolName: "lookup",
        input: '{"id":"abc"}',
      },
      { type: "text-delta", delta: "Done." },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "completed" },
        usage: {
          inputTokens: 5,
          outputTokens: 7,
          totalTokens: 12,
          cacheReadInputTokens: 3,
          cachedInputTokens: 3,
          reasoningTokens: 2,
        },
        providerMetadata: {
          openai: {
            rawResponseOutputItems: [
              {
                id: "rs_1",
                type: "reasoning",
                summary: [{ type: "summary_text", text: "Thinking" }],
              },
              {
                id: "fc_1",
                type: "function_call",
                call_id: "call_1",
                name: "lookup",
                arguments: '{"id":"abc"}',
              },
              {
                id: "msg_1",
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: "Done." }],
              },
            ],
          },
        },
      },
    ]);
  });

  it("preserves hosted web-search lifecycle, citations, and replay metadata", async () => {
    const webSearchItem = {
      id: "ws_1",
      type: "web_search_call",
      status: "completed",
      action: {
        type: "search",
        queries: ["Veryfront production hardening"],
        sources: [{ type: "url", url: "https://example.test/source" }],
      },
    };
    const citation = {
      type: "url_citation",
      start_index: 0,
      end_index: 7,
      url: "https://example.test/source",
      title: "Source",
    };
    const messageItem = {
      id: "msg_1",
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{
        type: "output_text",
        text: "Sources",
        annotations: [citation],
      }],
    };
    const parts = await collectParts(
      streamFromText([
        data({
          type: "response.output_item.added",
          output_index: 0,
          item: {
            id: "ws_1",
            type: "web_search_call",
            status: "in_progress",
          },
        }),
        data({
          type: "response.web_search_call.in_progress",
          output_index: 0,
          item_id: "ws_1",
        }),
        data({
          type: "response.web_search_call.searching",
          output_index: 0,
          item_id: "ws_1",
        }),
        data({
          type: "response.web_search_call.completed",
          output_index: 0,
          item_id: "ws_1",
        }),
        data({
          type: "response.output_item.done",
          output_index: 0,
          item: webSearchItem,
        }),
        data({
          type: "response.output_item.added",
          output_index: 1,
          item: {
            id: "msg_1",
            type: "message",
            role: "assistant",
            status: "in_progress",
            content: [],
          },
        }),
        data({
          type: "response.content_part.added",
          item_id: "msg_1",
          output_index: 1,
          content_index: 0,
          part: { type: "output_text", text: "", annotations: [] },
        }),
        data({
          type: "response.output_text.delta",
          item_id: "msg_1",
          output_index: 1,
          content_index: 0,
          delta: "Sources",
        }),
        data({
          type: "response.output_text.annotation.added",
          item_id: "msg_1",
          output_index: 1,
          content_index: 0,
          annotation_index: 0,
          annotation: citation,
        }),
        data({
          type: "response.output_text.done",
          item_id: "msg_1",
          output_index: 1,
          content_index: 0,
          text: "Sources",
        }),
        data({
          type: "response.content_part.done",
          item_id: "msg_1",
          output_index: 1,
          content_index: 0,
          part: {
            type: "output_text",
            text: "Sources",
            annotations: [citation],
          },
        }),
        data({
          type: "response.output_item.done",
          output_index: 1,
          item: messageItem,
        }),
        data({
          type: "response.completed",
          response: { status: "completed" },
        }),
        "data: [DONE]\r\n\r\n",
      ].join("")),
      { webSearchToolName: "web" },
    );

    const input = '{"type":"search","queries":["Veryfront production hardening"]}';
    assertEquals(parts, [
      {
        type: "tool-input-start",
        id: "ws_1",
        toolName: "web",
        providerExecuted: true,
      },
      {
        type: "tool-input-delta",
        id: "ws_1",
        delta: input,
      },
      {
        type: "tool-call",
        toolCallId: "ws_1",
        toolName: "web",
        input,
        providerExecuted: true,
      },
      {
        type: "tool-result",
        toolCallId: "ws_1",
        toolName: "web",
        result: {
          status: "completed",
          sources: [{ type: "url", url: "https://example.test/source" }],
        },
        providerExecuted: true,
      },
      { type: "text-delta", delta: "Sources" },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "completed" },
        providerMetadata: {
          openai: {
            rawResponseOutputItems: [webSearchItem, messageItem],
          },
        },
      },
    ]);
  });

  it("retains every completed output item in exact order when web search is used", async () => {
    const reasoningItem = {
      id: "rs_before",
      type: "reasoning",
      status: "completed",
      summary: [],
    };
    const webSearchItem = {
      id: "ws_middle",
      type: "web_search_call",
      status: "completed",
      action: { type: "search", query: "Veryfront" },
    };
    const messageItem = {
      id: "msg_after",
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "Done", annotations: [] }],
    };
    const parts = await collectParts(
      streamFromText([
        data({
          type: "response.output_item.added",
          output_index: 1,
          item: {
            id: "ws_middle",
            type: "web_search_call",
            status: "in_progress",
          },
        }),
        data({
          type: "response.output_item.done",
          output_index: 1,
          item: webSearchItem,
        }),
        data({
          type: "response.output_item.added",
          output_index: 0,
          item: {
            id: "rs_before",
            type: "reasoning",
            status: "in_progress",
            summary: [],
          },
        }),
        data({
          type: "response.output_item.done",
          output_index: 0,
          item: reasoningItem,
        }),
        data({
          type: "response.output_item.added",
          output_index: 2,
          item: {
            id: "msg_after",
            type: "message",
            role: "assistant",
            status: "in_progress",
            content: [],
          },
        }),
        data({
          type: "response.output_item.done",
          output_index: 2,
          item: messageItem,
        }),
        data({
          type: "response.completed",
          response: { status: "completed" },
        }),
      ].join("")),
      { webSearchToolName: "web" },
    );

    assertEquals(parts.at(-1), {
      type: "finish",
      finishReason: { unified: "stop", raw: "completed" },
      providerMetadata: {
        openai: {
          rawResponseOutputItems: [
            reasoningItem,
            webSearchItem,
            messageItem,
          ],
        },
      },
    });
  });

  it("surfaces a failed hosted web-search item as an error result", async () => {
    const failedItem = {
      id: "ws_failed",
      type: "web_search_call",
      status: "failed",
      action: { type: "open_page", url: null },
    };
    const parts = await collectParts(
      streamFromText([
        data({
          type: "response.output_item.added",
          output_index: 0,
          item: {
            id: "ws_failed",
            type: "web_search_call",
            status: "in_progress",
          },
        }),
        data({
          type: "response.web_search_call.in_progress",
          output_index: 0,
          item_id: "ws_failed",
        }),
        data({
          type: "response.web_search_call.searching",
          output_index: 0,
          item_id: "ws_failed",
        }),
        data({
          type: "response.web_search_call.completed",
          output_index: 0,
          item_id: "ws_failed",
        }),
        data({
          type: "response.output_item.done",
          output_index: 0,
          item: failedItem,
        }),
        data({
          type: "response.completed",
          response: { status: "completed" },
        }),
      ].join("")),
      { webSearchToolName: "web" },
    );

    assertEquals(parts, [
      {
        type: "tool-input-start",
        id: "ws_failed",
        toolName: "web",
        providerExecuted: true,
      },
      {
        type: "tool-input-delta",
        id: "ws_failed",
        delta: '{"type":"open_page","url":null}',
      },
      {
        type: "tool-call",
        toolCallId: "ws_failed",
        toolName: "web",
        input: '{"type":"open_page","url":null}',
        providerExecuted: true,
      },
      {
        type: "tool-result",
        toolCallId: "ws_failed",
        toolName: "web",
        result: {
          status: "failed",
          action: { type: "open_page", url: null },
        },
        isError: true,
        providerExecuted: true,
      },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "completed" },
        providerMetadata: {
          openai: { rawResponseOutputItems: [failedItem] },
        },
      },
    ]);
  });

  it("rejects partially indexed or noncontiguous raw output order", async () => {
    const completed = data({
      type: "response.completed",
      response: { status: "completed" },
    });
    const messageEvents = (id: string, outputIndex?: number) => [
      data({
        type: "response.output_item.added",
        ...(outputIndex !== undefined ? { output_index: outputIndex } : {}),
        item: {
          id,
          type: "message",
          role: "assistant",
          status: "in_progress",
          content: [],
        },
      }),
      data({
        type: "response.output_item.done",
        ...(outputIndex !== undefined ? { output_index: outputIndex } : {}),
        item: {
          id,
          type: "message",
          role: "assistant",
          status: "completed",
          content: [],
        },
      }),
    ];

    await assertRejects(
      () =>
        collectParts(
          streamFromText([
            ...messageEvents("msg_unindexed"),
            ...messageEvents("msg_indexed", 1),
            completed,
          ].join("")),
          { preserveRawOutputItems: true },
        ),
      ProviderRequestError,
      "raw response output order was only partially indexed",
    );

    await assertRejects(
      () =>
        collectParts(
          streamFromText([
            ...messageEvents("msg_gap", 1),
            completed,
          ].join("")),
          { preserveRawOutputItems: true },
        ),
      ProviderRequestError,
      "raw response output indexes were not contiguous",
    );
  });

  it("rejects unconfigured, miscorrelated, or non-monotonic web-search lifecycle", async () => {
    await assertRejects(
      () =>
        collectParts(streamFromText(data({
          type: "response.output_item.added",
          output_index: 0,
          item: {
            id: "ws_unconfigured",
            type: "web_search_call",
            status: "in_progress",
          },
        }))),
      ProviderRequestError,
      "without a configured web-search tool",
    );

    await assertRejects(
      () =>
        collectParts(
          streamFromText([
            data({
              type: "response.output_item.added",
              output_index: 0,
              item: {
                id: "ws_repeat",
                type: "web_search_call",
                status: "in_progress",
              },
            }),
            data({
              type: "response.web_search_call.searching",
              output_index: 0,
              item_id: "ws_repeat",
            }),
            data({
              type: "response.web_search_call.in_progress",
              output_index: 0,
              item_id: "ws_repeat",
            }),
          ].join("")),
          { webSearchToolName: "web" },
        ),
      ProviderRequestError,
      "moved backward or repeated a phase",
    );

    await assertRejects(
      () =>
        collectParts(
          streamFromText([
            data({
              type: "response.output_item.added",
              output_index: 0,
              item: {
                id: "ws_index",
                type: "web_search_call",
                status: "in_progress",
              },
            }),
            data({
              type: "response.web_search_call.searching",
              output_index: 1,
              item_id: "ws_index",
            }),
          ].join("")),
          { webSearchToolName: "web" },
        ),
      ProviderRequestError,
      "output index changed",
    );
  });

  it("rejects citations that disagree with streamed annotations or exceed final text", async () => {
    const citation = {
      type: "url_citation",
      start_index: 0,
      end_index: 4,
      url: "https://example.test/source",
      title: "Source",
    };
    await assertRejects(
      () =>
        collectParts(streamFromText([
          data({
            type: "response.output_item.added",
            item: {
              id: "msg_annotation",
              type: "message",
              role: "assistant",
              content: [],
            },
          }),
          data({
            type: "response.output_text.annotation.added",
            item_id: "msg_annotation",
            content_index: 0,
            annotation_index: 0,
            annotation: citation,
          }),
          data({
            type: "response.output_item.done",
            item: {
              id: "msg_annotation",
              type: "message",
              role: "assistant",
              content: [{
                type: "output_text",
                text: "Done",
                annotations: [{
                  ...citation,
                  url: "https://example.test/changed",
                }],
              }],
            },
          }),
        ].join(""))),
      ProviderRequestError,
      "disagreed with streamed annotations",
    );

    await assertRejects(
      () =>
        collectParts(streamFromText([
          data({
            type: "response.output_item.added",
            item: {
              id: "msg_range",
              type: "message",
              role: "assistant",
              content: [],
            },
          }),
          data({
            type: "response.output_item.done",
            item: {
              id: "msg_range",
              type: "message",
              role: "assistant",
              content: [{
                type: "output_text",
                text: "Done",
                annotations: [{
                  ...citation,
                  end_index: 5,
                }],
              }],
            },
          }),
        ].join(""))),
      ProviderRequestError,
      "annotation range exceeded its text",
    );
  });

  it("normalizes incomplete and failed terminal events", async () => {
    const incomplete = await collectParts(streamFromText(data({
      type: "response.incomplete",
      response: {
        status: "incomplete",
        usage: { input_tokens: 2, output_tokens: 3 },
      },
    })));
    const failed = await collectParts(streamFromText(data({
      type: "response.failed",
      response: { status: "failed" },
    })));

    assertEquals(incomplete, [{
      type: "finish",
      finishReason: { unified: "length", raw: "incomplete" },
      usage: {
        inputTokens: 2,
        outputTokens: 3,
        totalTokens: 5,
      },
    }]);
    assertEquals(failed, [{
      type: "finish",
      finishReason: { unified: "error", raw: "failed" },
    }]);
  });

  it("fully processes a trailing terminal response without a final delimiter", async () => {
    const parts = await collectParts(streamFromText(
      `data: ${
        JSON.stringify({
          type: "response.completed",
          response: {
            status: "completed",
            usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
          },
        })
      }`,
    ));

    assertEquals(parts, [{
      type: "finish",
      finishReason: { unified: "stop", raw: "completed" },
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    }]);
  });

  it("preserves streamed refusal text", async () => {
    const parts = await collectParts(streamFromText([
      data({
        type: "response.output_item.added",
        item: { id: "msg_refusal", type: "message", role: "assistant", content: [] },
      }),
      data({
        type: "response.refusal.delta",
        item_id: "msg_refusal",
        delta: "I cannot help with that.",
      }),
      data({
        type: "response.output_item.done",
        item: {
          id: "msg_refusal",
          type: "message",
          role: "assistant",
          content: [{ type: "refusal", refusal: "I cannot help with that." }],
        },
      }),
      data({
        type: "response.completed",
        response: { status: "completed" },
      }),
    ].join("")));

    assertEquals(parts, [
      { type: "text-delta", delta: "I cannot help with that." },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "completed" },
      },
    ]);
  });

  it("accepts the complete Responses message content-part lifecycle", async () => {
    const parts = await collectParts(streamFromText([
      data({
        type: "response.output_item.added",
        item: { id: "msg_1", type: "message", role: "assistant", content: [] },
      }),
      data({
        type: "response.content_part.added",
        item_id: "msg_1",
        content_index: 0,
        part: { type: "output_text", text: "" },
      }),
      data({
        type: "response.output_text.delta",
        item_id: "msg_1",
        content_index: 0,
        delta: "Done.",
      }),
      data({
        type: "response.output_text.done",
        item_id: "msg_1",
        content_index: 0,
        text: "Done.",
      }),
      data({
        type: "response.content_part.done",
        item_id: "msg_1",
        content_index: 0,
        part: { type: "output_text", text: "Done." },
      }),
      data({
        type: "response.output_item.done",
        item: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Done." }],
        },
      }),
      data({
        type: "response.completed",
        response: { status: "completed" },
      }),
    ].join("")));

    assertEquals(parts, [
      { type: "text-delta", delta: "Done." },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "completed" },
      },
    ]);
  });

  it("preserves and reconciles the complete reasoning-summary lifecycle", async () => {
    const parts = await collectParts(streamFromText([
      data({
        type: "response.output_item.added",
        output_index: 0,
        item: {
          id: "rs_final",
          type: "reasoning",
          status: "in_progress",
          summary: [],
        },
      }),
      data({
        type: "response.reasoning_summary_part.added",
        item_id: "rs_final",
        output_index: 0,
        summary_index: 0,
        part: { type: "summary_text", text: "" },
      }),
      data({
        type: "response.reasoning_summary_text.done",
        item_id: "rs_final",
        output_index: 0,
        summary_index: 0,
        text: "Final summary",
      }),
      data({
        type: "response.reasoning_summary_part.done",
        item_id: "rs_final",
        output_index: 0,
        summary_index: 0,
        part: { type: "summary_text", text: "Final summary" },
      }),
      data({
        type: "response.output_item.done",
        output_index: 0,
        item: {
          id: "rs_final",
          type: "reasoning",
          status: "completed",
          summary: [{ type: "summary_text", text: "Final summary" }],
        },
      }),
      data({ type: "response.completed", response: { status: "completed" } }),
    ].join("")));

    assertEquals(parts, [
      { type: "reasoning-start", id: "reasoning-0" },
      { type: "reasoning-delta", id: "reasoning-0", delta: "Final summary" },
      { type: "reasoning-end", id: "reasoning-0" },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "completed" },
      },
    ]);
  });

  it("tracks message and future output-item lifecycles fail closed", async () => {
    await assertRejects(
      () =>
        collectParts(streamFromText(data({
          type: "response.output_text.delta",
          item_id: "unknown_message",
          delta: "partial",
        }))),
      ProviderRequestError,
      "referenced an unknown message item",
    );

    await assertRejects(
      () =>
        collectParts(streamFromText([
          data({
            type: "response.output_item.added",
            item: { id: "msg_1", type: "message", role: "assistant", content: [] },
          }),
          data({
            type: "response.output_text.delta",
            item_id: "msg_1",
            delta: "partial",
          }),
          data({
            type: "response.completed",
            response: { status: "completed" },
          }),
        ].join(""))),
      ProviderRequestError,
      "terminal response arrived with unfinished output items",
    );

    await assertRejects(
      () =>
        collectParts(streamFromText([
          data({
            type: "response.output_item.added",
            item: { id: "future_1", type: "future_output_item" },
          }),
          data({
            type: "response.completed",
            response: { status: "completed" },
          }),
        ].join(""))),
      ProviderRequestError,
      "terminal response arrived with unfinished output items",
    );

    await assertRejects(
      () =>
        collectParts(streamFromText([
          data({
            type: "response.output_item.added",
            item: { id: "future_1", type: "future_output_item" },
          }),
          data({
            type: "response.output_item.done",
            item: { id: "future_1", type: "future_output_item", status: "completed" },
          }),
        ].join(""))),
      ProviderRequestError,
      "completed output item type was unsupported",
    );
  });

  it("reconciles final message snapshots without loss or mutation", async () => {
    const finalOnly = await collectParts(streamFromText([
      data({
        type: "response.output_item.added",
        item: { id: "msg_final", type: "message", role: "assistant", content: [] },
      }),
      data({
        type: "response.output_item.done",
        item: {
          id: "msg_final",
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Only final." }],
        },
      }),
      data({ type: "response.completed", response: { status: "completed" } }),
    ].join("")));
    assertEquals(finalOnly, [
      { type: "text-delta", delta: "Only final." },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "completed" },
      },
    ]);

    await assertRejects(
      () =>
        collectParts(streamFromText([
          data({
            type: "response.output_item.added",
            item: { id: "msg_changed", type: "message", role: "assistant", content: [] },
          }),
          data({
            type: "response.output_text.delta",
            item_id: "msg_changed",
            delta: "partial",
          }),
          data({
            type: "response.output_item.done",
            item: {
              id: "msg_changed",
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "different" }],
            },
          }),
        ].join(""))),
      ProviderRequestError,
      "disagreed with streamed deltas",
    );
  });

  it("rejects truncated content parts and invalid terminal ordering", async () => {
    await assertRejects(
      () =>
        collectParts(streamFromText([
          data({
            type: "response.output_item.added",
            item: { id: "rs_open", type: "reasoning" },
          }),
          data({
            type: "response.content_part.added",
            item_id: "rs_open",
            content_index: 0,
            part: { type: "reasoning_text", text: "" },
          }),
          data({
            type: "response.output_item.done",
            item: {
              id: "rs_open",
              type: "reasoning",
              status: "completed",
              content: [{ type: "reasoning_text", text: "" }],
            },
          }),
        ].join(""))),
      ProviderRequestError,
      "completed reasoning had an unfinished content part",
    );

    await assertRejects(
      () =>
        collectParts(streamFromText([
          data({
            type: "response.output_item.added",
            item: { id: "msg_open", type: "message", role: "assistant", content: [] },
          }),
          data({
            type: "response.content_part.added",
            item_id: "msg_open",
            content_index: 0,
            part: { type: "output_text", text: "" },
          }),
          data({
            type: "response.output_text.delta",
            item_id: "msg_open",
            content_index: 0,
            delta: "partial",
          }),
          data({
            type: "response.output_item.done",
            item: {
              id: "msg_open",
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "partial" }],
            },
          }),
        ].join(""))),
      ProviderRequestError,
      "completed message had an unfinished content part",
    );

    await assertRejects(
      () =>
        collectParts(streamFromText([
          "data: [DONE]\r\n\r\n",
          data({ type: "response.completed", response: { status: "completed" } }),
        ].join(""))),
      ProviderRequestError,
      "done marker arrived before a terminal response event",
    );
  });

  it("rejects ambiguous function-call and output-index identities", async () => {
    await assertRejects(
      () =>
        collectParts(streamFromText([
          data({
            type: "response.output_item.added",
            item: {
              id: "fc_1",
              type: "function_call",
              call_id: "call_dup",
              name: "first",
            },
          }),
          data({
            type: "response.output_item.added",
            item: {
              id: "fc_2",
              type: "function_call",
              call_id: "call_dup",
              name: "second",
            },
          }),
        ].join(""))),
      ProviderRequestError,
      "function call id was reused",
    );

    await assertRejects(
      () =>
        collectParts(streamFromText([
          data({
            type: "response.output_item.added",
            item: { id: "msg_1", type: "message", role: "assistant", content: [] },
          }),
          data({
            type: "response.output_item.added",
            item: { id: "msg_2", type: "message", role: "assistant", content: [] },
          }),
          data({
            type: "response.output_text.delta",
            item_id: "msg_1",
            output_index: 0,
            delta: "one",
          }),
          data({
            type: "response.output_text.delta",
            item_id: "msg_2",
            output_index: 0,
            delta: "two",
          }),
        ].join(""))),
      ProviderRequestError,
      "output index was owned by another item",
    );

    await assertRejects(
      () =>
        collectParts(streamFromText([
          data({
            type: "response.output_item.added",
            item: {
              id: "fc_name",
              type: "function_call",
              call_id: "call_name",
              name: "lookup",
            },
          }),
          data({
            type: "response.function_call_arguments.done",
            item_id: "fc_name",
            name: "changed",
            arguments: "{}",
          }),
        ].join(""))),
      ProviderRequestError,
      "name changed or was missing",
    );
  });

  it("bounds retained message snapshots and lifecycle metadata", async () => {
    const delta = "x".repeat(8_192);
    const deltaCount = Math.floor(MAX_OPENAI_STREAM_MESSAGE_SNAPSHOT_BYTES / 8_192) + 1;
    await assertRejects(
      () =>
        collectParts(streamFromTexts([
          data({
            type: "response.output_item.added",
            item: { id: "msg_large", type: "message", role: "assistant", content: [] },
          }),
          ...Array.from(
            { length: deltaCount },
            () =>
              data({
                type: "response.output_text.delta",
                item_id: "msg_large",
                delta,
              }),
          ),
        ])),
      ProviderRequestError,
      `message snapshot exceeded ${MAX_OPENAI_STREAM_MESSAGE_SNAPSHOT_BYTES} UTF-8 bytes`,
    );

    const outputItemEvents = Array.from(
      { length: MAX_OPENAI_RESPONSES_STREAM_OUTPUT_ITEMS + 1 },
      (_, index) =>
        data({
          type: "response.output_item.added",
          item: { id: `rs_${index}`, type: "reasoning" },
        }),
    );
    await assertRejects(
      () => collectParts(streamFromTexts(outputItemEvents)),
      ProviderRequestError,
      `stream exceeded ${MAX_OPENAI_RESPONSES_STREAM_OUTPUT_ITEMS} output items`,
    );

    const contentPartEvents = [
      data({
        type: "response.output_item.added",
        item: { id: "msg_parts", type: "message", role: "assistant", content: [] },
      }),
      ...Array.from(
        { length: MAX_OPENAI_RESPONSES_STREAM_CONTENT_PARTS + 1 },
        (_, contentIndex) =>
          data({
            type: "response.output_text.delta",
            item_id: "msg_parts",
            content_index: contentIndex,
            delta: "x",
          }),
      ),
    ];
    await assertRejects(
      () => collectParts(streamFromTexts(contentPartEvents)),
      ProviderRequestError,
      `stream exceeded ${MAX_OPENAI_RESPONSES_STREAM_CONTENT_PARTS} content parts`,
    );
  });

  it("bounds retained Responses identifiers and names by UTF-8 bytes", async () => {
    const exactId = "é".repeat(MAX_OPENAI_STREAM_IDENTIFIER_BYTES / 2);
    const exactName = "é".repeat(MAX_OPENAI_STREAM_TOOL_NAME_BYTES / 2);
    const exact = await collectParts(streamFromText([
      data({
        type: "response.output_item.added",
        item: {
          id: exactId,
          type: "function_call",
          call_id: exactId,
          name: exactName,
        },
      }),
      data({
        type: "response.output_item.done",
        item: {
          id: exactId,
          type: "function_call",
          call_id: exactId,
          name: exactName,
          arguments: "{}",
        },
      }),
      data({ type: "response.completed", response: { status: "completed" } }),
    ].join("")));
    assertEquals(
      exact.find((part) => (part as { type?: string }).type === "tool-call"),
      {
        type: "tool-call",
        toolCallId: exactId,
        toolName: exactName,
        input: "{}",
      },
    );

    await assertRejects(
      () =>
        collectParts(streamFromText(data({
          type: "response.output_item.added",
          item: { id: `${exactId}é`, type: "reasoning" },
        }))),
      ProviderRequestError,
      "item type or id was missing",
    );
    await assertRejects(
      () =>
        collectParts(streamFromText(data({
          type: "response.output_item.added",
          item: {
            id: "fc_id",
            type: "function_call",
            call_id: `${exactId}é`,
            name: "lookup",
          },
        }))),
      ProviderRequestError,
      "function call id or name was missing",
    );
    await assertRejects(
      () =>
        collectParts(streamFromText(data({
          type: "response.output_item.added",
          item: {
            id: "fc_name",
            type: "function_call",
            call_id: "call_name",
            name: `${exactName}é`,
          },
        }))),
      ProviderRequestError,
      "function call id or name was missing",
    );
  });

  it("bounds aggregate streamed function argument bytes and fragment counts", async () => {
    const oversizedArguments = `{"value":"${
      "é".repeat(Math.floor(MAX_OPENAI_STREAM_TOOL_ARGUMENT_BYTES / 2))
    }"}`;
    await assertRejects(
      () =>
        collectParts(streamFromText([
          data({
            type: "response.output_item.added",
            item: {
              id: "fc_bytes",
              type: "function_call",
              call_id: "call_bytes",
              name: "lookup",
            },
          }),
          data({
            type: "response.function_call_arguments.delta",
            item_id: "fc_bytes",
            delta: oversizedArguments,
          }),
        ].join(""))),
      ProviderRequestError,
      `exceeded ${MAX_OPENAI_STREAM_TOOL_ARGUMENT_BYTES} UTF-8 bytes`,
    );

    const fragmentEvents = [
      data({
        type: "response.output_item.added",
        item: {
          id: "fc_fragments",
          type: "function_call",
          call_id: "call_fragments",
          name: "lookup",
        },
      }),
      ...Array.from(
        { length: MAX_OPENAI_STREAM_TOOL_ARGUMENT_FRAGMENTS + 1 },
        () =>
          data({
            type: "response.function_call_arguments.delta",
            item_id: "fc_fragments",
            delta: "",
          }),
      ),
    ].join("");
    await assertRejects(
      () => collectParts(streamFromText(fragmentEvents)),
      ProviderRequestError,
      `exceeded ${MAX_OPENAI_STREAM_TOOL_ARGUMENT_FRAGMENTS} fragments`,
    );
  });

  it("rejects structurally empty and unterminated successful streams", async () => {
    await assertRejects(
      () => collectParts(streamFromText(data({}))),
      ProviderRequestError,
      "event type was missing",
    );
    await assertRejects(
      () =>
        collectParts(streamFromText([
          data({
            type: "response.output_item.added",
            item: { id: "msg_1", type: "message", role: "assistant", content: [] },
          }),
          data({
            type: "response.output_text.delta",
            item_id: "msg_1",
            delta: "partial",
          }),
        ].join(""))),
      ProviderRequestError,
      "stream ended before a terminal response event",
    );
  });
});
