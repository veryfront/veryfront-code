import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ProviderRequestError } from "veryfront/provider/shared";
import { MAX_OPENAI_STREAM_TOOL_CALLS, streamOpenAICompatibleParts } from "./openai-chat-stream.ts";
import {
  MAX_OPENAI_STREAM_TOOL_ARGUMENT_BYTES,
  MAX_OPENAI_STREAM_TOOL_ARGUMENT_FRAGMENTS,
} from "./openai-tool-input.ts";
import {
  MAX_OPENAI_STREAM_CONTENT_PARTS,
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

async function collectParts(stream: ReadableStream<Uint8Array>): Promise<unknown[]> {
  const parts: unknown[] = [];
  for await (const part of streamOpenAICompatibleParts(stream)) {
    parts.push(part);
  }
  return parts;
}

function data(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\r\n\r\n`;
}

describe("ext-llm-openai/openai-chat-stream", () => {
  it("preserves reasoning, text, tool-call assembly, usage, and finish events", async () => {
    const parts = await collectParts(streamFromText([
      data({
        choices: [{
          delta: { reasoning_content: "think" },
        }],
      }),
      data({
        choices: [{
          delta: { content: "done" },
        }],
      }),
      data({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: "call_1",
              function: { name: "lookup", arguments: '{"id":' },
            }],
          },
        }],
      }),
      data({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              function: { arguments: '"abc"}' },
            }],
          },
          finish_reason: "tool_calls",
        }],
        usage: {
          prompt_tokens: 3,
          completion_tokens: 4,
          total_tokens: 7,
          prompt_tokens_details: { cached_tokens: 2 },
          completion_tokens_details: { reasoning_tokens: 1 },
          veryfront: {
            billable_input_tokens: 3,
            billable_output_tokens: 4,
            provider_input_cost_usd: 0.0004,
            provider_output_cost_usd: 0.0006,
            provider_cost_usd: 0.001,
            veryfront_input_charge_usd: 0.001,
            veryfront_output_charge_usd: 0.0015,
            veryfront_charge_usd: 0.0025,
            cost_source: "gateway",
            billing_mode: "deferred",
            usage_capture_status: "complete",
          },
        },
      }),
      "data: [DONE]\r\n\r\n",
    ].join("")));

    assertEquals(parts, [
      { type: "reasoning-start", id: "reasoning-0" },
      { type: "reasoning-delta", id: "reasoning-0", delta: "think" },
      { type: "reasoning-end", id: "reasoning-0" },
      { type: "text-delta", delta: "done" },
      { type: "tool-input-start", id: "call_1", toolName: "lookup" },
      { type: "tool-input-delta", id: "call_1", delta: '{"id":' },
      { type: "tool-input-delta", id: "call_1", delta: '"abc"}' },
      {
        type: "tool-call",
        toolCallId: "call_1",
        toolName: "lookup",
        input: '{"id":"abc"}',
      },
      {
        type: "finish",
        finishReason: { unified: "tool-calls", raw: "tool_calls" },
        usage: {
          inputTokens: 3,
          outputTokens: 4,
          totalTokens: 7,
          cacheReadInputTokens: 2,
          cachedInputTokens: 2,
          reasoningTokens: 1,
          billableInputTokens: 3,
          billableOutputTokens: 4,
          providerInputCostUsd: 0.0004,
          providerOutputCostUsd: 0.0006,
          providerCostUsd: 0.001,
          veryfrontInputChargeUsd: 0.001,
          veryfrontOutputChargeUsd: 0.0015,
          veryfrontChargeUsd: 0.0025,
          costSource: "gateway",
          billingMode: "deferred",
          usageCaptureStatus: "complete",
        },
      },
    ]);
  });

  it("fully processes a trailing terminal record without a final delimiter", async () => {
    const parts = await collectParts(streamFromText(
      `data: ${
        JSON.stringify({
          choices: [{
            delta: { content: "tail" },
            finish_reason: "stop",
          }],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 2,
            total_tokens: 3,
          },
        })
      }`,
    ));

    assertEquals(parts, [
      { type: "text-delta", delta: "tail" },
      {
        type: "finish",
        finishReason: "stop",
        usage: {
          inputTokens: 1,
          outputTokens: 2,
          totalTokens: 3,
        },
      },
    ]);
  });

  it("accepts a nullable refusal delta", async () => {
    const parts = await collectParts(streamFromText(data({
      choices: [{
        delta: { refusal: null },
        finish_reason: "stop",
      }],
    })));

    assertEquals(parts, [{
      type: "finish",
      finishReason: "stop",
    }]);
  });

  it("rejects unsupported or excessive choice content parts", async () => {
    for (
      const [content, expected] of [
        [
          [{ type: "future_content", value: "not represented" }],
          "choice delta content part type was unsupported",
        ],
        [
          Array.from(
            { length: MAX_OPENAI_STREAM_CONTENT_PARTS + 1 },
            () => ({ type: "text", text: "" }),
          ),
          `choice delta content exceeded ${MAX_OPENAI_STREAM_CONTENT_PARTS} parts`,
        ],
      ] as const
    ) {
      await assertRejects(
        () =>
          collectParts(streamFromText(data({
            choices: [{ delta: { content }, finish_reason: "stop" }],
          }))),
        ProviderRequestError,
        expected,
      );
    }
  });

  it("bounds aggregate streamed tool argument bytes and fragment counts", async () => {
    const oversizedArguments = `{"value":"${
      "é".repeat(Math.floor(MAX_OPENAI_STREAM_TOOL_ARGUMENT_BYTES / 2))
    }"}`;
    await assertRejects(
      () =>
        collectParts(streamFromText(data({
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: "call_bytes",
                function: { name: "lookup", arguments: oversizedArguments },
              }],
            },
          }],
        }))),
      ProviderRequestError,
      `exceeded ${MAX_OPENAI_STREAM_TOOL_ARGUMENT_BYTES} UTF-8 bytes`,
    );

    const fragmentEvents = [
      data({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: "call_fragments",
              function: { name: "lookup" },
            }],
          },
        }],
      }),
      ...Array.from(
        { length: MAX_OPENAI_STREAM_TOOL_ARGUMENT_FRAGMENTS + 1 },
        () =>
          data({
            choices: [{
              delta: {
                tool_calls: [{
                  index: 0,
                  function: { arguments: "" },
                }],
              },
            }],
          }),
      ),
    ].join("");
    await assertRejects(
      () => collectParts(streamFromText(fragmentEvents)),
      ProviderRequestError,
      `exceeded ${MAX_OPENAI_STREAM_TOOL_ARGUMENT_FRAGMENTS} fragments`,
    );
  });

  it("enforces finish-reason and done-marker ordering", async () => {
    await assertRejects(
      () =>
        collectParts(streamFromText([
          data({ choices: [{ delta: { content: "partial" } }] }),
          "data: [DONE]\r\n\r\n",
        ].join(""))),
      ProviderRequestError,
      "done marker arrived before a finish reason",
    );

    await assertRejects(
      () =>
        collectParts(streamFromText([
          data({ choices: [{ delta: {}, finish_reason: "stop" }] }),
          data({ choices: [{ delta: { content: "late" } }] }),
        ].join(""))),
      ProviderRequestError,
      "choice data after its finish reason",
    );

    await assertRejects(
      () =>
        collectParts(streamFromText([
          data({ choices: [{ delta: {}, finish_reason: "stop" }] }),
          "data: [DONE]\r\n\r\n",
          data({ usage: { prompt_tokens: 1 } }),
        ].join(""))),
      ProviderRequestError,
      "data after its done marker",
    );
  });

  it("rejects ambiguous tool-call identities, types, and counts", async () => {
    await assertRejects(
      () =>
        collectParts(streamFromText(data({
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: "call_1",
                type: "not_function",
                function: { name: "lookup" },
              }],
            },
          }],
        }))),
      ProviderRequestError,
      "tool call type was not function",
    );

    await assertRejects(
      () =>
        collectParts(streamFromText(data({
          choices: [{
            delta: {
              tool_calls: [
                { index: 0, id: "call_dup", function: { name: "first" } },
                { index: 1, id: "call_dup", function: { name: "second" } },
              ],
            },
          }],
        }))),
      ProviderRequestError,
      "tool call id was reused at another index",
    );

    await assertRejects(
      () =>
        collectParts(streamFromText(data({
          choices: [{
            delta: {
              tool_calls: Array.from(
                { length: MAX_OPENAI_STREAM_TOOL_CALLS + 1 },
                (_, index) => ({
                  index,
                  id: `call_${index}`,
                  function: { name: "lookup" },
                }),
              ),
            },
          }],
        }))),
      ProviderRequestError,
      `stream exceeded ${MAX_OPENAI_STREAM_TOOL_CALLS} tool calls`,
    );
  });

  it("bounds retained tool identifiers and names by UTF-8 bytes", async () => {
    const exactId = "é".repeat(MAX_OPENAI_STREAM_IDENTIFIER_BYTES / 2);
    const exactName = "é".repeat(MAX_OPENAI_STREAM_TOOL_NAME_BYTES / 2);
    const exact = await collectParts(streamFromText(data({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: exactId,
            function: { name: exactName, arguments: "{}" },
          }],
        },
        finish_reason: "tool_calls",
      }],
    })));
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
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: `${exactId}é`,
                function: { name: "lookup" },
              }],
            },
          }],
        }))),
      ProviderRequestError,
      "tool call id was malformed",
    );
    await assertRejects(
      () =>
        collectParts(streamFromText(data({
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: "call_1",
                function: { name: `${exactName}é` },
              }],
            },
          }],
        }))),
      ProviderRequestError,
      "tool call function name was malformed",
    );
  });

  it("accepts repeated post-finish usage events without double counting", async () => {
    // OpenAI's include_usage chunk uses `choices: []`; aggregators add a bare
    // `{usage}`. Repeated cumulative totals must merge, not accumulate.
    const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 };
    const finish = data({ choices: [{ delta: {}, finish_reason: "stop" }] });
    const emptyChoices = data({ choices: [], usage });
    const bare = data({ usage });

    for (
      const tail of [[emptyChoices, emptyChoices], [emptyChoices, bare], [bare, bare]]
    ) {
      assertEquals(
        await collectParts(
          streamFromText([finish, ...tail, "data: [DONE]\r\n\r\n"].join("")),
        ),
        [{
          type: "finish",
          finishReason: "stop",
          usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        }],
      );
    }
  });

  it("treats null reasoning, role, and refusal deltas as absent", async () => {
    // Verbatim chunk shape from the Veryfront Cloud Moonshot gateway
    // (`kimi-k2.6`): optional delta fields are encoded as `null` rather than
    // being omitted, on both the opening chunk and the finish chunk.
    assertEquals(
      await collectParts(streamFromText([
        data({
          choices: [{
            index: 0,
            delta: { reasoning_content: null, role: "assistant", content: "" },
            logprobs: null,
            finish_reason: null,
            matched_stop: null,
          }],
        }),
        data({
          choices: [{
            index: 0,
            delta: { reasoning_content: "weighing it" },
            finish_reason: null,
          }],
        }),
        data({
          choices: [{
            index: 0,
            delta: { role: null, refusal: null, content: "hi there friend" },
            finish_reason: null,
          }],
        }),
        data({
          choices: [{
            index: 0,
            delta: { reasoning_content: null },
            logprobs: null,
            finish_reason: "stop",
            matched_stop: null,
          }],
        }),
        "data: [DONE]\r\n\r\n",
      ].join(""))),
      [
        { type: "reasoning-start", id: "reasoning-0" },
        { type: "reasoning-delta", id: "reasoning-0", delta: "weighing it" },
        { type: "reasoning-end", id: "reasoning-0" },
        { type: "text-delta", delta: "hi there friend" },
        { type: "finish", finishReason: "stop" },
      ],
    );
  });

  it("treats null tool-call id, type, name, and arguments as absent", async () => {
    // Verbatim tool-call chunk shape from the Veryfront Cloud Moonshot gateway
    // (`kimi-k2.6`): only the opening fragment carries `id` and `function.name`;
    // every continuation fragment repeats them as `null`.
    assertEquals(
      await collectParts(streamFromText([
        data({
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                id: "functions.list_events:0",
                index: 0,
                type: "function",
                function: { name: "list_events", arguments: '{"date":"' },
              }],
            },
            logprobs: null,
            finish_reason: null,
            matched_stop: null,
          }],
        }),
        data({
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                id: null,
                index: 0,
                type: "function",
                function: { name: null, arguments: "2026-08" },
              }],
            },
            finish_reason: null,
          }],
        }),
        data({
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                id: null,
                index: 0,
                type: null,
                function: { name: null, arguments: '-18"}' },
              }],
            },
            finish_reason: null,
          }],
        }),
        data({
          choices: [{
            index: 0,
            delta: { reasoning_content: null },
            logprobs: null,
            finish_reason: "tool_calls",
            matched_stop: 163586,
          }],
        }),
        "data: [DONE]\r\n\r\n",
      ].join(""))),
      [
        {
          type: "tool-input-start",
          id: "functions.list_events:0",
          toolName: "list_events",
        },
        { type: "tool-input-delta", id: "functions.list_events:0", delta: '{"date":"' },
        { type: "tool-input-delta", id: "functions.list_events:0", delta: "2026-08" },
        { type: "tool-input-delta", id: "functions.list_events:0", delta: '-18"}' },
        {
          type: "tool-call",
          toolCallId: "functions.list_events:0",
          toolName: "list_events",
          input: '{"date":"2026-08-18"}',
        },
        {
          type: "finish",
          finishReason: { unified: "tool-calls", raw: "tool_calls" },
        },
      ],
    );
  });

  it("still rejects tool-call fields of a genuinely wrong type", async () => {
    await assertRejects(
      () =>
        collectParts(streamFromText(data({
          choices: [{ delta: { tool_calls: [{ index: 0, id: 42 }] } }],
        }))),
      ProviderRequestError,
      "tool call id was malformed",
    );

    await assertRejects(
      () =>
        collectParts(streamFromText(data({
          choices: [{
            delta: {
              tool_calls: [{ index: 0, id: "call_1", function: { name: 7 } }],
            },
          }],
        }))),
      ProviderRequestError,
      "tool call function name was malformed",
    );

    await assertRejects(
      () =>
        collectParts(streamFromText(data({
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: "call_1",
                function: { name: "lookup", arguments: 5 },
              }],
            },
          }],
        }))),
      ProviderRequestError,
      "tool call arguments delta was malformed",
    );

    await assertRejects(
      () =>
        collectParts(streamFromText(data({
          choices: [{
            delta: { tool_calls: [{ index: 0, id: "call_1", type: "not_function" }] },
          }],
        }))),
      ProviderRequestError,
      "tool call type was not function",
    );
  });

  it("still rejects reasoning and role deltas of a genuinely wrong type", async () => {
    await assertRejects(
      () =>
        collectParts(streamFromText(data({
          choices: [{ delta: { reasoning_content: 42 } }],
        }))),
      ProviderRequestError,
      "reasoning delta was malformed",
    );

    await assertRejects(
      () =>
        collectParts(streamFromText(data({
          choices: [{ delta: { reasoning_content: { text: "think" } } }],
        }))),
      ProviderRequestError,
      "reasoning delta was malformed",
    );

    await assertRejects(
      () =>
        collectParts(streamFromText(data({
          choices: [{ delta: { role: "user", content: "hi" } }],
        }))),
      ProviderRequestError,
      "choice delta role was not assistant",
    );
  });

  it("rejects structurally empty and unterminated successful streams", async () => {
    await assertRejects(
      () => collectParts(streamFromText(data({}))),
      ProviderRequestError,
      "event had neither choices nor usage",
    );
    await assertRejects(
      () =>
        collectParts(streamFromText(data({
          choices: [{ delta: { content: "partial" } }],
        }))),
      ProviderRequestError,
      "stream ended before a finish reason",
    );
  });
});
