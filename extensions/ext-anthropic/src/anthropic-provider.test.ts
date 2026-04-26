import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { createRuntimeJsonSchema } from "../../../src/agent/runtime/runtime-tool-builder.ts";

import { createAnthropicModelRuntime } from "./anthropic-provider.ts";

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

// ---------------------------------------------------------------------------
// Anthropic provider — core generate / stream / SSE
// ---------------------------------------------------------------------------

describe("anthropic-provider", () => {
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

  it("unwraps runtime tool schemas before sending Anthropic tool definitions", async () => {
    let requestedInit: RequestInit | undefined;

    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: (_input, init) => {
        requestedInit = init;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              content: [],
              stop_reason: "end_turn",
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

    await runtime.doGenerate({
      prompt: [{
        role: "user",
        content: [{ type: "text", text: "Write a file" }],
      }],
      tools: [{
        type: "function",
        name: "create_file",
        description: "Create a project file",
        inputSchema: createRuntimeJsonSchema({
          type: "object",
          properties: {
            project_reference: { type: "string" },
            path: { type: "string" },
            content: { type: "string" },
          },
          required: ["project_reference", "path", "content"],
          additionalProperties: false,
        }),
      }],
      toolChoice: "auto",
      maxOutputTokens: 64,
    });

    const requestBody = typeof requestedInit?.body === "string"
      ? JSON.parse(requestedInit.body)
      : undefined;

    assertEquals(requestBody?.tools, [{
      name: "create_file",
      description: "Create a project file",
      input_schema: {
        type: "object",
        properties: {
          project_reference: { type: "string" },
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["project_reference", "path", "content"],
        additionalProperties: false,
      },
    }]);
  });

  it("merges tool-result replay with consecutive user retries into one Anthropic user message", async () => {
    let requestedInit: RequestInit | undefined;

    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: (_input, init) => {
        requestedInit = init;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              content: [{ type: "text", text: "done" }],
              stop_reason: "end_turn",
              usage: {
                input_tokens: 6,
                output_tokens: 1,
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      },
    }, "claude-sonnet-4-20250514");

    await runtime.doGenerate({
      prompt: [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "toolu_1",
              toolName: "get_project",
              input: { project_reference: "project-1" },
            },
            {
              type: "text",
              text: "The project slug is `my-project`.",
            },
          ],
        },
        {
          role: "tool",
          content: [{
            type: "tool-result",
            toolCallId: "toolu_1",
            toolName: "get_project",
            output: {
              type: "json",
              value: { slug: "my-project" },
            },
          }],
        },
        {
          role: "user",
          content: [{ type: "text", text: "What is the project slug now?" }],
        },
        {
          role: "user",
          content: [{ type: "text", text: "Reply with only the project slug." }],
        },
      ],
      maxOutputTokens: 32,
    });

    const requestBody = typeof requestedInit?.body === "string"
      ? JSON.parse(requestedInit.body)
      : undefined;

    assertEquals(requestBody?.messages, [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "get_project",
            input: { project_reference: "project-1" },
          },
          {
            type: "text",
            text: "The project slug is `my-project`.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_1",
            content: '{"slug":"my-project"}',
          },
          {
            type: "text",
            text: "What is the project slug now?",
          },
          {
            type: "text",
            text: "Reply with only the project slug.",
          },
        ],
      },
    ]);
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
    assertEquals(
      readRequestHeader(requestedInit, "anthropic-beta"),
      "fine-grained-tool-streaming-2025-05-14",
    );
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
        type: "data-tool-call-status",
        data: {
          toolCallId: "srvtool_web_1",
          status: "streaming_input",
        },
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
    assertEquals(parts.length, 6);
    assertEquals(parts[0], {
      type: "tool-input-start",
      id: "srvtool_fetch_2",
      toolName: "web_fetch",
      providerExecuted: true,
    });
    assertEquals(parts[1], {
      type: "data-tool-call-status",
      data: { toolCallId: "srvtool_fetch_2", status: "streaming_input" },
    });
    assertEquals(parts[2], {
      type: "tool-input-delta",
      id: "srvtool_fetch_2",
      delta: '{"url":"https://veryfront.com/docs"}',
    });
    assertEquals(parts[3], {
      type: "tool-call",
      toolCallId: "srvtool_fetch_2",
      toolName: "web_fetch",
      input: '{"url":"https://veryfront.com/docs"}',
      providerExecuted: true,
    });
    assertEquals(parts[4], {
      type: "tool-result",
      toolCallId: "srvtool_fetch_2",
      toolName: "web_fetch",
      result: {
        type: "web_fetch_result",
        url: "https://veryfront.com/docs",
        content: {
          type: "document",
          source: { type: "text", mediaType: "text/plain", data: "Veryfront docs" },
        },
        retrievedAt: "2026-04-11T10:05:00Z",
      },
      providerExecuted: true,
    });
    assertEquals(parts[5], {
      type: "finish",
      finishReason: { unified: "stop", raw: "end_turn" },
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
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

  it("keeps Anthropic streamed reasoning scoped to its content block index", async () => {
    const encoder = new TextEncoder();
    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: () =>
        Promise.resolve(
          new Response(
            ReadableStream.from([
              encoder.encode(
                'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n',
              ),
              encoder.encode(
                'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"First thought."}}\n\n',
              ),
              encoder.encode(
                'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"thinking","thinking":""}}\n\n',
              ),
              encoder.encode(
                'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"thinking_delta","thinking":"Second thought."}}\n\n',
              ),
              encoder.encode(
                'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
              ),
              encoder.encode(
                'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
              ),
              encoder.encode(
                'event: content_block_start\ndata: {"type":"content_block_start","index":2,"content_block":{"type":"text","text":"Done."}}\n\n',
              ),
              encoder.encode(
                'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":8,"output_tokens":2}}\n\n',
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
        content: [{ type: "text", text: "Think twice before answering" }],
      }],
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
        delta: "First thought.",
      },
      {
        type: "reasoning-start",
        id: "thinking-1",
      },
      {
        type: "reasoning-delta",
        id: "thinking-1",
        delta: "Second thought.",
      },
      {
        type: "reasoning-end",
        id: "thinking-0",
      },
      {
        type: "reasoning-end",
        id: "thinking-1",
      },
      {
        type: "text-delta",
        delta: "Done.",
      },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "end_turn" },
        usage: {
          inputTokens: 8,
          outputTokens: 2,
          totalTokens: 10,
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

  // ---------------------------------------------------------------------------
  // Anthropic max_tokens model-aware defaults
  // ---------------------------------------------------------------------------

  describe("Anthropic max_tokens model-aware defaults", () => {
    // Minimal fetch stub that captures the outbound request body and returns
    // a trivial generate-mode response, so each test can assert what max_tokens
    // ends up on the wire without wiring the full streaming path.
    function createCapturingRuntime(modelId: string) {
      let capturedBody: Record<string, unknown> | null = null;
      const runtime = createAnthropicModelRuntime({
        apiKey: "test-anthropic-key",
        baseURL: "https://example.anthropic.test/v1",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          capturedBody = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                content: [{ type: "text", text: "ok" }],
                stop_reason: "end_turn",
                usage: { input_tokens: 1, output_tokens: 1 },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        },
      }, modelId);
      return {
        runtime,
        getBody: () => capturedBody,
      };
    }

    async function generateWith(modelId: string, maxOutputTokens?: number) {
      const { runtime, getBody } = createCapturingRuntime(modelId);
      await runtime.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      });
      return getBody();
    }

    it("defaults Opus 4.6 to 128k when caller omits maxOutputTokens", async () => {
      const body = await generateWith("claude-opus-4-6");
      assertEquals((body as { max_tokens: number }).max_tokens, 128_000);
    });

    it("defaults Sonnet 4.6 to 128k when caller omits maxOutputTokens", async () => {
      const body = await generateWith("claude-sonnet-4-6");
      assertEquals((body as { max_tokens: number }).max_tokens, 128_000);
    });

    it("defaults Sonnet/Opus/Haiku 4.5 to 64k when caller omits maxOutputTokens", async () => {
      for (const modelId of ["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"]) {
        const body = await generateWith(modelId);
        assertEquals(
          (body as { max_tokens: number }).max_tokens,
          64_000,
          `expected 64k for ${modelId}`,
        );
      }
    });

    it("clamps caller-provided maxOutputTokens at the model ceiling for known models", async () => {
      const body = await generateWith("claude-sonnet-4-6", 999_999);
      assertEquals((body as { max_tokens: number }).max_tokens, 128_000);
    });

    it("passes through maxOutputTokens unchanged for unknown models", async () => {
      const body = await generateWith("some-future-model", 64_000);
      assertEquals((body as { max_tokens: number }).max_tokens, 64_000);
    });
  });

  // ---------------------------------------------------------------------------
  // Anthropic prompt caching (cache_control breakpoints)
  // ---------------------------------------------------------------------------

  describe("Anthropic prompt caching (cache_control breakpoints)", () => {
    // Captures the outbound body for a single Anthropic generate call with a
    // caller-provided cacheControl option. Returns the parsed body so each test
    // can assert what landed on the wire.
    function createCachingCaptureRuntime() {
      let capturedBody: Record<string, unknown> | null = null;
      const runtime = createAnthropicModelRuntime({
        apiKey: "test-anthropic-key",
        baseURL: "https://example.anthropic.test/v1",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          capturedBody = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                content: [{ type: "text", text: "ok" }],
                stop_reason: "end_turn",
                usage: { input_tokens: 1, output_tokens: 1 },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        },
      }, "claude-sonnet-4-20250514");
      return {
        runtime,
        getBody: () => capturedBody,
      };
    }

    const systemPrompt = {
      role: "system",
      content: "You are a helpful assistant.",
    } as const;
    const userPrompt = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
    } as const;

    const weatherTool = {
      type: "function" as const,
      name: "weather",
      description: "Get weather",
      inputSchema: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
        additionalProperties: false,
      },
    };
    const searchTool = {
      type: "function" as const,
      name: "search",
      description: "Search the web",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
    };

    it("defaults system to string form when cacheControl is not set", async () => {
      const { runtime, getBody } = createCachingCaptureRuntime();
      await runtime.doGenerate({
        prompt: [systemPrompt, userPrompt],
      });
      const body = getBody() as { system: unknown };
      // Backward-compat path: without a breakpoint, system stays as a raw string.
      assertEquals(body.system, "You are a helpful assistant.");
    });

    it("emits cache_control on the system block when cacheControl.system is true", async () => {
      const { runtime, getBody } = createCachingCaptureRuntime();
      await runtime.doGenerate({
        prompt: [systemPrompt, userPrompt],
        cacheControl: { system: true },
      });
      const body = getBody() as { system: Array<Record<string, unknown>> };
      assertEquals(body.system, [{
        type: "text",
        text: "You are a helpful assistant.",
        cache_control: { type: "ephemeral" },
      }]);
    });

    it('emits cache_control with 1h TTL when cacheControl.system is "1h"', async () => {
      const { runtime, getBody } = createCachingCaptureRuntime();
      await runtime.doGenerate({
        prompt: [systemPrompt, userPrompt],
        cacheControl: { system: "1h" },
      });
      const body = getBody() as { system: Array<Record<string, unknown>> };
      assertEquals(body.system, [{
        type: "text",
        text: "You are a helpful assistant.",
        cache_control: { type: "ephemeral", ttl: "1h" },
      }]);
    });

    it("emits cache_control on the LAST tool entry when cacheControl.tools is true", async () => {
      const { runtime, getBody } = createCachingCaptureRuntime();
      await runtime.doGenerate({
        prompt: [systemPrompt, userPrompt],
        tools: [weatherTool, searchTool],
        cacheControl: { tools: true },
      });
      const body = getBody() as { tools: Array<Record<string, unknown>> };
      assertEquals(body.tools.length, 2);
      // First tool is unmodified
      assertEquals(body.tools[0], {
        name: "weather",
        description: "Get weather",
        input_schema: weatherTool.inputSchema,
      });
      // Last tool carries the breakpoint
      assertEquals(body.tools[1], {
        name: "search",
        description: "Search the web",
        input_schema: searchTool.inputSchema,
        cache_control: { type: "ephemeral" },
      });
    });

    it("emits both system and tools breakpoints when both are set", async () => {
      const { runtime, getBody } = createCachingCaptureRuntime();
      await runtime.doGenerate({
        prompt: [systemPrompt, userPrompt],
        tools: [weatherTool],
        cacheControl: { system: true, tools: "1h" },
      });
      const body = getBody() as {
        system: Array<Record<string, unknown>>;
        tools: Array<Record<string, unknown>>;
      };
      assertEquals(body.system, [{
        type: "text",
        text: "You are a helpful assistant.",
        cache_control: { type: "ephemeral" },
      }]);
      assertEquals(body.tools, [{
        name: "weather",
        description: "Get weather",
        input_schema: weatherTool.inputSchema,
        cache_control: { type: "ephemeral", ttl: "1h" },
      }]);
    });

    it("treats cacheControl.system === false as no-op (string form preserved)", async () => {
      const { runtime, getBody } = createCachingCaptureRuntime();
      await runtime.doGenerate({
        prompt: [systemPrompt, userPrompt],
        cacheControl: { system: false },
      });
      const body = getBody() as { system: unknown };
      assertEquals(body.system, "You are a helpful assistant.");
    });

    it("treats cacheControl.tools === false as no-op (no breakpoint attached)", async () => {
      const { runtime, getBody } = createCachingCaptureRuntime();
      await runtime.doGenerate({
        prompt: [systemPrompt, userPrompt],
        tools: [weatherTool],
        cacheControl: { tools: false },
      });
      const body = getBody() as { tools: Array<Record<string, unknown>> };
      assertEquals(body.tools, [{
        name: "weather",
        description: "Get weather",
        input_schema: weatherTool.inputSchema,
      }]);
    });

    it("does not crash when cacheControl is set but there's no system prompt", async () => {
      const { runtime, getBody } = createCachingCaptureRuntime();
      await runtime.doGenerate({
        prompt: [userPrompt],
        cacheControl: { system: true },
      });
      const body = getBody() as Record<string, unknown>;
      // No system field at all — nothing to attach the breakpoint to.
      assertEquals("system" in body, false);
    });

    it("does not crash when cacheControl.tools is set but there's no tools array", async () => {
      const { runtime, getBody } = createCachingCaptureRuntime();
      await runtime.doGenerate({
        prompt: [systemPrompt, userPrompt],
        cacheControl: { tools: true },
      });
      const body = getBody() as Record<string, unknown>;
      assertEquals("tools" in body, false);
    });
  });

  // ---------------------------------------------------------------------------
  // Anthropic provider tool version aliasing
  // ---------------------------------------------------------------------------

  describe("Anthropic provider tool version aliasing", () => {
    const userPrompt = {
      role: "user",
      content: [{ type: "text", text: "Run code" }],
    } as const;

    function captureBody() {
      let captured: Record<string, unknown> | null = null;
      const runtime = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          captured = raw ? JSON.parse(raw) : null;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                content: [{ type: "text", text: "ok" }],
                stop_reason: "end_turn",
                usage: { input_tokens: 1, output_tokens: 1 },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        },
      }, "claude-opus-4-6");
      return { runtime, getBody: () => captured };
    }

    function toolType(body: Record<string, unknown> | null): string | undefined {
      const tools = body?.tools as Array<{ type?: string }> | undefined;
      return tools?.[0]?.type;
    }

    const cases: Array<[string, string]> = [
      ["anthropic.code_execution", "code_execution_20260120"],
      ["anthropic.computer_use", "computer_20250124"],
      ["anthropic.computer", "computer_20250124"],
      ["anthropic.text_editor", "text_editor_20250728"],
      ["anthropic.bash", "bash_20250124"],
      ["anthropic.memory", "memory_20250818"],
      ["anthropic.web_search", "web_search_20250305"],
      ["anthropic.web_fetch", "web_fetch_20250910"],
    ];

    for (const [shortId, expected] of cases) {
      it(`maps ${shortId} -> ${expected}`, async () => {
        const { runtime, getBody } = captureBody();
        await runtime.doGenerate({
          prompt: [userPrompt],
          tools: [{
            type: "provider",
            name: "tool",
            id: shortId as `${string}.${string}`,
            args: {},
          }],
        });
        assertEquals(toolType(getBody()), expected);
      });
    }

    it("passes already-versioned types through verbatim", async () => {
      const { runtime, getBody } = captureBody();
      await runtime.doGenerate({
        prompt: [userPrompt],
        tools: [{
          type: "provider",
          name: "tool",
          id: "anthropic.code_execution_20250522",
          args: {},
        }],
      });
      assertEquals(toolType(getBody()), "code_execution_20250522");
    });

    it("leaves unknown short names unchanged", async () => {
      const { runtime, getBody } = captureBody();
      await runtime.doGenerate({
        prompt: [userPrompt],
        tools: [{
          type: "provider",
          name: "tool",
          id: "anthropic.future_tool",
          args: {},
        }],
      });
      assertEquals(toolType(getBody()), "future_tool");
    });
  });

  // ---------------------------------------------------------------------------
  // Anthropic native MCP server pass-through
  // ---------------------------------------------------------------------------

  describe("Anthropic native MCP server pass-through", () => {
    const userPrompt = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
    } as const;

    function captureRuntime() {
      let captured: Record<string, unknown> | null = null;
      const runtime = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          captured = raw ? JSON.parse(raw) : null;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                content: [{ type: "text", text: "ok" }],
                stop_reason: "end_turn",
                usage: { input_tokens: 1, output_tokens: 1 },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        },
      }, "claude-opus-4-6");
      return { runtime, getBody: () => captured };
    }

    it("emits mcp_servers on the body when set, with deep snake_case conversion", async () => {
      const { runtime, getBody } = captureRuntime();
      await runtime.doGenerate({
        prompt: [userPrompt],
        mcpServers: [{
          type: "url",
          url: "https://example.com/mcp",
          name: "example",
          authorizationToken: "Bearer abc",
          toolConfiguration: {
            enabled: true,
            allowedTools: ["search", "fetch"],
          },
        }],
      });
      const body = getBody() as { mcp_servers: Array<Record<string, unknown>> } | null;
      assertEquals(body?.mcp_servers, [{
        type: "url",
        url: "https://example.com/mcp",
        name: "example",
        authorization_token: "Bearer abc",
        tool_configuration: {
          enabled: true,
          allowed_tools: ["search", "fetch"],
        },
      }]);
    });

    it("omits mcp_servers when the option is empty or unset", async () => {
      const { runtime, getBody } = captureRuntime();
      await runtime.doGenerate({ prompt: [userPrompt], mcpServers: [] });
      assertEquals("mcp_servers" in (getBody() ?? {}), false);

      const second = captureRuntime();
      await second.runtime.doGenerate({ prompt: [userPrompt] });
      assertEquals("mcp_servers" in (second.getBody() ?? {}), false);
    });

    it("emits container field verbatim when anthropicContainer is set", async () => {
      const { runtime, getBody } = captureRuntime();
      await runtime.doGenerate({
        prompt: [userPrompt],
        anthropicContainer: { id: "ctr_42", type: "computer-use" },
      });
      const body = getBody() as { container: unknown } | null;
      assertEquals(body?.container, { id: "ctr_42", type: "computer-use" });
    });

    it("emits container as a bare string when anthropicContainer is a string", async () => {
      const { runtime, getBody } = captureRuntime();
      await runtime.doGenerate({
        prompt: [userPrompt],
        anthropicContainer: "ctr_42",
      });
      const body = getBody() as { container: string } | null;
      assertEquals(body?.container, "ctr_42");
    });

    it("omits container when anthropicContainer is unset", async () => {
      const { runtime, getBody } = captureRuntime();
      await runtime.doGenerate({ prompt: [userPrompt] });
      assertEquals("container" in (getBody() ?? {}), false);
    });
  });
});
