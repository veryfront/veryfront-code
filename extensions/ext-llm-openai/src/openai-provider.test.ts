import { assertEquals, assertRejects } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
// Error classes are shared plumbing — import from the shared barrel so this
// test stays decoupled from core's runtime-loader internals.
import {
  ProviderOverloadedError,
  ProviderQuotaError,
  ProviderRateLimitError,
  ProviderRequestError,
} from "veryfront/provider/shared";
import type { RuntimeAssistantContentPart } from "veryfront/provider/shared";
import {
  createOpenAIEmbeddingRuntime,
  createOpenAIModelRuntime,
  createOpenAIResponsesRuntime,
  OpenAIProvider,
} from "./openai-provider.ts";
import { MAX_OPENAI_STREAM_TOOL_CALLS } from "./openai-chat-stream.ts";
import {
  MAX_OPENAI_STREAM_IDENTIFIER_BYTES,
  MAX_OPENAI_STREAM_TOOL_NAME_BYTES,
} from "./openai-stream-metadata.ts";
import { MAX_OPENAI_STREAM_TOOL_ARGUMENT_BYTES } from "./openai-tool-input.ts";
import {
  MAX_OPENAI_RAW_RESPONSE_METADATA_BYTES,
  MAX_OPENAI_RAW_RESPONSE_OUTPUT_ITEMS,
} from "./openai-web-search.ts";

// ---------------------------------------------------------------------------
// Shared test helpers (inlined — no external fixture file needed)
// ---------------------------------------------------------------------------

async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}

async function waitWithin<T>(promise: Promise<T>, timeoutMs = 1_000): Promise<T> {
  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function readRequestBody(init: RequestInit | undefined): string | null {
  if (!init || !("body" in init) || typeof init.body !== "string") {
    return null;
  }
  return init.body;
}

function _readRequestHeader(init: RequestInit | undefined, name: string): string | null {
  if (!init || !("headers" in init)) {
    return null;
  }
  return new Headers(init.headers).get(name);
}

// ---------------------------------------------------------------------------
// OpenAI Chat Completions — core generate / stream / SSE
// ---------------------------------------------------------------------------

describe("openai-provider", () => {
  it("exposes canonical model providers independently of runtime display labels", () => {
    for (const createRuntime of [createOpenAIModelRuntime, createOpenAIResponsesRuntime]) {
      const runtime = createRuntime({
        apiKey: "test-openai-key",
        name: "prod-openai",
        providerName: " OpenAI ",
      }, "gpt-5.4-nano");

      assertEquals(runtime.provider, "prod-openai");
      assertEquals(runtime.modelProvider, "openai");
    }
  });

  it("creates an OpenAI-compatible language runtime without SDK helpers for generate", async () => {
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;

    const runtime = createOpenAIModelRuntime({
      apiKey: "test-openai-key",
      baseURL: "https://example.openai.test/v1",
      fetch: (input, init) => {
        requestedUrl = String(input);
        requestedInit = init;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: "",
                  tool_calls: [{
                    id: "call_weather",
                    type: "function",
                    function: {
                      name: "weather",
                      arguments: '{"city":"Tokyo"}',
                    },
                  }],
                },
              }],
              usage: {
                prompt_tokens: 8,
                completion_tokens: 2,
                total_tokens: 10,
                veryfront: {
                  billable_input_tokens: 8,
                  billable_output_tokens: 2,
                  provider_input_cost_usd: 0.0004,
                  provider_output_cost_usd: 0.0006,
                  provider_cost_usd: 0.001,
                  veryfront_input_charge_usd: 0.001,
                  veryfront_output_charge_usd: 0.0015,
                  veryfront_charge_usd: 0.0025,
                  veryfront_billed_usd: 0.1,
                  cost_credits: 1,
                  cost_source: "gateway",
                  usage_capture_status: "complete",
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      },
    }, "gpt-4o-mini");

    const result = await runtime.doGenerate({
      prompt: [{
        role: "user",
        content: [{ type: "text", text: "Check weather" }],
      }],
      tools: [{
        type: "function",
        name: "weather",
        description: "Get the weather",
        inputSchema: {
          type: "object",
          properties: {
            city: { type: "string" },
          },
          required: ["city"],
          additionalProperties: false,
        },
      }],
      toolChoice: "auto",
      maxOutputTokens: 50,
      temperature: 0.2,
      stopSequences: ["END"],
      headers: { "x-extra-header": "kept" },
    });

    assertEquals(requestedUrl, "https://example.openai.test/v1/chat/completions");
    assertEquals(requestedInit?.method, "POST");
    assertEquals(
      new Headers(requestedInit?.headers).get("authorization"),
      "Bearer test-openai-key",
    );
    assertEquals(new Headers(requestedInit?.headers).get("x-extra-header"), "kept");
    const requestBody = typeof requestedInit?.body === "string"
      ? JSON.parse(requestedInit.body)
      : undefined;
    assertEquals(
      requestBody,
      {
        model: "gpt-4o-mini",
        messages: [{
          role: "user",
          content: "Check weather",
        }],
        max_completion_tokens: 50,
        temperature: 0.2,
        stop: ["END"],
        tools: [{
          type: "function",
          function: {
            name: "weather",
            description: "Get the weather",
            parameters: {
              type: "object",
              properties: {
                city: { type: "string" },
              },
              required: ["city"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: "auto",
      },
    );
    assertEquals(result, {
      content: [{
        type: "tool-call",
        toolCallId: "call_weather",
        toolName: "weather",
        input: '{"city":"Tokyo"}',
      }],
      finishReason: { unified: "tool-calls", raw: "tool_calls" },
      usage: {
        inputTokens: 8,
        outputTokens: 2,
        totalTokens: 10,
        billableInputTokens: 8,
        billableOutputTokens: 2,
        providerInputCostUsd: 0.0004,
        providerOutputCostUsd: 0.0006,
        providerCostUsd: 0.001,
        veryfrontInputChargeUsd: 0.001,
        veryfrontOutputChargeUsd: 0.0015,
        veryfrontChargeUsd: 0.0025,
        veryfrontBilledUsd: 0.1,
        costCredits: 1,
        costSource: "gateway",
        usageCaptureStatus: "complete",
      },
    });
  });

  it("fails closed on an empty successful chat envelope without leaking its payload", async () => {
    const privatePayload = "<PRIVATE_PROVIDER_PAYLOAD>";
    const runtime = createOpenAIModelRuntime({
      apiKey: "k",
      baseURL: "https://example.mistral.test/v1",
      name: "mistral",
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ choices: [], diagnostic: privatePayload }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
    }, "mistral-large");

    const error = await assertRejects(
      async () =>
        await runtime.doGenerate({
          prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        }),
      ProviderRequestError,
      "invalid successful response",
    );

    assertEquals(error.provider, "mistral");
    assertEquals(error.status, 200);
    assertEquals(error.retryable, false);
    assertEquals(error.message.includes(privatePayload), false);
  });

  it("preserves valid refusal and content-filter responses with no ordinary text", async () => {
    const payloads = [
      {
        choices: [{
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: null,
            refusal: "I cannot help with that.",
          },
        }],
      },
      {
        choices: [{
          finish_reason: "content_filter",
          message: {
            role: "assistant",
            content: null,
            refusal: null,
          },
        }],
      },
    ];
    const runtime = createOpenAIModelRuntime({
      apiKey: "k",
      baseURL: "https://example.openai.test/v1",
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify(payloads.shift()),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
    }, "gpt-4o-mini");
    const prompt = [{ role: "user", content: [{ type: "text", text: "Hi" }] }] as const;

    const refusal = await runtime.doGenerate({ prompt });
    const filtered = await runtime.doGenerate({ prompt });

    assertEquals(refusal.content, [{ type: "text", text: "I cannot help with that." }]);
    assertEquals(refusal.finishReason, "stop");
    assertEquals(filtered.content, []);
    assertEquals(filtered.finishReason, {
      unified: "content-filter",
      raw: "content_filter",
    });
  });

  it("rejects unsupported Chat content parts instead of silently dropping them", async () => {
    const runtime = createOpenAIModelRuntime({
      apiKey: "k",
      baseURL: "https://example.openai.test/v1",
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: [{ type: "future_content", value: "not represented" }],
                },
              }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
    }, "gpt-4o-mini");

    await assertRejects(
      async () =>
        await runtime.doGenerate({
          prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        }),
      ProviderRequestError,
      "message content part type was unsupported",
    );
  });

  it("bounds direct Chat content and retained tool-call data", async () => {
    const prompt = [{ role: "user", content: [{ type: "text", text: "Hi" }] }] as const;
    const cases: Array<{ expected: string; choice: Record<string, unknown> }> = [
      {
        expected: `message content exceeded ${MAX_OPENAI_RAW_RESPONSE_OUTPUT_ITEMS} parts`,
        choice: {
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: Array.from(
              { length: MAX_OPENAI_RAW_RESPONSE_OUTPUT_ITEMS + 1 },
              () => ({ type: "text", text: "" }),
            ),
          },
        },
      },
      {
        expected: `message content exceeded ${MAX_OPENAI_RAW_RESPONSE_METADATA_BYTES} UTF-8 bytes`,
        choice: {
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: "x".repeat(MAX_OPENAI_RAW_RESPONSE_METADATA_BYTES + 1),
          },
        },
      },
      {
        expected: "message contained a malformed tool call",
        choice: {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "é".repeat(MAX_OPENAI_STREAM_IDENTIFIER_BYTES / 2 + 1),
              type: "function",
              function: { name: "lookup", arguments: "{}" },
            }],
          },
        },
      },
      {
        expected: "message contained a malformed tool call",
        choice: {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "call_large_name",
              type: "function",
              function: {
                name: "é".repeat(MAX_OPENAI_STREAM_TOOL_NAME_BYTES / 2 + 1),
                arguments: "{}",
              },
            }],
          },
        },
      },
      {
        expected:
          `message tool call arguments exceeded ${MAX_OPENAI_STREAM_TOOL_ARGUMENT_BYTES} UTF-8 bytes`,
        choice: {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "call_large_arguments",
              type: "function",
              function: {
                name: "lookup",
                arguments: JSON.stringify({
                  value: "x".repeat(MAX_OPENAI_STREAM_TOOL_ARGUMENT_BYTES),
                }),
              },
            }],
          },
        },
      },
      {
        expected: `message exceeded ${MAX_OPENAI_STREAM_TOOL_CALLS} tool calls`,
        choice: {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: Array.from(
              { length: MAX_OPENAI_STREAM_TOOL_CALLS + 1 },
              (_, index) => ({
                id: `call_${index}`,
                type: "function",
                function: { name: "lookup", arguments: "{}" },
              }),
            ),
          },
        },
      },
    ];

    for (const { expected, choice } of cases) {
      const runtime = createOpenAIModelRuntime({
        apiKey: "k",
        baseURL: "https://example.openai.test/v1",
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({ choices: [choice] }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
      }, "gpt-4o-mini");

      await assertRejects(
        async () => await runtime.doGenerate({ prompt }),
        ProviderRequestError,
        expected,
      );
    }
  });

  it("rejects non-object or malformed Chat function arguments", async () => {
    const prompt = [{ role: "user", content: [{ type: "text", text: "Hi" }] }] as const;
    for (const argumentsText of ["[]", "null", '{"city":']) {
      const runtime = createOpenAIModelRuntime({
        apiKey: "k",
        baseURL: "https://example.openai.test/v1",
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                choices: [{
                  finish_reason: "tool_calls",
                  message: {
                    role: "assistant",
                    content: null,
                    tool_calls: [{
                      id: "call_invalid",
                      type: "function",
                      function: { name: "weather", arguments: argumentsText },
                    }],
                  },
                }],
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
      }, "gpt-4o-mini");

      await assertRejects(
        async () => await runtime.doGenerate({ prompt }),
        ProviderRequestError,
        "arguments were not valid JSON object text",
      );
    }
  });

  it("rejects malformed, duplicate, or finish-inconsistent Chat tool calls", async () => {
    const cases: Array<{ expected: string; choice: Record<string, unknown> }> = [
      {
        expected: "message contained a malformed tool call",
        choice: {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "call_bad_type",
              type: "not_function",
              function: { name: "weather", arguments: "{}" },
            }],
          },
        },
      },
      {
        expected: "message contained duplicate tool call ids",
        choice: {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_dup",
                type: "function",
                function: { name: "first", arguments: "{}" },
              },
              {
                id: "call_dup",
                type: "function",
                function: { name: "second", arguments: "{}" },
              },
            ],
          },
        },
      },
      {
        expected: "choice finish reason and tool calls were inconsistent",
        choice: {
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "call_stop",
              type: "function",
              function: { name: "weather", arguments: "{}" },
            }],
          },
        },
      },
      {
        expected: "choice finish reason and tool calls were inconsistent",
        choice: {
          finish_reason: "tool_calls",
          message: { role: "assistant", content: null },
        },
      },
    ];
    const prompt = [{
      role: "user",
      content: [{ type: "text", text: "Hi" }],
    }] as const;

    for (const { expected, choice } of cases) {
      const runtime = createOpenAIModelRuntime({
        apiKey: "k",
        baseURL: "https://example.openai.test/v1",
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({ choices: [choice] }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
      }, "gpt-4o-mini");

      await assertRejects(
        async () => await runtime.doGenerate({ prompt }),
        ProviderRequestError,
        expected,
      );
    }
  });

  it("uses the configured OpenAI-compatible provider identity for HTTP errors", async () => {
    const cases = [
      { expected: "mistral" as const, config: { name: "mistral" } },
      {
        expected: "moonshotai" as const,
        config: { name: "custom-kimi", providerName: "moonshotai" },
      },
    ];

    for (const { expected, config } of cases) {
      const runtime = createOpenAIModelRuntime({
        apiKey: "k",
        baseURL: "https://compatible-provider.test/v1",
        ...config,
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({ error: { message: "<PRIVATE_PROVIDER_PAYLOAD>" } }),
              { status: 503, headers: { "content-type": "application/json" } },
            ),
          ),
      }, "compatible-model");

      const error = await assertRejects(
        async () =>
          await runtime.doGenerate({
            prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
          }),
        ProviderOverloadedError,
      );

      assertEquals(error.provider, expected);
      assertEquals(error.retryable, true);
      assertEquals(error.message.includes("<PRIVATE_PROVIDER_PAYLOAD>"), false);
    }
  });

  it("omits malformed chat usage counters", async () => {
    const runtime = createOpenAIModelRuntime({
      apiKey: "k",
      baseURL: "https://example.openai.test/v1",
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{
                finish_reason: "stop",
                message: { role: "assistant", content: "ok" },
              }],
              usage: {
                prompt_tokens: -1,
                completion_tokens: 1.5,
                total_tokens: -2,
                prompt_tokens_details: { cached_tokens: -1 },
                completion_tokens_details: { reasoning_tokens: 0.5 },
                veryfront: { provider_cost_usd: -1 },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
    }, "gpt-4o-mini");

    const result = await runtime.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
    });

    assertEquals(result.usage, undefined);
  });

  it("sends image URL user parts as OpenAI Chat Completions image_url content", async () => {
    let requestedInit: RequestInit | undefined;

    const runtime = createOpenAIModelRuntime({
      apiKey: "test-openai-key",
      baseURL: "https://example.openai.test/v1",
      fetch: (_input, init) => {
        requestedInit = init;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{
                finish_reason: "stop",
                message: { role: "assistant", content: "web app screenshot" },
              }],
              usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      },
    }, "gpt-4o-mini");

    await runtime.doGenerate({
      prompt: [{
        role: "user",
        content: [
          { type: "text", text: "What is this?" },
          {
            type: "image",
            mediaType: "image/jpeg",
            url: "https://signed.example.com/web-app-screenshot.jpg",
          },
        ],
      }],
    });

    const requestBody = JSON.parse(readRequestBody(requestedInit) ?? "{}");
    assertEquals(requestBody.messages[0].content, [
      { type: "text", text: "What is this?" },
      {
        type: "image_url",
        image_url: { url: "https://signed.example.com/web-app-screenshot.jpg" },
      },
    ]);
  });

  it("creates an OpenAI-compatible language runtime without SDK helpers for stream", async () => {
    const encoder = new TextEncoder();
    const runtime = createOpenAIModelRuntime({
      apiKey: "test-openai-key",
      baseURL: "https://example.openai.test/v1",
      fetch: () =>
        Promise.resolve(
          new Response(
            ReadableStream.from([
              encoder.encode(
                'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_weather","function":{"name":"weather","arguments":"{\\"city\\":\\""}}]}}]}\n\n',
              ),
              encoder.encode(
                'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"Tokyo\\"}"}}]}}]}\n\n',
              ),
              encoder.encode(
                'data: {"choices":[{"finish_reason":"tool_calls"}]}\n\n',
              ),
              encoder.encode(
                'data: {"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":2,"total_tokens":10}}\n\n',
              ),
              encoder.encode("data: [DONE]\n\n"),
            ]),
            {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            },
          ),
        ),
    }, "gpt-4o-mini");

    const result = await runtime.doStream({
      prompt: [{
        role: "user",
        content: [{ type: "text", text: "Check weather" }],
      }],
      tools: [{
        type: "function",
        name: "weather",
        inputSchema: {
          type: "object",
          properties: {
            city: { type: "string" },
          },
        },
      }],
    });

    const parts = await collectAsync(result.stream);
    assertEquals(parts, [
      {
        type: "tool-input-start",
        id: "call_weather",
        toolName: "weather",
      },
      {
        type: "tool-input-delta",
        id: "call_weather",
        delta: '{"city":"',
      },
      {
        type: "tool-input-delta",
        id: "call_weather",
        delta: 'Tokyo"}',
      },
      {
        type: "tool-call",
        toolCallId: "call_weather",
        toolName: "weather",
        input: '{"city":"Tokyo"}',
      },
      {
        type: "finish",
        finishReason: { unified: "tool-calls", raw: "tool_calls" },
        usage: {
          inputTokens: 8,
          outputTokens: 2,
          totalTokens: 10,
        },
      },
    ]);
  });

  it("aborts and cancels pending upstream pulls when Chat or Responses consumers stop", async () => {
    const encoder = new TextEncoder();
    const cases = [
      {
        name: "chat",
        createRuntime: (fetch: typeof globalThis.fetch) =>
          createOpenAIModelRuntime({
            apiKey: "k",
            baseURL: "https://example.openai.test/v1",
            fetch,
          }, "gpt-4o-mini"),
        initialEvents: 'data: {"choices":[{"delta":{"content":"first chat part"}}]}\n\n',
        expectedDelta: "first chat part",
      },
      {
        name: "responses",
        createRuntime: (fetch: typeof globalThis.fetch) =>
          createOpenAIResponsesRuntime({
            apiKey: "k",
            baseURL: "https://example.openai.test/v1",
            fetch,
          }, "gpt-5.4-nano"),
        initialEvents: [
          'data: {"type":"response.output_item.added","item":{"id":"msg_1","type":"message","role":"assistant","content":[]}}\n\n',
          'data: {"type":"response.output_text.delta","item_id":"msg_1","delta":"first responses part"}\n\n',
        ].join(""),
        expectedDelta: "first responses part",
      },
    ];

    for (const testCase of cases) {
      let requestSignal: AbortSignal | null | undefined;
      let upstreamCancelReason: unknown;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(testCase.initialEvents));
        },
        cancel(reason) {
          upstreamCancelReason = reason;
        },
      });
      const runtime = testCase.createRuntime((_input, init) => {
        requestSignal = init && "signal" in init && init.signal instanceof AbortSignal
          ? init.signal
          : undefined;
        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );
      });

      const result = await runtime.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      });
      const reader = result.stream.getReader();
      assertEquals(await waitWithin(reader.read()), {
        done: false,
        value: { type: "text-delta", delta: testCase.expectedDelta },
      });
      const pendingRead = reader.read();
      const cancelReason = `consumer stopped ${testCase.name}`;

      await waitWithin(reader.cancel(cancelReason));

      assertEquals(requestSignal?.aborted, true);
      assertEquals(upstreamCancelReason, cancelReason);
      assertEquals((await waitWithin(pendingRead)).done, true);
    }
  });

  it("routes direct OpenAI reasoning models with custom labels through Responses", async () => {
    const encoder = new TextEncoder();
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;
    const provider = new OpenAIProvider();
    const runtime = provider.createModel("gpt-5.4-nano", {
      credential: "test-openai-key",
      baseURL: "https://example.openai.test/v1",
      name: "prod-openai",
      fetch: (input, init) => {
        requestedUrl = String(input);
        requestedInit = init;
        return Promise.resolve(
          new Response(
            ReadableStream.from([
              encoder.encode(
                'data: {"type":"response.output_item.added","item":{"id":"rs_1","type":"reasoning"}}\n\n',
              ),
              encoder.encode(
                'data: {"type":"response.reasoning_summary_text.delta","item_id":"rs_1","delta":"Thinking."}\n\n',
              ),
              encoder.encode(
                'data: {"type":"response.output_item.done","item":{"id":"rs_1","type":"reasoning","summary":[{"type":"summary_text","text":"Thinking."}]}}\n\n',
              ),
              encoder.encode(
                'data: {"type":"response.output_item.added","item":{"id":"msg_1","type":"message"}}\n\n',
              ),
              encoder.encode(
                'data: {"type":"response.output_text.delta","item_id":"msg_1","delta":"Done."}\n\n',
              ),
              encoder.encode(
                'data: {"type":"response.output_item.done","item":{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"output_text","text":"Done."}]}}\n\n',
              ),
              encoder.encode(
                'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":2,"output_tokens":3,"output_tokens_details":{"reasoning_tokens":2},"total_tokens":5}}}\n\n',
              ),
              encoder.encode("data: [DONE]\n\n"),
            ]),
            { status: 200, headers: { "content-type": "text/event-stream" } },
          ),
        );
      },
    });

    const result = await runtime.doStream({
      prompt: [{
        role: "user",
        content: [{ type: "text", text: "Solve a logic check." }],
      }],
    });

    const requestBody = JSON.parse(readRequestBody(requestedInit) ?? "{}");
    const parts = await collectAsync(result.stream);

    assertEquals(runtime.provider, "prod-openai");
    assertEquals(requestedUrl, "https://example.openai.test/v1/responses");
    assertEquals(requestBody.reasoning, { effort: "medium" });
    assertEquals(parts.map((part) => (part as { type: string }).type), [
      "reasoning-start",
      "reasoning-delta",
      "reasoning-end",
      "text-delta",
      "finish",
    ]);
  });

  it("routes non-reasoning models through Responses only when OpenAI hosted search is requested", async () => {
    const requestedUrls: string[] = [];
    const requestedBodies: Array<Record<string, unknown>> = [];
    const provider = new OpenAIProvider();
    const runtime = provider.createModel("gpt-4.1", {
      credential: "test-openai-key",
      baseURL: "https://example.openai.test/v1",
      fetch: (input, init) => {
        const url = String(input);
        requestedUrls.push(url);
        requestedBodies.push(
          JSON.parse(readRequestBody(init) ?? "{}") as Record<string, unknown>,
        );
        if (url.endsWith("/responses")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: "resp_web",
                object: "response",
                status: "completed",
                output: [{
                  id: "ws_1",
                  type: "web_search_call",
                  status: "completed",
                  action: {
                    type: "search",
                    queries: ["Veryfront"],
                    sources: [{
                      type: "url",
                      url: "https://veryfront.com/",
                    }],
                  },
                }],
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{
                finish_reason: "stop",
                message: { role: "assistant", content: "Chat response" },
              }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      },
    });
    const prompt = [{
      role: "user",
      content: [{ type: "text", text: "Research Veryfront." }],
    }] as const;

    const searchResult = await runtime.doGenerate({
      prompt,
      tools: [{
        type: "provider",
        name: "web_search",
        id: "openai.web_search",
        args: {},
      }],
    });
    const chatResult = await runtime.doGenerate({ prompt });

    assertEquals(requestedUrls, [
      "https://example.openai.test/v1/responses",
      "https://example.openai.test/v1/chat/completions",
    ]);
    const responsesBody = requestedBodies[0];
    if (!responsesBody) {
      throw new Error("expected a Responses request body");
    }
    assertEquals(responsesBody.tools, [{ type: "web_search" }]);
    assertEquals(searchResult.content?.map((part) => (part as { type?: unknown }).type), [
      "tool-call",
      "tool-result",
    ]);
    assertEquals(chatResult.content, [{ type: "text", text: "Chat response" }]);
  });

  it("rejects hosted search when Chat Completions is explicitly configured", async () => {
    let fetchCalled = false;
    const provider = new OpenAIProvider();
    const runtime = provider.createModel("gpt-5.4", {
      credential: "test-openai-key",
      baseURL: "https://example.openai.test/v1",
      openAITransport: "chat-completions",
      fetch: () => {
        fetchCalled = true;
        return Promise.resolve(new Response("{}", { status: 200 }));
      },
    });

    await assertRejects(
      () =>
        runtime.doGenerate({
          prompt: [{ role: "user", content: [{ type: "text", text: "Research Veryfront." }] }],
          tools: [{
            type: "provider",
            name: "web_search",
            id: "openai.web_search",
            args: {},
          }],
        }),
      TypeError,
      "OpenAI hosted tools require the Responses API",
    );
    await assertRejects(
      () =>
        runtime.doStream({
          prompt: [{ role: "user", content: [{ type: "text", text: "Research Veryfront." }] }],
          tools: [{
            type: "provider",
            name: "web_search",
            id: "openai.web_search",
            args: {},
          }],
        }),
      TypeError,
      "OpenAI hosted tools require the Responses API",
    );
    assertEquals(fetchCalled, false);
  });

  it("applies Chat function-tool reasoning capabilities to generate requests", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const provider = new OpenAIProvider();
    const runtime = provider.createModel("gpt-5.5", {
      credential: "test-openai-key",
      baseURL: "https://example.openai.test/v1",
      name: "veryfront-cloud",
      providerName: "veryfront-cloud",
      openAITransport: "chat-completions",
      openAIChatReasoningWithFunctionTools: false,
      fetch: (_input, init) => {
        requestBody = JSON.parse(readRequestBody(init) ?? "{}");
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{
                finish_reason: "stop",
                message: { role: "assistant", content: "Done." },
              }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      },
    });

    await runtime.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "Use the tool." }] }],
      tools: [{
        type: "function",
        name: "lookup",
        inputSchema: { type: "object", properties: {} },
      }],
    });

    assertEquals(requestBody?.reasoning_effort, undefined);
    assertEquals(
      (requestBody?.tools as Array<{ function?: { name?: string } }> | undefined)?.[0]
        ?.function?.name,
      "lookup",
    );
  });

  it("keeps OpenAI-compatible provider identity separate from display labels", async () => {
    const encoder = new TextEncoder();
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;
    const provider = new OpenAIProvider();
    const runtime = provider.createModel("gpt-5.4-nano", {
      credential: "test-openai-compatible-key",
      baseURL: "https://example.compatible.test/v1",
      name: "prod-compatible-openai",
      providerName: "openai-compatible",
      fetch: (input, init) => {
        requestedUrl = String(input);
        requestedInit = init;
        return Promise.resolve(
          new Response(
            ReadableStream.from([
              encoder.encode('data: {"choices":[{"delta":{"content":"Done."}}]}\n\n'),
              encoder.encode(
                'data: {"choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}\n\n',
              ),
              encoder.encode("data: [DONE]\n\n"),
            ]),
            { status: 200, headers: { "content-type": "text/event-stream" } },
          ),
        );
      },
    });

    const result = await runtime.doStream({
      prompt: [{
        role: "user",
        content: [{ type: "text", text: "Use an OpenAI-compatible endpoint." }],
      }],
    });

    const requestBody = JSON.parse(readRequestBody(requestedInit) ?? "{}");
    const parts = await collectAsync(result.stream);

    assertEquals(runtime.provider, "prod-compatible-openai");
    assertEquals(requestedUrl, "https://example.compatible.test/v1/chat/completions");
    assertEquals(requestBody.reasoning, undefined);
    assertEquals(requestBody.reasoning_effort, undefined);
    assertEquals(parts.map((part) => (part as { type: string }).type), [
      "text-delta",
      "finish",
    ]);
  });

  it("parses OpenAI-compatible SSE streams when events use CRLF delimiters", async () => {
    const encoder = new TextEncoder();
    const runtime = createOpenAIModelRuntime({
      apiKey: "test-openai-key",
      baseURL: "https://example.openai.test/v1",
      fetch: () =>
        Promise.resolve(
          new Response(
            ReadableStream.from([
              encoder.encode(
                'data: {"choices":[{"delta":{"content":"Hello"}}]}\r\n\r\n',
              ),
              encoder.encode(
                'data: {"choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":8,"completion_tokens":2,"total_tokens":10}}\r\n\r\n',
              ),
              encoder.encode("data: [DONE]\r\n\r\n"),
            ]),
            {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            },
          ),
        ),
    }, "gpt-4o-mini");

    const result = await runtime.doStream({
      prompt: [{
        role: "user",
        content: [{ type: "text", text: "Say hello" }],
      }],
    });

    const parts = await collectAsync(result.stream);
    assertEquals(parts, [
      {
        type: "text-delta",
        delta: "Hello",
      },
      {
        type: "finish",
        finishReason: "stop",
        usage: {
          inputTokens: 8,
          outputTokens: 2,
          totalTokens: 10,
        },
      },
    ]);
  });

  it("parses OpenAI-compatible reasoning_content deltas into reasoning parts", async () => {
    const encoder = new TextEncoder();
    const runtime = createOpenAIModelRuntime({
      apiKey: "test-openai-key",
      baseURL: "https://example.openai.test/v1",
      fetch: () =>
        Promise.resolve(
          new Response(
            ReadableStream.from([
              encoder.encode(
                'data: {"choices":[{"delta":{"reasoning_content":"Let me think."}}]}\n\n',
              ),
              encoder.encode(
                'data: {"choices":[{"delta":{"content":"Done."}}]}\n\n',
              ),
              encoder.encode(
                'data: {"choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":8,"completion_tokens":2,"total_tokens":10}}\n\n',
              ),
              encoder.encode("data: [DONE]\n\n"),
            ]),
            {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            },
          ),
        ),
    }, "moonshotai/kimi-k2.5");

    const result = await runtime.doStream({
      prompt: [{
        role: "user",
        content: [{ type: "text", text: "Think before answering" }],
      }],
    });

    const parts = await collectAsync(result.stream);
    assertEquals(parts, [
      {
        type: "reasoning-start",
        id: "reasoning-0",
      },
      {
        type: "reasoning-delta",
        id: "reasoning-0",
        delta: "Let me think.",
      },
      {
        type: "reasoning-end",
        id: "reasoning-0",
      },
      {
        type: "text-delta",
        delta: "Done.",
      },
      {
        type: "finish",
        finishReason: "stop",
        usage: {
          inputTokens: 8,
          outputTokens: 2,
          totalTokens: 10,
        },
      },
    ]);
  });

  it("ignores secondary streamed choices for OpenAI-compatible reasoning deltas", async () => {
    const encoder = new TextEncoder();
    const runtime = createOpenAIModelRuntime({
      apiKey: "test-openai-key",
      baseURL: "https://example.openai.test/v1",
      fetch: () =>
        Promise.resolve(
          new Response(
            ReadableStream.from([
              encoder.encode(
                'data: {"choices":[{"index":0,"delta":{"reasoning_content":"Let me think."}},{"index":1,"delta":{"content":"Ignore me."}}]}\n\n',
              ),
              encoder.encode(
                'data: {"choices":[{"index":0,"delta":{"content":"Done."}},{"index":1,"delta":{"content":"Still ignored."}}]}\n\n',
              ),
              encoder.encode(
                'data: {"choices":[{"index":0,"finish_reason":"stop"},{"index":1,"finish_reason":"stop"}],"usage":{"prompt_tokens":8,"completion_tokens":2,"total_tokens":10}}\n\n',
              ),
              encoder.encode("data: [DONE]\n\n"),
            ]),
            {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            },
          ),
        ),
    }, "moonshotai/kimi-k2.5");

    const result = await runtime.doStream({
      prompt: [{
        role: "user",
        content: [{ type: "text", text: "Think before answering" }],
      }],
    });

    const parts = await collectAsync(result.stream);
    assertEquals(parts, [
      {
        type: "reasoning-start",
        id: "reasoning-0",
      },
      {
        type: "reasoning-delta",
        id: "reasoning-0",
        delta: "Let me think.",
      },
      {
        type: "reasoning-end",
        id: "reasoning-0",
      },
      {
        type: "text-delta",
        delta: "Done.",
      },
      {
        type: "finish",
        finishReason: "stop",
        usage: {
          inputTokens: 8,
          outputTokens: 2,
          totalTokens: 10,
        },
      },
    ]);
  });

  it("keeps OpenAI providerOptions scoped to the active provider and alias", async () => {
    let requestedInit: RequestInit | undefined;

    const runtime = createOpenAIModelRuntime({
      apiKey: "test-openai-key",
      baseURL: "https://example.openai.test/v1",
      name: "custom-openai",
      fetch: (_input, init) => {
        requestedInit = init;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: "done",
                },
              }],
              usage: {
                prompt_tokens: 4,
                completion_tokens: 1,
                total_tokens: 5,
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      },
    }, "gpt-4o-mini");

    await runtime.doGenerate({
      prompt: [{
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      }],
      providerOptions: {
        openai: { parallel_tool_calls: false },
        anthropic: { top_k: 3 },
        "custom-openai": { response_format: { type: "json_object" } },
      },
    });

    const requestBody = typeof requestedInit?.body === "string"
      ? JSON.parse(requestedInit.body)
      : undefined;
    assertEquals(requestBody?.parallel_tool_calls, false);
    assertEquals(requestBody?.response_format, { type: "json_object" });
    assertEquals("top_k" in (requestBody ?? {}), false);
  });

  // ---------------------------------------------------------------------------
  // OpenAI Embedding
  // ---------------------------------------------------------------------------

  it("creates an OpenAI embedding runtime without SDK helpers", async () => {
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;

    const runtime = createOpenAIEmbeddingRuntime({
      apiKey: "test-openai-key",
      baseURL: "https://example.openai.test/v1",
      fetch: (input, init) => {
        requestedUrl = String(input);
        requestedInit = init;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                { embedding: [1, 2], index: 0, object: "embedding" },
                { embedding: [3, 4], index: 1, object: "embedding" },
              ],
              usage: { prompt_tokens: 7, total_tokens: 7 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      },
    }, "text-embedding-3-small");

    const result = await runtime.doEmbed({ values: ["alpha", "beta"] });

    assertEquals(requestedUrl, "https://example.openai.test/v1/embeddings");
    assertEquals(requestedInit?.method, "POST");
    assertEquals(
      new Headers(requestedInit?.headers).get("authorization"),
      "Bearer test-openai-key",
    );
    assertEquals(
      requestedInit?.body,
      JSON.stringify({
        model: "text-embedding-3-small",
        input: ["alpha", "beta"],
      }),
    );
    assertEquals(result.embeddings, [[1, 2], [3, 4]]);
    assertEquals(result.usage, { tokens: 7 });
  });

  it("fails closed when a successful embedding response has the wrong vector count", async () => {
    const privatePayload = "<PRIVATE_PROVIDER_PAYLOAD>";
    const runtime = createOpenAIEmbeddingRuntime({
      apiKey: "k",
      baseURL: "https://example.openai.test/v1",
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              data: [{ embedding: [1, 2] }],
              diagnostic: privatePayload,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
    }, "text-embedding-3-small");

    const error = await assertRejects(
      async () => await runtime.doEmbed({ values: ["alpha", "beta"] }),
      ProviderRequestError,
      "expected 2 embedding vectors but received 1",
    );

    assertEquals(error.provider, "openai");
    assertEquals(error.status, 200);
    assertEquals(error.retryable, false);
    assertEquals(error.message.includes(privatePayload), false);
  });

  it("orders indexed embedding vectors by their requested input position", async () => {
    const runtime = createOpenAIEmbeddingRuntime({
      apiKey: "k",
      baseURL: "https://example.openai.test/v1",
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                { embedding: [3, 4], index: 1 },
                { embedding: [1, 2], index: 0 },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
    }, "text-embedding-3-small");

    const result = await runtime.doEmbed({ values: ["alpha", "beta"] });

    assertEquals(result.embeddings, [[1, 2], [3, 4]]);
  });

  it("rejects malformed embedding index sets", async () => {
    const malformedDataSets = [
      [
        { embedding: [1, 2], index: 0 },
        { embedding: [3, 4] },
      ],
      [
        { embedding: [1, 2], index: 0 },
        { embedding: [3, 4], index: 0 },
      ],
      [
        { embedding: [1, 2], index: 0 },
        { embedding: [3, 4], index: 2 },
      ],
      [
        { embedding: [1, 2], index: 0 },
        { embedding: [3, 4], index: 1.5 },
      ],
    ];

    for (const data of malformedDataSets) {
      const runtime = createOpenAIEmbeddingRuntime({
        apiKey: "k",
        baseURL: "https://example.openai.test/v1",
        fetch: () =>
          Promise.resolve(
            new Response(JSON.stringify({ data }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          ),
      }, "text-embedding-3-small");

      await assertRejects(
        async () => await runtime.doEmbed({ values: ["alpha", "beta"] }),
        ProviderRequestError,
        "embedding",
      );
    }
  });

  it("omits malformed embedding usage instead of inventing zero tokens", async () => {
    const runtime = createOpenAIEmbeddingRuntime({
      apiKey: "k",
      baseURL: "https://example.openai.test/v1",
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              data: [{ embedding: [1, 2] }],
              usage: { total_tokens: Number.MAX_SAFE_INTEGER + 1 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
    }, "text-embedding-3-small");

    const result = await runtime.doEmbed({ values: ["alpha"] });

    assertEquals(result.usage, undefined);
  });

  // ---------------------------------------------------------------------------
  // Reasoning / thinking request options (OpenAI-specific)
  // ---------------------------------------------------------------------------

  describe("reasoning / thinking request options (OpenAI)", () => {
    const userPrompt = {
      role: "user",
      content: [{ type: "text", text: "Solve this" }],
    } as const;

    function createOpenAICaptureRuntime(modelId: string) {
      let capturedBody: Record<string, unknown> | null = null;
      const runtime = createOpenAIModelRuntime({
        apiKey: "test-openai-key",
        baseURL: "https://example.openai.test/v1",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          capturedBody = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                choices: [{
                  index: 0,
                  message: { role: "assistant", content: "ok" },
                  finish_reason: "stop",
                }],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        },
      }, modelId);
      return { runtime, getBody: () => capturedBody };
    }

    it("emits OpenAI reasoning_effort when reasoning is enabled", async () => {
      const { runtime, getBody } = createOpenAICaptureRuntime("gpt-4o-mini");
      await runtime.doGenerate({
        prompt: [userPrompt],
        reasoning: { enabled: true, effort: "high" },
      });
      const body = getBody() as { reasoning_effort: string };
      assertEquals(body.reasoning_effort, "high");
    });

    it("collapses OpenAI 'max' effort to 'high'", async () => {
      const { runtime, getBody } = createOpenAICaptureRuntime("gpt-4o-mini");
      await runtime.doGenerate({
        prompt: [userPrompt],
        reasoning: { enabled: true, effort: "max" },
      });
      const body = getBody() as { reasoning_effort: string };
      assertEquals(body.reasoning_effort, "high");
    });

    it("drops OpenAI sampling params on reasoning models (o1/o3/o4)", async () => {
      const { runtime, getBody } = createOpenAICaptureRuntime("o3-mini");
      await runtime.doGenerate({
        prompt: [userPrompt],
        temperature: 0.7,
        topP: 0.9,
        presencePenalty: 0.1,
        frequencyPenalty: 0.1,
      });
      const body = getBody() as Record<string, unknown>;
      assertEquals("temperature" in body, false);
      assertEquals("top_p" in body, false);
      assertEquals("presence_penalty" in body, false);
      assertEquals("frequency_penalty" in body, false);
    });

    it("preserves OpenAI sampling params on non-reasoning models", async () => {
      const { runtime, getBody } = createOpenAICaptureRuntime("gpt-4o-mini");
      await runtime.doGenerate({
        prompt: [userPrompt],
        temperature: 0.7,
        topP: 0.9,
      });
      const body = getBody() as { temperature: number; top_p: number };
      assertEquals(body.temperature, 0.7);
      assertEquals(body.top_p, 0.9);
    });
  });

  // ---------------------------------------------------------------------------
  // Cache usage reporting (OpenAI-specific)
  // ---------------------------------------------------------------------------

  describe("cache usage reporting (OpenAI)", () => {
    const userPrompt = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
    } as const;

    it("surfaces OpenAI prompt_tokens_details.cached_tokens as cacheReadInputTokens", async () => {
      const runtime = createOpenAIModelRuntime({
        apiKey: "test-openai-key",
        baseURL: "https://example.openai.test/v1",
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                choices: [{
                  index: 0,
                  message: { role: "assistant", content: "ok" },
                  finish_reason: "stop",
                }],
                usage: {
                  prompt_tokens: 100,
                  completion_tokens: 40,
                  total_tokens: 140,
                  prompt_tokens_details: { cached_tokens: 80 },
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
      }, "gpt-4o-mini");

      const result = await runtime.doGenerate({ prompt: [userPrompt] });
      assertEquals(result.usage, {
        inputTokens: 100,
        outputTokens: 40,
        totalTokens: 140,
        cacheReadInputTokens: 80,
        cachedInputTokens: 80,
      });
    });

    it("leaves OpenAI cache field undefined when prompt_tokens_details is absent", async () => {
      const runtime = createOpenAIModelRuntime({
        apiKey: "test-openai-key",
        baseURL: "https://example.openai.test/v1",
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                choices: [{
                  index: 0,
                  message: { role: "assistant", content: "ok" },
                  finish_reason: "stop",
                }],
                usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
      }, "gpt-4o-mini");

      const result = await runtime.doGenerate({ prompt: [userPrompt] });
      assertEquals(result.usage, {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Transient error classification (OpenAI-specific)
  // ---------------------------------------------------------------------------

  describe("transient error classification — OpenAI (503 / 429 / 400)", () => {
    const userPrompt = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
    } as const;

    function errorResponse(status: number, body: unknown, headers?: Record<string, string>) {
      return new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
      });
    }

    async function expectError<E extends Error>(
      promise: PromiseLike<unknown>,
      errorClass: new (...args: never[]) => E,
    ): Promise<E> {
      try {
        await promise;
        throw new Error("Expected promise to reject, but it resolved");
      } catch (err) {
        if (!(err instanceof errorClass)) {
          throw new Error(
            `Expected ${errorClass.name}, got ${err instanceof Error ? err.name : typeof err}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
        return err;
      }
    }

    it("classifies OpenAI 503 as ProviderOverloadedError (retryable)", async () => {
      const runtime = createOpenAIModelRuntime({
        apiKey: "k",
        baseURL: "https://example.openai.test/v1",
        fetch: () => Promise.resolve(errorResponse(503, { error: { message: "Service down" } })),
      }, "gpt-4o-mini");
      const err = await expectError(
        runtime.doGenerate({ prompt: [userPrompt] }),
        ProviderOverloadedError,
      );
      assertEquals(err.provider, "openai");
      assertEquals(err.status, 503);
      assertEquals(err.retryable, true);
    });

    it("classifies OpenAI 429 rate_limit_exceeded as ProviderRateLimitError with Retry-After", async () => {
      const runtime = createOpenAIModelRuntime({
        apiKey: "k",
        baseURL: "https://example.openai.test/v1",
        fetch: () =>
          Promise.resolve(
            errorResponse(
              429,
              { error: { code: "rate_limit_exceeded", message: "Slow down" } },
              { "retry-after": "12" },
            ),
          ),
      }, "gpt-4o-mini");
      const err = await expectError(
        runtime.doGenerate({ prompt: [userPrompt] }),
        ProviderRateLimitError,
      );
      assertEquals(err.provider, "openai");
      assertEquals(err.status, 429);
      assertEquals(err.retryable, true);
      assertEquals(err.retryAfterMs, 12_000);
    });

    it("classifies OpenAI 429 insufficient_quota as ProviderQuotaError (non-retryable)", async () => {
      const runtime = createOpenAIModelRuntime({
        apiKey: "k",
        baseURL: "https://example.openai.test/v1",
        fetch: () =>
          Promise.resolve(
            errorResponse(429, {
              error: { code: "insufficient_quota", message: "Out of credits" },
            }),
          ),
      }, "gpt-4o-mini");
      const err = await expectError(
        runtime.doGenerate({ prompt: [userPrompt] }),
        ProviderQuotaError,
      );
      assertEquals(err.retryable, false);
    });

    it("preserves non-retryable 4xx as ProviderRequestError", async () => {
      const runtime = createOpenAIModelRuntime({
        apiKey: "k",
        baseURL: "https://example.openai.test/v1",
        fetch: () => Promise.resolve(errorResponse(400, { error: { message: "Bad request" } })),
      }, "gpt-4o-mini");
      const err = await expectError(
        runtime.doGenerate({ prompt: [userPrompt] }),
        ProviderRequestError,
      );
      assertEquals(err.retryable, false);
      assertEquals(err.status, 400);
    });
  });

  // ---------------------------------------------------------------------------
  // Provider warnings (OpenAI-specific unsupported-setting drops)
  // ---------------------------------------------------------------------------

  describe("provider warnings — OpenAI (unsupported-setting drops)", () => {
    const userPrompt = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
    } as const;

    function okOpenAIResponse() {
      return new Response(
        JSON.stringify({
          choices: [{
            index: 0,
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    function settings(result: { warnings?: unknown[] }): string[] {
      return (result.warnings ?? []).flatMap((w) => {
        const r = w as { setting?: string };
        return r.setting ? [r.setting] : [];
      });
    }

    it("warns on OpenAI topK on Chat Completions", async () => {
      const runtime = createOpenAIModelRuntime({
        apiKey: "k",
        baseURL: "https://example.openai.test/v1",
        fetch: () => Promise.resolve(okOpenAIResponse()),
      }, "gpt-4o-mini");
      const result = await runtime.doGenerate({
        prompt: [userPrompt],
        topK: 50,
      });
      assertEquals(settings(result), ["topK"]);
    });

    it("warns on OpenAI sampling params dropped for o3 reasoning model", async () => {
      const runtime = createOpenAIModelRuntime({
        apiKey: "k",
        baseURL: "https://example.openai.test/v1",
        fetch: () => Promise.resolve(okOpenAIResponse()),
      }, "o3-mini");
      const result = await runtime.doGenerate({
        prompt: [userPrompt],
        temperature: 0.7,
        topP: 0.9,
        presencePenalty: 0.1,
        frequencyPenalty: 0.1,
      });
      const dropped = settings(result).sort();
      assertEquals(dropped, [
        "frequencyPenalty",
        "presencePenalty",
        "temperature",
        "topP",
      ]);
    });

    it("emits OpenAI user field when userId is set", async () => {
      let captured: Record<string, unknown> | null = null;
      const runtime = createOpenAIModelRuntime({
        apiKey: "k",
        baseURL: "https://example.openai.test/v1",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          captured = raw ? JSON.parse(raw) : null;
          return Promise.resolve(okOpenAIResponse());
        },
      }, "gpt-4o-mini");
      await runtime.doGenerate({
        prompt: [userPrompt],
        userId: "user_42",
      });
      const body = captured as { user: string } | null;
      assertEquals(body?.user, "user_42");
    });

    it("warnings are present on stream results too", async () => {
      const encoder = new TextEncoder();
      const runtime = createOpenAIModelRuntime({
        apiKey: "k",
        baseURL: "https://example.openai.test/v1",
        fetch: () =>
          Promise.resolve(
            new Response(
              ReadableStream.from([
                encoder.encode(
                  'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
                ),
                encoder.encode(
                  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
                ),
                encoder.encode(
                  'data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n',
                ),
                encoder.encode("data: [DONE]\n\n"),
              ]),
              { status: 200, headers: { "content-type": "text/event-stream" } },
            ),
          ),
      }, "o3-mini");
      const result = await runtime.doStream({
        prompt: [userPrompt],
        temperature: 0.5,
      });
      assertEquals(settings(result), ["temperature"]);
      // Drain the stream to keep Deno test runner happy.
      await collectAsync(result.stream);
    });
  });

  // ---------------------------------------------------------------------------
  // OpenAI service_tier / parallelToolCalls / responseFormat (top-level options)
  // ---------------------------------------------------------------------------

  describe("OpenAI request options (service_tier, parallelToolCalls, responseFormat)", () => {
    function okOpenAIResponse() {
      return new Response(
        JSON.stringify({
          choices: [{
            index: 0,
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    it("emits OpenAI service_tier when serviceTier is set", async () => {
      let captured: Record<string, unknown> | null = null;
      const runtime = createOpenAIModelRuntime({
        apiKey: "k",
        baseURL: "https://example.openai.test/v1",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          captured = raw ? JSON.parse(raw) : null;
          return Promise.resolve(okOpenAIResponse());
        },
      }, "gpt-4o-mini");
      await runtime.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        serviceTier: "flex",
      });
      const body = captured as { service_tier: string } | null;
      assertEquals(body!.service_tier, "flex");
    });

    it("emits OpenAI parallel_tool_calls: false when parallelToolCalls is false", async () => {
      let captured: Record<string, unknown> | null = null;
      const runtime = createOpenAIModelRuntime({
        apiKey: "k",
        baseURL: "https://example.openai.test/v1",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          captured = raw ? JSON.parse(raw) : null;
          return Promise.resolve(okOpenAIResponse());
        },
      }, "gpt-4o-mini");
      await runtime.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        parallelToolCalls: false,
      });
      const body = captured as { parallel_tool_calls: boolean } | null;
      assertEquals(body!.parallel_tool_calls, false);
    });

    it("omits service_tier and parallel_tool_calls when unset", async () => {
      let captured: Record<string, unknown> | null = null;
      const runtime = createOpenAIModelRuntime({
        apiKey: "k",
        baseURL: "https://example.openai.test/v1",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          captured = raw ? JSON.parse(raw) : null;
          return Promise.resolve(okOpenAIResponse());
        },
      }, "gpt-4o-mini");
      await runtime.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      });
      assertEquals("service_tier" in (captured ?? {}), false);
      assertEquals("parallel_tool_calls" in (captured ?? {}), false);
    });

    it("emits OpenAI response_format json_schema when responseFormat is structured", async () => {
      let captured: Record<string, unknown> | null = null;
      const runtime = createOpenAIModelRuntime({
        apiKey: "k",
        baseURL: "https://example.openai.test/v1",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          captured = raw ? JSON.parse(raw) : null;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                choices: [{
                  index: 0,
                  message: { role: "assistant", content: "{}" },
                  finish_reason: "stop",
                }],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        },
      }, "gpt-4o-2024-08-06");
      const schema = {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
        additionalProperties: false,
      };
      await runtime.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        responseFormat: {
          type: "json_schema",
          name: "Person",
          schema,
          strict: true,
        },
      });
      const body = captured as { response_format: Record<string, unknown> } | null;
      assertEquals(body!.response_format, {
        type: "json_schema",
        json_schema: {
          name: "Person",
          schema,
          strict: true,
        },
      });
    });

    it("emits OpenAI response_format json_object for type:json", async () => {
      let captured: Record<string, unknown> | null = null;
      const runtime = createOpenAIModelRuntime({
        apiKey: "k",
        baseURL: "https://example.openai.test/v1",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          captured = raw ? JSON.parse(raw) : null;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                choices: [{
                  index: 0,
                  message: { role: "assistant", content: "{}" },
                  finish_reason: "stop",
                }],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        },
      }, "gpt-4o-mini");
      await runtime.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        responseFormat: { type: "json" },
      });
      const body = captured as { response_format: { type: "json_object" } } | null;
      assertEquals(body!.response_format, { type: "json_object" });
    });
  });

  // ---------------------------------------------------------------------------
  // OpenAI Responses API runtime (#1077)
  // ---------------------------------------------------------------------------

  describe("OpenAI Responses API runtime (#1077)", () => {
    const userPrompt = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
    } as const;

    function captureResponsesRuntime(modelId = "gpt-4o-mini") {
      let captured: Record<string, unknown> | null = null;
      const runtime = createOpenAIResponsesRuntime({
        apiKey: "k",
        baseURL: "https://example.openai.test/v1",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          captured = raw ? JSON.parse(raw) : null;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: "resp_1",
                object: "response",
                status: "completed",
                output: [{
                  type: "message",
                  id: "msg_1",
                  role: "assistant",
                  content: [{ type: "output_text", text: "ok" }],
                }],
                usage: {
                  input_tokens: 1,
                  output_tokens: 1,
                  total_tokens: 2,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        },
      }, modelId);
      return { runtime, getBody: () => captured };
    }

    it("hits the /v1/responses endpoint, not /v1/chat/completions", async () => {
      let capturedUrl: string | undefined;
      const runtime = createOpenAIResponsesRuntime({
        apiKey: "k",
        baseURL: "https://example.openai.test/v1",
        fetch: (input) => {
          capturedUrl = typeof input === "string" ? input : (input as URL).toString();
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: "resp_1",
                object: "response",
                status: "completed",
                output: [{
                  type: "message",
                  id: "msg_1",
                  role: "assistant",
                  content: [{ type: "output_text", text: "ok" }],
                }],
                usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        },
      }, "gpt-4o-mini");
      await runtime.doGenerate({ prompt: [userPrompt] });
      assertEquals(capturedUrl, "https://example.openai.test/v1/responses");
    });

    it("fails closed when a successful Responses envelope is missing its output array", async () => {
      const privatePayload = "<PRIVATE_PROVIDER_PAYLOAD>";
      const runtime = createOpenAIResponsesRuntime({
        apiKey: "k",
        baseURL: "https://example.openai.test/v1",
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                status: "completed",
                diagnostic: privatePayload,
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
      }, "gpt-4o-mini");

      const error = await assertRejects(
        async () => await runtime.doGenerate({ prompt: [userPrompt] }),
        ProviderRequestError,
        "output array missing",
      );

      assertEquals(error.status, 200);
      assertEquals(error.retryable, false);
      assertEquals(error.message.includes(privatePayload), false);
    });

    it("rejects queued or in-progress Responses instead of treating them as final", async () => {
      for (const status of ["queued", "in_progress"]) {
        const runtime = createOpenAIResponsesRuntime({
          apiKey: "k",
          baseURL: "https://example.openai.test/v1",
          fetch: () =>
            Promise.resolve(
              new Response(
                JSON.stringify({
                  id: "resp_background",
                  object: "response",
                  status,
                  output: [],
                }),
                { status: 200, headers: { "content-type": "application/json" } },
              ),
            ),
        }, "gpt-5.4-nano");

        await assertRejects(
          async () => await runtime.doGenerate({ prompt: [userPrompt] }),
          ProviderRequestError,
          "response status was unsupported or nonterminal",
        );
      }
    });

    it("rejects non-object or malformed Responses function arguments", async () => {
      for (const argumentsText of ["[]", "null", '{"city":']) {
        const runtime = createOpenAIResponsesRuntime({
          apiKey: "k",
          baseURL: "https://example.openai.test/v1",
          fetch: () =>
            Promise.resolve(
              new Response(
                JSON.stringify({
                  id: "resp_invalid_tool",
                  object: "response",
                  status: "completed",
                  output: [{
                    type: "function_call",
                    id: "fc_invalid",
                    call_id: "call_invalid",
                    name: "weather",
                    arguments: argumentsText,
                  }],
                }),
                { status: 200, headers: { "content-type": "application/json" } },
              ),
            ),
        }, "gpt-5.4-nano");

        await assertRejects(
          async () => await runtime.doGenerate({ prompt: [userPrompt] }),
          ProviderRequestError,
          "arguments were not valid JSON object text",
        );
      }
    });

    it("rejects nonterminal, unsupported, or ambiguously correlated output items", async () => {
      const cases: Array<{ expected: string; output: unknown[] }> = [
        {
          expected: `output exceeded ${MAX_OPENAI_RAW_RESPONSE_OUTPUT_ITEMS} items`,
          output: Array.from(
            { length: MAX_OPENAI_RAW_RESPONSE_OUTPUT_ITEMS + 1 },
            (_, index) => ({
              id: `msg_${index}`,
              type: "message",
              role: "assistant",
              content: [],
            }),
          ),
        },
        {
          expected: "message output role was not assistant",
          output: [{
            id: "msg_user",
            type: "message",
            role: "user",
            status: "completed",
            content: [{ type: "output_text", text: "wrong role" }],
          }],
        },
        {
          expected: "output item status was unsupported or nonterminal",
          output: [{
            id: "msg_pending",
            type: "message",
            role: "assistant",
            status: "in_progress",
            content: [{ type: "output_text", text: "not final" }],
          }],
        },
        {
          expected: "output item status was unsupported or nonterminal",
          output: [{
            id: "fc_pending",
            type: "function_call",
            call_id: "call_pending",
            name: "lookup",
            arguments: "{}",
            status: "in_progress",
          }],
        },
        {
          expected: "output item type was unsupported",
          output: [{ id: "future_1", type: "future", status: "completed" }],
        },
        {
          expected: "reasoning summary item was malformed",
          output: [{
            id: "rs_invalid",
            type: "reasoning",
            status: "completed",
            summary: [{ type: "future_summary", text: "ignored before hardening" }],
          }],
        },
        {
          expected: "output item type missing",
          output: [{}],
        },
        {
          expected: "output item id was malformed",
          output: [{
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: "missing id" }],
          }],
        },
        {
          expected: "function call output item was malformed",
          output: [{
            id: "fc_missing_call_id",
            type: "function_call",
            name: "lookup",
            arguments: "{}",
            status: "completed",
          }],
        },
        {
          expected: "message output contained too many content parts",
          output: [{
            id: "msg_many_parts",
            type: "message",
            role: "assistant",
            status: "completed",
            content: Array.from(
              { length: MAX_OPENAI_RAW_RESPONSE_OUTPUT_ITEMS + 1 },
              () => ({ type: "output_text", text: "" }),
            ),
          }],
        },
        {
          expected: "URL citation annotation range exceeded output text",
          output: [{
            id: "msg_bad_citation_range",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{
              type: "output_text",
              text: "short",
              annotations: [{
                type: "url_citation",
                start_index: 0,
                end_index: 6,
                url: "https://example.test/",
                title: "Example",
              }],
            }],
          }],
        },
        {
          expected: "response contained duplicate function call ids",
          output: [
            {
              id: "fc_1",
              type: "function_call",
              call_id: "call_dup",
              name: "first",
              arguments: "{}",
              status: "completed",
            },
            {
              id: "fc_2",
              type: "function_call",
              call_id: "call_dup",
              name: "second",
              arguments: "{}",
              status: "completed",
            },
          ],
        },
      ];

      for (const { expected, output } of cases) {
        const runtime = createOpenAIResponsesRuntime({
          apiKey: "k",
          baseURL: "https://example.openai.test/v1",
          fetch: () =>
            Promise.resolve(
              new Response(
                JSON.stringify({
                  id: "resp_invalid_output",
                  object: "response",
                  status: "completed",
                  output,
                }),
                { status: 200, headers: { "content-type": "application/json" } },
              ),
            ),
        }, "gpt-5.4-nano");

        await assertRejects(
          async () => await runtime.doGenerate({ prompt: [userPrompt] }),
          ProviderRequestError,
          expected,
        );
      }
    });

    it("preserves a structurally valid Responses result with an empty output array", async () => {
      const runtime = createOpenAIResponsesRuntime({
        apiKey: "k",
        baseURL: "https://example.openai.test/v1",
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                id: "resp_empty",
                object: "response",
                status: "completed",
                output: [],
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
      }, "gpt-4o-mini");

      const result = await runtime.doGenerate({ prompt: [userPrompt] });

      assertEquals(result.content, []);
      assertEquals(result.finishReason, { unified: "stop", raw: "completed" });
    });

    it("converts user message to input_text content part on the wire", async () => {
      const { runtime, getBody } = captureResponsesRuntime();
      await runtime.doGenerate({ prompt: [userPrompt] });
      const body = getBody() as { input: Array<Record<string, unknown>> } | null;
      assertEquals(body!.input, [{
        role: "user",
        content: [{ type: "input_text", text: "Hi" }],
      }]);
    });

    it("converts image URL user parts to Responses input_image content", async () => {
      const { runtime, getBody } = captureResponsesRuntime();
      await runtime.doGenerate({
        prompt: [{
          role: "user",
          content: [
            { type: "text", text: "What is this?" },
            {
              type: "image",
              mediaType: "image/jpeg",
              url: "https://signed.example.com/web-app-screenshot.jpg",
            },
          ],
        }],
      });
      const body = getBody() as { input: Array<Record<string, unknown>> } | null;
      assertEquals(body!.input, [{
        role: "user",
        content: [
          { type: "input_text", text: "What is this?" },
          {
            type: "input_image",
            image_url: "https://signed.example.com/web-app-screenshot.jpg",
            detail: "auto",
          },
        ],
      }]);
    });

    it("lifts system message to top-level instructions field", async () => {
      const { runtime, getBody } = captureResponsesRuntime();
      await runtime.doGenerate({
        prompt: [
          { role: "system", content: "You are concise." },
          userPrompt,
        ],
      });
      const body = getBody() as { instructions: string; input: unknown[] } | null;
      assertEquals(body!.instructions, "You are concise.");
      // System message should NOT appear in the input array.
      assertEquals(body!.input.length, 1);
    });

    it("emits structured reasoning object with effort + summary on reasoning request", async () => {
      const { runtime, getBody } = captureResponsesRuntime("o3");
      await runtime.doGenerate({
        prompt: [userPrompt],
        reasoning: { enabled: true, effort: "high" },
      });
      const body = getBody() as {
        reasoning: Record<string, string>;
        include: string[];
      } | null;
      assertEquals(body!.reasoning, { effort: "high", summary: "auto" });
      assertEquals(body!.include, ["reasoning.encrypted_content"]);
    });

    it("drops sampling params on reasoning models and emits warnings", async () => {
      const { runtime, getBody } = captureResponsesRuntime("o3-mini");
      const result = await runtime.doGenerate({
        prompt: [userPrompt],
        temperature: 0.7,
        topP: 0.9,
        presencePenalty: 0.1,
        frequencyPenalty: 0.1,
      }) as { warnings?: Array<{ setting?: string }> };
      const body = getBody() as Record<string, unknown> | null;
      assertEquals("temperature" in (body ?? {}), false);
      assertEquals("top_p" in (body ?? {}), false);
      const dropped = (result.warnings ?? [])
        .flatMap((w) => (w.setting ? [w.setting] : []))
        .sort();
      assertEquals(dropped, [
        "frequencyPenalty",
        "presencePenalty",
        "temperature",
        "topP",
      ]);
    });

    it("emits text.format json_schema for structured outputs", async () => {
      const { runtime, getBody } = captureResponsesRuntime("gpt-4o-2024-08-06");
      const schema = {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
        additionalProperties: false,
      };
      await runtime.doGenerate({
        prompt: [userPrompt],
        responseFormat: {
          type: "json_schema",
          name: "Person",
          schema,
          strict: true,
        },
      });
      const body = getBody() as { text: { format: Record<string, unknown> } } | null;
      assertEquals(body!.text.format, {
        type: "json_schema",
        name: "Person",
        schema,
        strict: true,
      });
    });

    it("parses message + reasoning + function_call output items into UI parts", async () => {
      const output = [
        {
          type: "reasoning",
          id: "rs_1",
          summary: [
            { type: "summary_text", text: "First, I'll check the weather." },
          ],
          content: [
            { type: "reasoning_text", text: "Detailed reasoning." },
          ],
          encrypted_content: "sig_abc",
        },
        {
          type: "function_call",
          id: "fc_1",
          call_id: "call_weather",
          name: "get_weather",
          arguments: '{"city":"Tokyo"}',
        },
        {
          type: "message",
          id: "msg_1",
          role: "assistant",
          content: [{ type: "output_text", text: "It is sunny." }],
        },
      ];
      const runtime = createOpenAIResponsesRuntime({
        apiKey: "k",
        baseURL: "https://example.openai.test/v1",
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                id: "resp_1",
                object: "response",
                status: "completed",
                output,
                usage: {
                  input_tokens: 12,
                  output_tokens: 34,
                  total_tokens: 46,
                  output_tokens_details: { reasoning_tokens: 8 },
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
      }, "o3");
      const result = await runtime.doGenerate({ prompt: [userPrompt] });
      assertEquals(result.content, [
        {
          type: "reasoning",
          text: "First, I'll check the weather.Detailed reasoning.",
          signature: "sig_abc",
        },
        {
          type: "tool-call",
          toolCallId: "call_weather",
          toolName: "get_weather",
          input: '{"city":"Tokyo"}',
        },
        { type: "text", text: "It is sunny." },
      ]);
      assertEquals(result.usage, {
        inputTokens: 12,
        outputTokens: 34,
        reasoningTokens: 8,
        totalTokens: 46,
      });
      assertEquals(result.finishReason, { unified: "stop", raw: "completed" });
      assertEquals(result.providerMetadata, {
        openai: { rawResponseOutputItems: output },
      });
    });

    it("preserves hosted web-search output exactly for the next stateless request", async () => {
      const requests: Array<Record<string, unknown>> = [];
      const webSearchItem = {
        type: "web_search_call",
        id: "ws_1",
        status: "completed",
        action: {
          type: "search",
          queries: ["Veryfront"],
          sources: [{ type: "url", url: "https://example.test/source" }],
        },
      };
      const messageItem = {
        type: "message",
        id: "msg_web",
        role: "assistant",
        status: "completed",
        content: [{
          type: "output_text",
          text: "Result",
          annotations: [{
            type: "url_citation",
            start_index: 0,
            end_index: 6,
            url: "https://example.test/source",
            title: "Source",
          }],
        }],
      };
      const runtime = createOpenAIResponsesRuntime({
        apiKey: "k",
        baseURL: "https://example.openai.test/v1",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          requests.push(raw ? JSON.parse(raw) : {});
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: "resp_web",
                object: "response",
                status: "completed",
                output: [webSearchItem, messageItem],
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        },
      }, "gpt-5.4-nano");
      const tools = [{
        type: "provider",
        name: "research",
        id: "openai.web_search",
        args: {},
      }] as const;

      const first = await runtime.doGenerate({ prompt: [userPrompt], tools });
      const expectedFirstContent: RuntimeAssistantContentPart[] = [
        {
          type: "tool-call",
          toolCallId: "ws_1",
          toolName: "research",
          input: '{"type":"search","queries":["Veryfront"]}',
          providerExecuted: true,
        },
        {
          type: "tool-result",
          toolCallId: "ws_1",
          toolName: "research",
          result: {
            status: "completed",
            sources: [{ type: "url", url: "https://example.test/source" }],
          },
          providerExecuted: true,
        },
        { type: "text", text: "Result" },
      ];
      assertEquals(first.content, expectedFirstContent);
      if (!first.content) {
        throw new Error("expected validated hosted-search content");
      }
      assertEquals(first.providerMetadata, {
        openai: {
          rawResponseOutputItems: [webSearchItem, messageItem],
        },
      });

      await runtime.doGenerate({
        prompt: [
          userPrompt,
          {
            role: "assistant",
            content: first.content,
            providerMetadata: first.providerMetadata,
          },
          {
            role: "user",
            content: [{ type: "text", text: "Continue" }],
          },
        ],
        tools,
      });
      const continuationRequest = requests[1];
      if (!continuationRequest) {
        throw new Error("expected a continuation request");
      }
      assertEquals(continuationRequest.input, [
        {
          role: "user",
          content: [{ type: "input_text", text: "Hi" }],
        },
        webSearchItem,
        messageItem,
        {
          role: "user",
          content: [{ type: "input_text", text: "Continue" }],
        },
      ]);
    });

    it("surfaces a failed hosted web-search call as a provider-executed error result", async () => {
      const webSearchItem = {
        type: "web_search_call",
        id: "ws_failed",
        status: "failed",
        action: { type: "open_page", url: null },
      };
      const runtime = createOpenAIResponsesRuntime({
        apiKey: "k",
        baseURL: "https://example.openai.test/v1",
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                id: "resp_failed_web",
                object: "response",
                status: "completed",
                output: [webSearchItem],
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
      }, "gpt-5.4-nano");

      const result = await runtime.doGenerate({
        prompt: [userPrompt],
        tools: [{
          type: "provider",
          name: "research",
          id: "openai.web_search",
          args: {},
        }],
      });

      assertEquals(result.content, [
        {
          type: "tool-call",
          toolCallId: "ws_failed",
          toolName: "research",
          input: '{"type":"open_page","url":null}',
          providerExecuted: true,
        },
        {
          type: "tool-result",
          toolCallId: "ws_failed",
          toolName: "research",
          result: {
            status: "failed",
            action: { type: "open_page", url: null },
          },
          isError: true,
          providerExecuted: true,
        },
      ]);
      assertEquals(result.providerMetadata, {
        openai: { rawResponseOutputItems: [webSearchItem] },
      });
    });

    it("rejects provider-executed web search that was not configured by the caller", async () => {
      const runtime = createOpenAIResponsesRuntime({
        apiKey: "k",
        baseURL: "https://example.openai.test/v1",
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                id: "resp_unexpected_web",
                object: "response",
                status: "completed",
                output: [{
                  type: "web_search_call",
                  id: "ws_unexpected",
                  status: "completed",
                  action: { type: "search", query: "unexpected" },
                }],
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
      }, "gpt-5.4-nano");

      await assertRejects(
        async () => await runtime.doGenerate({ prompt: [userPrompt] }),
        ProviderRequestError,
        "without a configured web-search tool",
      );
    });

    it("parses Responses streaming events into UI parts (text + reasoning + tool call)", async () => {
      const encoder = new TextEncoder();
      const runtime = createOpenAIResponsesRuntime({
        apiKey: "k",
        baseURL: "https://example.openai.test/v1",
        fetch: () =>
          Promise.resolve(
            new Response(
              ReadableStream.from([
                // Reasoning item starts
                encoder.encode(
                  'data: {"type":"response.output_item.added","item":{"id":"rs_1","type":"reasoning"}}\n\n',
                ),
                encoder.encode(
                  'data: {"type":"response.reasoning_summary_text.delta","item_id":"rs_1","delta":"Thinking..."}\n\n',
                ),
                encoder.encode(
                  'data: {"type":"response.output_item.done","item":{"id":"rs_1","type":"reasoning","summary":[{"type":"summary_text","text":"Thinking..."}]}}\n\n',
                ),
                // Function call item
                encoder.encode(
                  'data: {"type":"response.output_item.added","item":{"id":"fc_1","type":"function_call","call_id":"call_w","name":"weather"}}\n\n',
                ),
                encoder.encode(
                  'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","delta":"{\\"city\\":\\"Tokyo\\"}"}\n\n',
                ),
                encoder.encode(
                  'data: {"type":"response.output_item.done","item":{"id":"fc_1","type":"function_call","call_id":"call_w","name":"weather","arguments":"{\\"city\\":\\"Tokyo\\"}"}}\n\n',
                ),
                // Text message
                encoder.encode(
                  'data: {"type":"response.output_item.added","item":{"id":"msg_1","type":"message"}}\n\n',
                ),
                encoder.encode(
                  'data: {"type":"response.output_text.delta","item_id":"msg_1","delta":"It is sunny."}\n\n',
                ),
                encoder.encode(
                  'data: {"type":"response.output_item.done","item":{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"output_text","text":"It is sunny."}]}}\n\n',
                ),
                // Completion
                encoder.encode(
                  'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":12,"output_tokens":34,"total_tokens":46}}}\n\n',
                ),
                encoder.encode("data: [DONE]\n\n"),
              ]),
              { status: 200, headers: { "content-type": "text/event-stream" } },
            ),
          ),
      }, "o3");

      const result = await runtime.doStream({ prompt: [userPrompt] });
      const parts = await collectAsync(result.stream);
      const partTypes = parts.map((p) => (p as { type: string }).type);

      assertEquals(partTypes, [
        "reasoning-start",
        "reasoning-delta",
        "reasoning-end",
        "tool-input-start",
        "tool-input-delta",
        "tool-call",
        "text-delta",
        "finish",
      ]);

      const finish = parts.find((p) => (p as { type: string }).type === "finish") as {
        usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
        providerMetadata?: Record<string, unknown>;
      };
      assertEquals(finish.usage, {
        inputTokens: 12,
        outputTokens: 34,
        totalTokens: 46,
      });
      assertEquals(finish.providerMetadata, {
        openai: {
          rawResponseOutputItems: [
            {
              id: "rs_1",
              type: "reasoning",
              summary: [{ type: "summary_text", text: "Thinking..." }],
            },
            {
              id: "fc_1",
              type: "function_call",
              call_id: "call_w",
              name: "weather",
              arguments: '{"city":"Tokyo"}',
            },
            {
              id: "msg_1",
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "It is sunny." }],
            },
          ],
        },
      });

      const toolCall = parts.find((p) => (p as { type: string }).type === "tool-call") as {
        toolCallId: string;
        toolName: string;
        input: string;
      };
      assertEquals(toolCall.toolCallId, "call_w");
      assertEquals(toolCall.toolName, "weather");
      assertEquals(toolCall.input, '{"city":"Tokyo"}');
    });

    it("replays reasoning content parts as top-level reasoning items on the next request", async () => {
      const { runtime, getBody } = captureResponsesRuntime("o3");
      await runtime.doGenerate({
        prompt: [
          userPrompt,
          {
            role: "assistant",
            content: [
              {
                type: "reasoning",
                text: "Step by step thinking",
                signature: "sig_abc",
              },
              { type: "text", text: "The answer is 42." },
            ],
          },
          { role: "user", content: [{ type: "text", text: "Are you sure?" }] },
        ],
      });
      const body = getBody() as { input: Array<Record<string, unknown>> } | null;
      // Expected order: user, reasoning (top-level), assistant text, user.
      assertEquals(body!.input.length, 4);
      assertEquals((body!.input[1] as { type: string }).type, "reasoning");
      assertEquals(body!.input[1], {
        type: "reasoning",
        encrypted_content: "sig_abc",
        summary: [{ type: "summary_text", text: "Step by step thinking" }],
      });
      assertEquals(body!.input[2], {
        role: "assistant",
        content: [{ type: "output_text", text: "The answer is 42." }],
      });
    });

    it("converts tool messages to function_call_output items", async () => {
      const { runtime, getBody } = captureResponsesRuntime("gpt-4o-mini");
      await runtime.doGenerate({
        prompt: [
          userPrompt,
          {
            role: "assistant",
            content: [{
              type: "tool-call",
              toolCallId: "call_1",
              toolName: "weather",
              input: { city: "Tokyo" },
            }],
          },
          {
            role: "tool",
            content: [{
              type: "tool-result",
              toolCallId: "call_1",
              toolName: "weather",
              output: { type: "json", value: { temp: 25 } },
            }],
          },
        ],
      });
      const body = getBody() as { input: Array<Record<string, unknown>> } | null;
      const functionCallOutput = body!.input.find((item) =>
        (item as { type?: string }).type === "function_call_output"
      );
      assertEquals(functionCallOutput, {
        type: "function_call_output",
        call_id: "call_1",
        output: '{"temp":25}',
      });
    });
  });
});
