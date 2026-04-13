import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createAnthropicModelRuntime } from "./runtime-loader.ts";
import {
  createGoogleEmbeddingRuntime,
  createGoogleModelRuntime,
  createOpenAIEmbeddingRuntime,
} from "./runtime-loader.ts";
import { createOpenAIModelRuntime } from "./runtime-loader.ts";

async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}

function readRequestBody(init: RequestInit | undefined): string | null {
  if (!init || !("body" in init) || typeof init.body !== "string") {
    return null;
  }
  return init.body;
}

function readRequestHeader(init: RequestInit | undefined, name: string): string | null {
  if (!init || !("headers" in init)) {
    return null;
  }
  return new Headers(init.headers).get(name);
}

describe("provider/runtime-loader", () => {
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
        max_tokens: 50,
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
      },
    });
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

  it("creates an Anthropic-compatible language runtime without SDK helpers for generate", async () => {
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;

    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: (input, init) => {
        requestedUrl = String(input);
        requestedInit = init;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              content: [{
                type: "tool_use",
                id: "tool_weather",
                name: "weather",
                input: { city: "Tokyo" },
              }],
              stop_reason: "tool_use",
              usage: {
                input_tokens: 8,
                output_tokens: 2,
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      },
    }, "claude-sonnet-4-20250514");

    const result = await runtime.doGenerate({
      prompt: [{
        role: "user",
        content: [{ type: "text", text: "Check weather" }],
      }],
      tools: [{
        type: "function",
        name: "weather",
        description: "Get weather",
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
      maxOutputTokens: 64,
      temperature: 0.1,
      stopSequences: ["END"],
      headers: { "x-extra-header": "kept" },
    });

    assertEquals(requestedUrl, "https://example.anthropic.test/v1/messages");
    assertEquals(requestedInit?.method, "POST");
    assertEquals(new Headers(requestedInit?.headers).get("x-api-key"), "test-anthropic-key");
    assertEquals(new Headers(requestedInit?.headers).get("anthropic-version"), "2023-06-01");
    assertEquals(new Headers(requestedInit?.headers).get("x-extra-header"), "kept");
    const requestBody = typeof requestedInit?.body === "string"
      ? JSON.parse(requestedInit.body)
      : undefined;
    assertEquals(requestBody, {
      model: "claude-sonnet-4-20250514",
      messages: [{
        role: "user",
        content: [{ type: "text", text: "Check weather" }],
      }],
      max_tokens: 64,
      temperature: 0.1,
      stop_sequences: ["END"],
      tools: [{
        name: "weather",
        description: "Get weather",
        input_schema: {
          type: "object",
          properties: {
            city: { type: "string" },
          },
          required: ["city"],
          additionalProperties: false,
        },
      }],
      tool_choice: { type: "auto" },
    });
    assertEquals(result, {
      content: [{
        type: "tool-call",
        toolCallId: "tool_weather",
        toolName: "weather",
        input: '{"city":"Tokyo"}',
      }],
      finishReason: { unified: "tool-calls", raw: "tool_use" },
      usage: {
        inputTokens: 8,
        outputTokens: 2,
        totalTokens: 10,
      },
    });
  });

  it("creates an Anthropic-compatible language runtime without SDK helpers for stream", async () => {
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;
    const encoder = new TextEncoder();

    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: (input, init) => {
        requestedUrl = String(input);
        requestedInit = init;
        return Promise.resolve(
          new Response(
            ReadableStream.from([
              encoder.encode(
                'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":8}}}\n\n',
              ),
              encoder.encode(
                'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"server_tool_use","id":"srvtool_web_1","name":"web_search"}}\n\n',
              ),
              encoder.encode(
                'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"query\\":\\"Veryfront\\"}"}}\n\n',
              ),
              encoder.encode(
                'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
              ),
              encoder.encode(
                'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"web_search_tool_result","tool_use_id":"srvtool_web_1","content":[{"type":"web_search_result","url":"https://veryfront.com","title":"Veryfront","pageAge":null,"encryptedContent":"opaque"}]}}\n\n',
              ),
              encoder.encode(
                'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
              ),
              encoder.encode(
                'event: message_stop\ndata: {"type":"message_stop"}\n\n',
              ),
            ]),
            {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            },
          ),
        );
      },
    }, "claude-sonnet-4-20250514");

    const result = await runtime.doStream({
      prompt: [{
        role: "user",
        content: [{ type: "text", text: "Research Veryfront" }],
      }],
      tools: [{
        type: "provider",
        name: "web_search",
        id: "anthropic.web_search_20250305",
        args: {
          maxUses: 5,
        },
      }],
      maxOutputTokens: 64,
    });

    assertEquals(requestedUrl, "https://example.anthropic.test/v1/messages");
    assertEquals(requestedInit?.method, "POST");
    const requestBody = typeof requestedInit?.body === "string"
      ? JSON.parse(requestedInit.body)
      : undefined;
    assertEquals(requestBody, {
      model: "claude-sonnet-4-20250514",
      messages: [{
        role: "user",
        content: [{ type: "text", text: "Research Veryfront" }],
      }],
      max_tokens: 64,
      stream: true,
      tools: [{
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 5,
      }],
    });

    const parts = await collectAsync(result.stream);
    assertEquals(parts, [
      {
        type: "tool-input-start",
        id: "srvtool_web_1",
        toolName: "web_search",
        providerExecuted: true,
      },
      {
        type: "tool-input-delta",
        id: "srvtool_web_1",
        delta: '{"query":"Veryfront"}',
      },
      {
        type: "tool-call",
        toolCallId: "srvtool_web_1",
        toolName: "web_search",
        input: '{"query":"Veryfront"}',
        providerExecuted: true,
      },
      {
        type: "tool-result",
        toolCallId: "srvtool_web_1",
        toolName: "web_search",
        result: [{
          type: "web_search_result",
          url: "https://veryfront.com",
          title: "Veryfront",
          pageAge: null,
          encryptedContent: "opaque",
        }],
        providerExecuted: true,
      },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "end_turn" },
        usage: {
          inputTokens: 8,
          outputTokens: 5,
          totalTokens: 13,
        },
      },
    ]);
  });

  it("creates an Anthropic-compatible language runtime for provider-native web_fetch generate", async () => {
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;

    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: (input, init) => {
        requestedUrl = String(input);
        requestedInit = init;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              content: [{
                type: "server_tool_use",
                id: "srvtool_fetch_1",
                name: "web_fetch",
                input: { url: "https://veryfront.com/docs" },
              }, {
                type: "web_fetch_tool_result",
                tool_use_id: "srvtool_fetch_1",
                content: {
                  type: "web_fetch_result",
                  url: "https://veryfront.com/docs",
                  content: {
                    type: "document",
                    source: {
                      type: "text",
                      mediaType: "text/plain",
                      data: "Veryfront docs",
                    },
                    title: "Docs",
                  },
                  retrievedAt: "2026-04-11T10:00:00Z",
                },
              }],
              stop_reason: "end_turn",
              usage: {
                input_tokens: 12,
                output_tokens: 7,
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      },
    }, "claude-sonnet-4-20250514");

    const result = await runtime.doGenerate({
      prompt: [{
        role: "user",
        content: [{ type: "text", text: "Fetch the docs page" }],
      }],
      tools: [{
        type: "provider",
        name: "web_fetch",
        id: "anthropic.web_fetch_20250910",
        args: {},
      }],
      maxOutputTokens: 64,
    });

    assertEquals(requestedUrl, "https://example.anthropic.test/v1/messages");
    const requestBody = typeof requestedInit?.body === "string"
      ? JSON.parse(requestedInit.body)
      : undefined;
    assertEquals(requestBody, {
      model: "claude-sonnet-4-20250514",
      messages: [{
        role: "user",
        content: [{ type: "text", text: "Fetch the docs page" }],
      }],
      max_tokens: 64,
      tools: [{
        type: "web_fetch_20250910",
        name: "web_fetch",
      }],
    });
    assertEquals(result, {
      content: [{
        type: "tool-call",
        toolCallId: "srvtool_fetch_1",
        toolName: "web_fetch",
        input: '{"url":"https://veryfront.com/docs"}',
      }, {
        type: "tool-result",
        toolCallId: "srvtool_fetch_1",
        toolName: "web_fetch",
        result: {
          type: "web_fetch_result",
          url: "https://veryfront.com/docs",
          content: {
            type: "document",
            source: {
              type: "text",
              mediaType: "text/plain",
              data: "Veryfront docs",
            },
            title: "Docs",
          },
          retrievedAt: "2026-04-11T10:00:00Z",
        },
      }],
      finishReason: { unified: "stop", raw: "end_turn" },
      usage: {
        inputTokens: 12,
        outputTokens: 7,
        totalTokens: 19,
      },
    });
  });

  it("creates an Anthropic-compatible language runtime for provider-native web_fetch stream", async () => {
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;
    const encoder = new TextEncoder();

    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: (input, init) => {
        requestedUrl = String(input);
        requestedInit = init;
        return Promise.resolve(
          new Response(
            ReadableStream.from([
              encoder.encode(
                'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n',
              ),
              encoder.encode(
                'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"server_tool_use","id":"srvtool_fetch_2","name":"web_fetch"}}\n\n',
              ),
              encoder.encode(
                'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"url\\":\\"https://veryfront.com/docs\\"}"}}\n\n',
              ),
              encoder.encode(
                'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
              ),
              encoder.encode(
                'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"web_fetch_tool_result","tool_use_id":"srvtool_fetch_2","content":{"type":"web_fetch_result","url":"https://veryfront.com/docs","content":{"type":"document","source":{"type":"text","mediaType":"text/plain","data":"Veryfront docs"}},"retrievedAt":"2026-04-11T10:05:00Z"}}}\n\n',
              ),
              encoder.encode(
                'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}\n\n',
              ),
              encoder.encode(
                'event: message_stop\ndata: {"type":"message_stop"}\n\n',
              ),
            ]),
            {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            },
          ),
        );
      },
    }, "claude-sonnet-4-20250514");

    const result = await runtime.doStream({
      prompt: [{
        role: "user",
        content: [{ type: "text", text: "Fetch the docs page" }],
      }],
      tools: [{
        type: "provider",
        name: "web_fetch",
        id: "anthropic.web_fetch_20250910",
        args: {},
      }],
      maxOutputTokens: 64,
    });

    assertEquals(requestedUrl, "https://example.anthropic.test/v1/messages");
    const requestBody = typeof requestedInit?.body === "string"
      ? JSON.parse(requestedInit.body)
      : undefined;
    assertEquals(requestBody, {
      model: "claude-sonnet-4-20250514",
      messages: [{
        role: "user",
        content: [{ type: "text", text: "Fetch the docs page" }],
      }],
      max_tokens: 64,
      stream: true,
      tools: [{
        type: "web_fetch_20250910",
        name: "web_fetch",
      }],
    });

    const parts = await collectAsync(result.stream);
    assertEquals(parts.length, 5);
    assertEquals(parts[0], {
      type: "tool-input-start",
      id: "srvtool_fetch_2",
      toolName: "web_fetch",
      providerExecuted: true,
    });
    assertEquals(parts[1], {
      type: "tool-input-delta",
      id: "srvtool_fetch_2",
      delta: '{"url":"https://veryfront.com/docs"}',
    });
    assertEquals(parts[2], {
      type: "tool-call",
      toolCallId: "srvtool_fetch_2",
      toolName: "web_fetch",
      input: '{"url":"https://veryfront.com/docs"}',
      providerExecuted: true,
    });
    assertEquals(parts[3], {
      type: "tool-result",
      toolCallId: "srvtool_fetch_2",
      toolName: "web_fetch",
      result: {
        type: "web_fetch_result",
        url: "https://veryfront.com/docs",
        content: {
          type: "document",
          source: {
            type: "text",
            mediaType: "text/plain",
            data: "Veryfront docs",
          },
        },
        retrievedAt: "2026-04-11T10:05:00Z",
      },
      providerExecuted: true,
    });
    assertEquals(parts[4], {
      type: "finish",
      finishReason: { unified: "stop", raw: "end_turn" },
      usage: {
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
      },
    });
  });

  it("parses Anthropic-compatible SSE streams when events use CRLF delimiters", async () => {
    const encoder = new TextEncoder();
    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: () =>
        Promise.resolve(
          new Response(
            ReadableStream.from([
              encoder.encode(
                'event: message_start\r\ndata: {"type":"message_start","message":{"usage":{"input_tokens":8}}}\r\n\r\n',
              ),
              encoder.encode(
                'event: content_block_delta\r\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\r\n\r\n',
              ),
              encoder.encode(
                'event: message_delta\r\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\r\n\r\n',
              ),
              encoder.encode(
                'event: message_stop\r\ndata: {"type":"message_stop"}\r\n\r\n',
              ),
            ]),
            {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            },
          ),
        ),
    }, "claude-sonnet-4-20250514");

    const result = await runtime.doStream({
      prompt: [{
        role: "user",
        content: [{ type: "text", text: "Say hello" }],
      }],
      maxOutputTokens: 64,
    });

    const parts = await collectAsync(result.stream);
    assertEquals(parts, [
      {
        type: "text-delta",
        delta: "Hello",
      },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "end_turn" },
        usage: {
          inputTokens: 8,
          outputTokens: 5,
          totalTokens: 13,
        },
      },
    ]);
  });

  it("parses Anthropic extended thinking stream events into reasoning parts", async () => {
    const encoder = new TextEncoder();
    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: () =>
        Promise.resolve(
          new Response(
            ReadableStream.from([
              encoder.encode(
                'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":12}}}\n\n',
              ),
              encoder.encode(
                'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n',
              ),
              encoder.encode(
                'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Let me think."}}\n\n',
              ),
              encoder.encode(
                'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig_123"}}\n\n',
              ),
              encoder.encode(
                'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
              ),
              encoder.encode(
                'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":6}}\n\n',
              ),
              encoder.encode(
                'event: message_stop\ndata: {"type":"message_stop"}\n\n',
              ),
            ]),
            {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            },
          ),
        ),
    }, "claude-sonnet-4-20250514");

    const result = await runtime.doStream({
      prompt: [{
        role: "user",
        content: [{ type: "text", text: "Think before answering" }],
      }],
      maxOutputTokens: 64,
    });

    const parts = await collectAsync(result.stream);
    assertEquals(parts, [
      {
        type: "reasoning-start",
        id: "thinking-0",
      },
      {
        type: "reasoning-delta",
        id: "thinking-0",
        delta: "Let me think.",
      },
      {
        type: "reasoning-end",
        id: "thinking-0",
      },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "end_turn" },
        usage: {
          inputTokens: 12,
          outputTokens: 6,
          totalTokens: 18,
        },
      },
    ]);
  });

  it("keeps Anthropic providerOptions scoped to the active provider and alias", async () => {
    let requestedInit: RequestInit | undefined;

    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      name: "custom-anthropic",
      fetch: (_input, init) => {
        requestedInit = init;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              content: [{ type: "text", text: "done" }],
              stop_reason: "end_turn",
              usage: {
                input_tokens: 4,
                output_tokens: 1,
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      },
    }, "claude-sonnet-4-20250514");

    await runtime.doGenerate({
      prompt: [{
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      }],
      providerOptions: {
        anthropic: { top_k: 3 },
        openai: { parallel_tool_calls: false },
        "custom-anthropic": { metadata: { trace: "yes" } },
      },
    });

    const requestBody = typeof requestedInit?.body === "string"
      ? JSON.parse(requestedInit.body)
      : undefined;
    assertEquals(requestBody?.top_k, 3);
    assertEquals(requestBody?.metadata, { trace: "yes" });
    assertEquals("parallel_tool_calls" in (requestBody ?? {}), false);
  });

  it("creates a Google-compatible language runtime without SDK helpers for generate", async () => {
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;

    const runtime = createGoogleModelRuntime({
      apiKey: "test-google-key",
      baseURL: "https://example.google.test/v1beta",
      fetch: (input, init) => {
        requestedUrl = String(input);
        requestedInit = init;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              candidates: [{
                content: {
                  role: "model",
                  parts: [{
                    functionCall: {
                      id: "tool_weather",
                      name: "weather",
                      args: { city: "Tokyo" },
                    },
                  }],
                },
                finishReason: "STOP",
              }],
              usageMetadata: {
                promptTokenCount: 8,
                candidatesTokenCount: 2,
                totalTokenCount: 10,
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      },
    }, "gemini-2.0-flash");

    const result = await runtime.doGenerate({
      prompt: [{
        role: "user",
        content: [{ type: "text", text: "Check weather" }],
      }],
      tools: [{
        type: "function",
        name: "weather",
        description: "Get weather",
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
      maxOutputTokens: 64,
      temperature: 0.1,
      stopSequences: ["END"],
      headers: { "x-extra-header": "kept" },
    });

    assertEquals(
      requestedUrl,
      "https://example.google.test/v1beta/models/gemini-2.0-flash:generateContent",
    );
    assertEquals(requestedInit?.method, "POST");
    assertEquals(new Headers(requestedInit?.headers).get("x-goog-api-key"), "test-google-key");
    assertEquals(new Headers(requestedInit?.headers).get("x-extra-header"), "kept");
    const requestBody = typeof requestedInit?.body === "string"
      ? JSON.parse(requestedInit.body)
      : undefined;
    assertEquals(requestBody, {
      contents: [{
        role: "user",
        parts: [{ text: "Check weather" }],
      }],
      tools: [{
        functionDeclarations: [{
          name: "weather",
          description: "Get weather",
          parameters: {
            type: "object",
            properties: {
              city: { type: "string" },
            },
            required: ["city"],
            additionalProperties: false,
          },
        }],
      }],
      toolConfig: {
        functionCallingConfig: {
          mode: "AUTO",
        },
      },
      generationConfig: {
        maxOutputTokens: 64,
        temperature: 0.1,
        stopSequences: ["END"],
      },
    });
    assertEquals(result, {
      content: [{
        type: "tool-call",
        toolCallId: "tool_weather",
        toolName: "weather",
        input: '{"city":"Tokyo"}',
      }],
      finishReason: { unified: "stop", raw: "STOP" },
      usage: {
        inputTokens: 8,
        outputTokens: 2,
        totalTokens: 10,
      },
    });
  });

  it("creates a Google-compatible language runtime without SDK helpers for stream", async () => {
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;
    const encoder = new TextEncoder();

    const runtime = createGoogleModelRuntime({
      apiKey: "test-google-key",
      baseURL: "https://example.google.test/v1beta",
      fetch: (input, init) => {
        requestedUrl = String(input);
        requestedInit = init;
        return Promise.resolve(
          new Response(
            ReadableStream.from([
              encoder.encode(
                'data: {"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"id":"tool_weather","name":"weather","args":{"city":"Tokyo"}}}]}}]}\n\n',
              ),
              encoder.encode(
                'data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":8,"candidatesTokenCount":2,"totalTokenCount":10}}\n\n',
              ),
              encoder.encode("data: [DONE]\n\n"),
            ]),
            {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            },
          ),
        );
      },
    }, "gemini-2.0-flash");

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
      maxOutputTokens: 64,
    });

    assertEquals(
      requestedUrl,
      "https://example.google.test/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse",
    );
    assertEquals(requestedInit?.method, "POST");
    const requestBody = typeof requestedInit?.body === "string"
      ? JSON.parse(requestedInit.body)
      : undefined;
    assertEquals(requestBody, {
      contents: [{
        role: "user",
        parts: [{ text: "Check weather" }],
      }],
      tools: [{
        functionDeclarations: [{
          name: "weather",
          parameters: {
            type: "object",
            properties: {
              city: { type: "string" },
            },
          },
        }],
      }],
      generationConfig: {
        maxOutputTokens: 64,
      },
    });

    const parts = await collectAsync(result.stream);
    assertEquals(parts, [
      {
        type: "tool-input-start",
        id: "tool_weather",
        toolName: "weather",
      },
      {
        type: "tool-input-delta",
        id: "tool_weather",
        delta: '{"city":"Tokyo"}',
      },
      {
        type: "tool-call",
        toolCallId: "tool_weather",
        toolName: "weather",
        input: '{"city":"Tokyo"}',
      },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "STOP" },
        usage: {
          inputTokens: 8,
          outputTokens: 2,
          totalTokens: 10,
        },
      },
    ]);
  });

  it("parses Google thought parts into reasoning events", async () => {
    const encoder = new TextEncoder();

    const runtime = createGoogleModelRuntime({
      apiKey: "test-google-key",
      baseURL: "https://example.google.test/v1beta",
      fetch: () =>
        Promise.resolve(
          new Response(
            ReadableStream.from([
              encoder.encode(
                'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Let me think.","thought":true}]}}]}\n\n',
              ),
              encoder.encode(
                'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Done."}]}}]}\n\n',
              ),
              encoder.encode(
                'data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":8,"candidatesTokenCount":2,"totalTokenCount":10}}\n\n',
              ),
              encoder.encode("data: [DONE]\n\n"),
            ]),
            {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            },
          ),
        ),
    }, "gemini-2.0-flash");

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
        finishReason: { unified: "stop", raw: "STOP" },
        usage: {
          inputTokens: 8,
          outputTokens: 2,
          totalTokens: 10,
        },
      },
    ]);
  });

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

  it("creates a Google embedding runtime without SDK helpers", async () => {
    const requests: Array<{ url: string; body: string | null; apiKey: string | null }> = [];

    const runtime = createGoogleEmbeddingRuntime({
      apiKey: "test-google-key",
      baseURL: "https://example.google.test/v1beta",
      fetch: (input, init) => {
        requests.push({
          url: String(input),
          body: readRequestBody(init),
          apiKey: readRequestHeader(init, "x-goog-api-key"),
        });

        const body = requests.length === 1
          ? {
            embeddings: [{ values: [10, 20] }],
            usageMetadata: { promptTokenCount: 3 },
          }
          : {
            embeddings: [{ values: [30, 40] }],
            usageMetadata: { promptTokenCount: 5 },
          };

        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      },
    }, "text-embedding-004");

    const result = await runtime.doEmbed({ values: ["alpha", "beta"] });

    assertEquals(requests, [
      {
        url: "https://example.google.test/v1beta/models/text-embedding-004:embedContent",
        body: JSON.stringify({
          content: { parts: [{ text: "alpha" }] },
        }),
        apiKey: "test-google-key",
      },
      {
        url: "https://example.google.test/v1beta/models/text-embedding-004:embedContent",
        body: JSON.stringify({
          content: { parts: [{ text: "beta" }] },
        }),
        apiKey: "test-google-key",
      },
    ]);
    assertEquals(result.embeddings, [[10, 20], [30, 40]]);
    assertEquals(result.usage, { tokens: 8 });
  });
});
