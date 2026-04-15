import { assertEquals } from "#veryfront/testing/assert.ts";
import { assertGreaterOrEqual } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createAnthropicModelRuntime,
  ProviderOverloadedError,
  ProviderQuotaError,
  ProviderRateLimitError,
  ProviderRequestError,
  withToolInputStatusTransitions,
} from "./runtime-loader.ts";
import { createRuntimeJsonSchema } from "../agent/runtime/runtime-tool-builder.ts";
import {
  createGoogleEmbeddingRuntime,
  createGoogleModelRuntime,
  createOpenAIEmbeddingRuntime,
} from "./runtime-loader.ts";
import { createOpenAIModelRuntime, createOpenAIResponsesRuntime } from "./runtime-loader.ts";

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
  it("emits pending_input and streaming_input transitions when tool input goes silent and resumes", async () => {
    const events = await collectAsync(withToolInputStatusTransitions({
      async *[Symbol.asyncIterator]() {
        yield { type: "tool-input-start", id: "tool-1", toolName: "create_file" };
        await new Promise((resolve) => setTimeout(resolve, 8));
        yield { type: "tool-input-delta", id: "tool-1", delta: '{"path":"docs/report.md"' };
        await new Promise((resolve) => setTimeout(resolve, 8));
        yield {
          type: "tool-call",
          toolCallId: "tool-1",
          toolName: "create_file",
          input: { path: "docs/report.md" },
        };
        yield { type: "finish", finishReason: "tool-calls" };
      },
    }, 5));

    assertEquals(events, [
      { type: "tool-input-start", id: "tool-1", toolName: "create_file" },
      {
        type: "data-tool-call-status",
        data: { toolCallId: "tool-1", status: "pending_input" },
      },
      {
        type: "data-tool-call-status",
        data: { toolCallId: "tool-1", status: "streaming_input" },
      },
      { type: "tool-input-delta", id: "tool-1", delta: '{"path":"docs/report.md"' },
      {
        type: "data-tool-call-status",
        data: { toolCallId: "tool-1", status: "pending_input" },
      },
      {
        type: "tool-call",
        toolCallId: "tool-1",
        toolName: "create_file",
        input: { path: "docs/report.md" },
      },
      { type: "finish", finishReason: "tool-calls" },
    ]);
  });

  it("does not fabricate pending_input for google-style immediate tool input", async () => {
    const events = await collectAsync(withToolInputStatusTransitions({
      async *[Symbol.asyncIterator]() {
        yield { type: "tool-input-start", id: "tool-1", toolName: "search" };
        yield { type: "tool-input-delta", id: "tool-1", delta: '{"query":"Veryfront"}' };
        yield {
          type: "tool-call",
          toolCallId: "tool-1",
          toolName: "search",
          input: { query: "Veryfront" },
        };
        yield { type: "finish", finishReason: "tool-calls" };
      },
    }, 5));

    assertEquals(events, [
      { type: "tool-input-start", id: "tool-1", toolName: "search" },
      {
        type: "data-tool-call-status",
        data: { toolCallId: "tool-1", status: "streaming_input" },
      },
      { type: "tool-input-delta", id: "tool-1", delta: '{"query":"Veryfront"}' },
      {
        type: "tool-call",
        toolCallId: "tool-1",
        toolName: "search",
        input: { query: "Veryfront" },
      },
      { type: "finish", finishReason: "tool-calls" },
    ]);
  });

  it("repeats pending_input heartbeats while create_file content stays silent after the path", async () => {
    const events = await collectAsync(withToolInputStatusTransitions({
      async *[Symbol.asyncIterator]() {
        yield { type: "tool-input-start", id: "tool-1", toolName: "create_file" };
        yield {
          type: "tool-input-delta",
          id: "tool-1",
          delta: '{"path":"plans/ai-ontologies-research.md"',
        };
        await new Promise((resolve) => setTimeout(resolve, 18));
        yield { type: "tool-input-delta", id: "tool-1", delta: ', "content":"# AI Ontologies"' };
        yield {
          type: "tool-call",
          toolCallId: "tool-1",
          toolName: "create_file",
          input: {
            path: "plans/ai-ontologies-research.md",
            content: "# AI Ontologies",
          },
        };
        yield { type: "finish", finishReason: "tool-calls" };
      },
    }, 5));

    const firstDeltaIndex = events.findIndex((event) =>
      event && typeof event === "object" && (event as { type?: string }).type === "tool-input-delta"
    );
    const secondDeltaIndex = events.findIndex((event, index) =>
      index > firstDeltaIndex &&
      event &&
      typeof event === "object" &&
      (event as { type?: string }).type === "tool-input-delta"
    );

    const pendingBetweenDeltas = events
      .slice(firstDeltaIndex + 1, secondDeltaIndex)
      .filter((event) =>
        event &&
        typeof event === "object" &&
        (event as { type?: string }).type === "data-tool-call-status" &&
        (event as { data?: { status?: string } }).data?.status === "pending_input"
      );

    assertGreaterOrEqual(
      pendingBetweenDeltas.length,
      2,
      "expected repeated pending_input heartbeats while create_file content stayed silent",
    );

    assertEquals(events[0], { type: "tool-input-start", id: "tool-1", toolName: "create_file" });
    assertEquals(events[1], {
      type: "data-tool-call-status",
      data: { toolCallId: "tool-1", status: "streaming_input" },
    });
    assertEquals(events[firstDeltaIndex], {
      type: "tool-input-delta",
      id: "tool-1",
      delta: '{"path":"plans/ai-ontologies-research.md"',
    });
    assertEquals(events[secondDeltaIndex - 1], {
      type: "data-tool-call-status",
      data: { toolCallId: "tool-1", status: "streaming_input" },
    });
    assertEquals(events[secondDeltaIndex], {
      type: "tool-input-delta",
      id: "tool-1",
      delta: ', "content":"# AI Ontologies"',
    });
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
        type: "data-tool-call-status",
        data: {
          toolCallId: "call_weather",
          status: "streaming_input",
        },
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
      data: {
        toolCallId: "srvtool_fetch_2",
        status: "streaming_input",
      },
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
    assertEquals(parts[5], {
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
        type: "data-tool-call-status",
        data: {
          toolCallId: "tool_weather",
          status: "streaming_input",
        },
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
      const sonnet = await generateWith("claude-sonnet-4-5");
      const opus = await generateWith("claude-opus-4-5");
      const haiku = await generateWith("claude-haiku-4-5");
      assertEquals((sonnet as { max_tokens: number }).max_tokens, 64_000);
      assertEquals((opus as { max_tokens: number }).max_tokens, 64_000);
      assertEquals((haiku as { max_tokens: number }).max_tokens, 64_000);
    });

    it("defaults Opus 4.1 to 32k when caller omits maxOutputTokens", async () => {
      const body = await generateWith("claude-opus-4-1");
      assertEquals((body as { max_tokens: number }).max_tokens, 32_000);
    });

    it("defaults unknown models to 4096 when caller omits maxOutputTokens", async () => {
      const body = await generateWith("some-future-model");
      assertEquals((body as { max_tokens: number }).max_tokens, 4096);
    });

    it("honours caller maxOutputTokens when under the model cap", async () => {
      const body = await generateWith("claude-opus-4-6", 8_000);
      assertEquals((body as { max_tokens: number }).max_tokens, 8_000);
    });

    it("caps caller maxOutputTokens at the model maximum for known models", async () => {
      // Opus 4.1 caps at 32k; asking for 64k should clamp down.
      const body = await generateWith("claude-opus-4-1", 64_000);
      assertEquals((body as { max_tokens: number }).max_tokens, 32_000);
    });

    it("does not cap caller values for unknown models (no model intel to trust)", async () => {
      const body = await generateWith("some-future-model", 64_000);
      assertEquals((body as { max_tokens: number }).max_tokens, 64_000);
    });
  });

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

  describe("reasoning / thinking request options", () => {
    const userPrompt = {
      role: "user",
      content: [{ type: "text", text: "Solve this" }],
    } as const;

    function createAnthropicCaptureRuntime(modelId = "claude-opus-4-6") {
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
      return { runtime, getBody: () => capturedBody };
    }

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

    function createGoogleCaptureRuntime(modelId = "gemini-2.5-pro") {
      let capturedBody: Record<string, unknown> | null = null;
      const runtime = createGoogleModelRuntime({
        apiKey: "test-google-key",
        baseURL: "https://example.google.test/v1beta",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          capturedBody = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                candidates: [{
                  content: { role: "model", parts: [{ text: "ok" }] },
                  finishReason: "STOP",
                }],
                usageMetadata: {
                  promptTokenCount: 1,
                  candidatesTokenCount: 1,
                  totalTokenCount: 2,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        },
      }, modelId);
      return { runtime, getBody: () => capturedBody };
    }

    it("emits Anthropic thinking block with medium effort budget by default", async () => {
      const { runtime, getBody } = createAnthropicCaptureRuntime();
      await runtime.doGenerate({
        prompt: [userPrompt],
        maxOutputTokens: 2048,
        reasoning: { enabled: true },
      });
      const body = getBody() as {
        thinking: { type: string; budget_tokens: number };
        max_tokens: number;
      };
      assertEquals(body.thinking, { type: "enabled", budget_tokens: 4096 });
      // max_tokens = baseMaxTokens(2048) + budget(4096) = 6144
      assertEquals(body.max_tokens, 6144);
    });

    it("maps Anthropic effort levels to budget_tokens", async () => {
      async function budgetFor(effort: "low" | "medium" | "high" | "max") {
        const { runtime, getBody } = createAnthropicCaptureRuntime();
        await runtime.doGenerate({
          prompt: [userPrompt],
          maxOutputTokens: 1024,
          reasoning: { enabled: true, effort },
        });
        return (getBody() as { thinking: { budget_tokens: number } }).thinking.budget_tokens;
      }
      assertEquals(await budgetFor("low"), 1024);
      assertEquals(await budgetFor("medium"), 4096);
      assertEquals(await budgetFor("high"), 16_384);
      assertEquals(await budgetFor("max"), 32_768);
    });

    it("honours Anthropic explicit budgetTokens over effort", async () => {
      const { runtime, getBody } = createAnthropicCaptureRuntime();
      await runtime.doGenerate({
        prompt: [userPrompt],
        maxOutputTokens: 1024,
        reasoning: { enabled: true, effort: "low", budgetTokens: 12_345 },
      });
      const body = getBody() as { thinking: { budget_tokens: number } };
      assertEquals(body.thinking.budget_tokens, 12_345);
    });

    it("clamps Anthropic max_tokens at the model cap when thinking is enabled", async () => {
      const { runtime, getBody } = createAnthropicCaptureRuntime("claude-opus-4-6");
      // Opus 4.6 caps at 128k. 100k base + 64k budget would be 164k — clamp to 128k.
      await runtime.doGenerate({
        prompt: [userPrompt],
        maxOutputTokens: 100_000,
        reasoning: { enabled: true, budgetTokens: 64_000 },
      });
      const body = getBody() as { max_tokens: number };
      assertEquals(body.max_tokens, 128_000);
    });

    it("drops Anthropic temperature and top_p when thinking is enabled", async () => {
      const { runtime, getBody } = createAnthropicCaptureRuntime();
      await runtime.doGenerate({
        prompt: [userPrompt],
        temperature: 0.7,
        topP: 0.9,
        reasoning: { enabled: true },
      });
      const body = getBody() as Record<string, unknown>;
      assertEquals("temperature" in body, false);
      assertEquals("top_p" in body, false);
    });

    it("preserves Anthropic sampling params when reasoning is disabled", async () => {
      const { runtime, getBody } = createAnthropicCaptureRuntime();
      await runtime.doGenerate({
        prompt: [userPrompt],
        temperature: 0.7,
        topP: 0.9,
      });
      const body = getBody() as { temperature: number; top_p: number };
      assertEquals(body.temperature, 0.7);
      assertEquals(body.top_p, 0.9);
    });

    it("omits Anthropic thinking field when reasoning.enabled is false", async () => {
      const { runtime, getBody } = createAnthropicCaptureRuntime();
      await runtime.doGenerate({
        prompt: [userPrompt],
        reasoning: { enabled: false, effort: "high" },
      });
      const body = getBody() as Record<string, unknown>;
      assertEquals("thinking" in body, false);
    });

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

    it("emits Google thinkingConfig when reasoning is enabled", async () => {
      const { runtime, getBody } = createGoogleCaptureRuntime();
      await runtime.doGenerate({
        prompt: [userPrompt],
        reasoning: { enabled: true, effort: "high" },
      });
      const body = getBody() as {
        generationConfig: { thinkingConfig: { includeThoughts: boolean; thinkingBudget: number } };
      };
      assertEquals(body.generationConfig.thinkingConfig, {
        includeThoughts: true,
        thinkingBudget: 8192,
      });
    });

    it("maps Google effort 'max' to thinkingBudget: -1 (dynamic)", async () => {
      const { runtime, getBody } = createGoogleCaptureRuntime();
      await runtime.doGenerate({
        prompt: [userPrompt],
        reasoning: { enabled: true, effort: "max" },
      });
      const body = getBody() as {
        generationConfig: { thinkingConfig: { thinkingBudget: number } };
      };
      assertEquals(body.generationConfig.thinkingConfig.thinkingBudget, -1);
    });

    it("honours Google explicit budgetTokens over effort", async () => {
      const { runtime, getBody } = createGoogleCaptureRuntime();
      await runtime.doGenerate({
        prompt: [userPrompt],
        reasoning: { enabled: true, effort: "low", budgetTokens: 4096 },
      });
      const body = getBody() as {
        generationConfig: { thinkingConfig: { thinkingBudget: number } };
      };
      assertEquals(body.generationConfig.thinkingConfig.thinkingBudget, 4096);
    });

    it("omits Google thinkingConfig when reasoning is disabled", async () => {
      const { runtime, getBody } = createGoogleCaptureRuntime();
      await runtime.doGenerate({ prompt: [userPrompt] });
      const body = getBody() as {
        generationConfig?: { thinkingConfig?: unknown };
      };
      assertEquals(body.generationConfig?.thinkingConfig, undefined);
    });

    it("passes redacted_thinking blocks through as reasoning events without leaking content", async () => {
      const encoder = new TextEncoder();
      const runtime = createAnthropicModelRuntime({
        apiKey: "test-anthropic-key",
        baseURL: "https://example.anthropic.test/v1",
        fetch: () =>
          Promise.resolve(
            new Response(
              ReadableStream.from([
                encoder.encode(
                  'event: message_start\ndata: {"type":"message_start","message":{"id":"m1","type":"message","role":"assistant","content":[],"model":"claude-opus-4-6","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}\n\n',
                ),
                encoder.encode(
                  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"redacted_thinking","data":"encrypted-opaque-blob"}}\n\n',
                ),
                encoder.encode(
                  'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
                ),
                encoder.encode(
                  'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}\n\n',
                ),
                encoder.encode(
                  'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"ok"}}\n\n',
                ),
                encoder.encode(
                  'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
                ),
                encoder.encode(
                  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n',
                ),
                encoder.encode(
                  'event: message_stop\ndata: {"type":"message_stop"}\n\n',
                ),
              ]),
              { status: 200, headers: { "content-type": "text/event-stream" } },
            ),
          ),
      }, "claude-opus-4-6");

      const result = await runtime.doStream({ prompt: [userPrompt] });
      const parts = await collectAsync(result.stream);
      // Redacted thinking emits reasoning-start (block 0) + reasoning-end, but no delta.
      const reasoningStarts = parts.filter((p) =>
        (p as { type: string }).type === "reasoning-start"
      );
      const reasoningDeltas = parts.filter((p) =>
        (p as { type: string }).type === "reasoning-delta"
      );
      const reasoningEnds = parts.filter((p) => (p as { type: string }).type === "reasoning-end");
      assertEquals(reasoningStarts.length, 1);
      assertEquals(reasoningDeltas.length, 0);
      assertEquals(reasoningEnds.length, 1);
    });
  });

  describe("cache usage reporting (cache_creation / cache_read / cached_tokens)", () => {
    const userPrompt = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
    } as const;

    it("surfaces Anthropic cache_creation_input_tokens and cache_read_input_tokens on generate", async () => {
      const runtime = createAnthropicModelRuntime({
        apiKey: "test-anthropic-key",
        baseURL: "https://example.anthropic.test/v1",
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                content: [{ type: "text", text: "ok" }],
                stop_reason: "end_turn",
                usage: {
                  input_tokens: 12,
                  output_tokens: 34,
                  cache_creation_input_tokens: 2056,
                  cache_read_input_tokens: 128,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
      }, "claude-sonnet-4-20250514");

      const result = await runtime.doGenerate({ prompt: [userPrompt] });
      assertEquals(result.usage, {
        inputTokens: 12,
        outputTokens: 34,
        totalTokens: 46,
        cacheCreationInputTokens: 2056,
        cacheReadInputTokens: 128,
      });
    });

    it("propagates Anthropic cache fields through the stream usage accumulator", async () => {
      const encoder = new TextEncoder();
      const runtime = createAnthropicModelRuntime({
        apiKey: "test-anthropic-key",
        baseURL: "https://example.anthropic.test/v1",
        fetch: () =>
          Promise.resolve(
            new Response(
              ReadableStream.from([
                // message_start carries input + cache token counts up front.
                encoder.encode(
                  'event: message_start\ndata: {"type":"message_start","message":{"id":"m1","type":"message","role":"assistant","content":[],"model":"claude-sonnet-4-20250514","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":12,"output_tokens":1,"cache_creation_input_tokens":2056,"cache_read_input_tokens":128}}}\n\n',
                ),
                encoder.encode(
                  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
                ),
                encoder.encode(
                  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n',
                ),
                encoder.encode(
                  'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
                ),
                // message_delta only updates output_tokens; cache fields absent here.
                encoder.encode(
                  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":34}}\n\n',
                ),
                encoder.encode(
                  'event: message_stop\ndata: {"type":"message_stop"}\n\n',
                ),
              ]),
              { status: 200, headers: { "content-type": "text/event-stream" } },
            ),
          ),
      }, "claude-sonnet-4-20250514");

      const result = await runtime.doStream({ prompt: [userPrompt] });
      const parts = await collectAsync(result.stream);
      const finish = parts.find((p) => (p as { type: string }).type === "finish") as {
        usage: {
          inputTokens?: number;
          outputTokens?: number;
          cacheCreationInputTokens?: number;
          cacheReadInputTokens?: number;
        };
      };
      assertEquals(finish.usage.inputTokens, 12);
      assertEquals(finish.usage.outputTokens, 34);
      assertEquals(finish.usage.cacheCreationInputTokens, 2056);
      assertEquals(finish.usage.cacheReadInputTokens, 128);
    });

    it("leaves Anthropic cache fields undefined when the provider omits them", async () => {
      const runtime = createAnthropicModelRuntime({
        apiKey: "test-anthropic-key",
        baseURL: "https://example.anthropic.test/v1",
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                content: [{ type: "text", text: "ok" }],
                stop_reason: "end_turn",
                usage: { input_tokens: 4, output_tokens: 2 },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
      }, "claude-sonnet-4-20250514");

      const result = await runtime.doGenerate({ prompt: [userPrompt] });
      // Cache fields should be absent (not zero) when provider doesn't return them.
      assertEquals(result.usage, {
        inputTokens: 4,
        outputTokens: 2,
        totalTokens: 6,
      });
    });

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

    it("surfaces Google cachedContentTokenCount as cacheReadInputTokens", async () => {
      const runtime = createGoogleModelRuntime({
        apiKey: "test-google-key",
        baseURL: "https://example.google.test/v1beta",
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                candidates: [{
                  content: { role: "model", parts: [{ text: "ok" }] },
                  finishReason: "STOP",
                }],
                usageMetadata: {
                  promptTokenCount: 123,
                  candidatesTokenCount: 45,
                  totalTokenCount: 168,
                  cachedContentTokenCount: 100,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
      }, "gemini-1.5-pro");

      const result = await runtime.doGenerate({ prompt: [userPrompt] });
      assertEquals(result.usage, {
        inputTokens: 123,
        outputTokens: 45,
        totalTokens: 168,
        cacheReadInputTokens: 100,
      });
    });

    it("leaves Google cache field undefined when cachedContentTokenCount is absent", async () => {
      const runtime = createGoogleModelRuntime({
        apiKey: "test-google-key",
        baseURL: "https://example.google.test/v1beta",
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                candidates: [{
                  content: { role: "model", parts: [{ text: "ok" }] },
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
          ),
      }, "gemini-1.5-pro");

      const result = await runtime.doGenerate({ prompt: [userPrompt] });
      assertEquals(result.usage, {
        inputTokens: 8,
        outputTokens: 2,
        totalTokens: 10,
      });
    });
  });

  describe("transient error classification (529 / 503 / 429 / Retry-After)", () => {
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

    it("classifies Anthropic 529 as ProviderOverloadedError (retryable)", async () => {
      const runtime = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: () =>
          Promise.resolve(
            errorResponse(529, { error: { type: "overloaded_error", message: "Overloaded" } }),
          ),
      }, "claude-opus-4-6");
      const err = await expectError(
        runtime.doGenerate({ prompt: [userPrompt] }),
        ProviderOverloadedError,
      );
      assertEquals(err.provider, "anthropic");
      assertEquals(err.status, 529);
      assertEquals(err.retryable, true);
    });

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

    it("classifies Google 503 as ProviderOverloadedError (retryable)", async () => {
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        baseURL: "https://example.google.test/v1beta",
        fetch: () =>
          Promise.resolve(errorResponse(503, { error: { code: 503, message: "Unavailable" } })),
      }, "gemini-1.5-pro");
      const err = await expectError(
        runtime.doGenerate({ prompt: [userPrompt] }),
        ProviderOverloadedError,
      );
      assertEquals(err.provider, "google");
      assertEquals(err.retryable, true);
    });

    it("classifies Google 429 RESOURCE_EXHAUSTED as ProviderQuotaError (non-retryable)", async () => {
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        baseURL: "https://example.google.test/v1beta",
        fetch: () =>
          Promise.resolve(
            errorResponse(429, {
              error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Daily quota" },
            }),
          ),
      }, "gemini-1.5-pro");
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

    it("classifies stream-mode 529 the same as JSON-mode", async () => {
      const runtime = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: () =>
          Promise.resolve(
            errorResponse(529, { error: { type: "overloaded_error", message: "Overloaded" } }),
          ),
      }, "claude-opus-4-6");
      const err = await expectError(
        runtime.doStream({ prompt: [userPrompt] }),
        ProviderOverloadedError,
      );
      assertEquals(err.retryable, true);
    });
  });

  describe("provider warnings (unsupported-setting drops)", () => {
    const userPrompt = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
    } as const;

    function okAnthropicResponse() {
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

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

    function okGoogleResponse() {
      return new Response(
        JSON.stringify({
          candidates: [{
            content: { role: "model", parts: [{ text: "ok" }] },
            finishReason: "STOP",
          }],
          usageMetadata: {
            promptTokenCount: 1,
            candidatesTokenCount: 1,
            totalTokenCount: 2,
          },
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

    it("warns on Anthropic presencePenalty / frequencyPenalty / seed / topK", async () => {
      const runtime = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: () => Promise.resolve(okAnthropicResponse()),
      }, "claude-opus-4-6");
      const result = await runtime.doGenerate({
        prompt: [userPrompt],
        presencePenalty: 0.1,
        frequencyPenalty: 0.2,
        seed: 42,
        topK: 50,
      });
      const dropped = settings(result).sort();
      assertEquals(dropped, ["frequencyPenalty", "presencePenalty", "seed", "topK"]);
    });

    it("warns when Anthropic stopSequences exceeds 4 entries (and truncates)", async () => {
      let captured: Record<string, unknown> | null = null;
      const runtime = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          captured = raw ? JSON.parse(raw) : null;
          return Promise.resolve(okAnthropicResponse());
        },
      }, "claude-opus-4-6");
      const result = await runtime.doGenerate({
        prompt: [userPrompt],
        stopSequences: ["a", "b", "c", "d", "e", "f"],
      });
      const dropped = settings(result);
      assertEquals(dropped.includes("stopSequences"), true);
      const capturedBody = captured as { stop_sequences: string[] } | null;
      assertEquals(capturedBody?.stop_sequences.length, 4);
    });

    it("warns when Anthropic temperature/topP are dropped due to extended thinking", async () => {
      const runtime = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: () => Promise.resolve(okAnthropicResponse()),
      }, "claude-opus-4-6");
      const result = await runtime.doGenerate({
        prompt: [userPrompt],
        temperature: 0.7,
        topP: 0.9,
        reasoning: { enabled: true, effort: "low" },
      });
      const dropped = settings(result).sort();
      assertEquals(dropped, ["temperature", "topP"]);
    });

    it("emits no warnings on a clean Anthropic request", async () => {
      const runtime = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: () => Promise.resolve(okAnthropicResponse()),
      }, "claude-opus-4-6");
      const result = await runtime.doGenerate({
        prompt: [userPrompt],
        temperature: 0.7,
        topP: 0.9,
        stopSequences: ["END"],
      }) as { warnings?: unknown[] };
      assertEquals(result.warnings, undefined);
    });

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

    it("warns on Google presencePenalty / frequencyPenalty drops", async () => {
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        baseURL: "https://example.google.test/v1beta",
        fetch: () => Promise.resolve(okGoogleResponse()),
      }, "gemini-1.5-pro");
      const result = await runtime.doGenerate({
        prompt: [userPrompt],
        presencePenalty: 0.1,
        frequencyPenalty: 0.2,
      });
      const dropped = settings(result).sort();
      assertEquals(dropped, ["frequencyPenalty", "presencePenalty"]);
    });

    it("emits Anthropic metadata.user_id when userId is set", async () => {
      let captured: Record<string, unknown> | null = null;
      const runtime = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          captured = raw ? JSON.parse(raw) : null;
          return Promise.resolve(okAnthropicResponse());
        },
      }, "claude-opus-4-6");
      await runtime.doGenerate({
        prompt: [userPrompt],
        userId: "user_42",
      });
      const body = captured as { metadata: { user_id: string } } | null;
      assertEquals(body?.metadata, { user_id: "user_42" });
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

    it("emits Google labels.user_id from userId when requestLabels is unset", async () => {
      let captured: Record<string, unknown> | null = null;
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        baseURL: "https://example.google.test/v1beta",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          captured = raw ? JSON.parse(raw) : null;
          return Promise.resolve(okGoogleResponse());
        },
      }, "gemini-1.5-pro");
      await runtime.doGenerate({
        prompt: [userPrompt],
        userId: "user_42",
      });
      const body = captured as { labels: Record<string, string> } | null;
      assertEquals(body?.labels, { user_id: "user_42" });
    });

    it("Google requestLabels wins over userId-derived labels", async () => {
      let captured: Record<string, unknown> | null = null;
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        baseURL: "https://example.google.test/v1beta",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          captured = raw ? JSON.parse(raw) : null;
          return Promise.resolve(okGoogleResponse());
        },
      }, "gemini-1.5-pro");
      await runtime.doGenerate({
        prompt: [userPrompt],
        userId: "user_42",
        requestLabels: { tenant: "acme", env: "prod" },
      });
      const body = captured as { labels: Record<string, string> } | null;
      assertEquals(body?.labels, { tenant: "acme", env: "prod" });
    });

    it("omits provider metadata fields when userId is unset", async () => {
      let anthropicBody: Record<string, unknown> | null = null;
      let openaiBody: Record<string, unknown> | null = null;
      let googleBody: Record<string, unknown> | null = null;

      const anthropic = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          anthropicBody = raw ? JSON.parse(raw) : null;
          return Promise.resolve(okAnthropicResponse());
        },
      }, "claude-opus-4-6");
      const openai = createOpenAIModelRuntime({
        apiKey: "k",
        baseURL: "https://example.openai.test/v1",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          openaiBody = raw ? JSON.parse(raw) : null;
          return Promise.resolve(okOpenAIResponse());
        },
      }, "gpt-4o-mini");
      const google = createGoogleModelRuntime({
        apiKey: "k",
        baseURL: "https://example.google.test/v1beta",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          googleBody = raw ? JSON.parse(raw) : null;
          return Promise.resolve(okGoogleResponse());
        },
      }, "gemini-1.5-pro");

      await anthropic.doGenerate({ prompt: [userPrompt] });
      await openai.doGenerate({ prompt: [userPrompt] });
      await google.doGenerate({ prompt: [userPrompt] });

      assertEquals("metadata" in (anthropicBody ?? {}), false);
      assertEquals("user" in (openaiBody ?? {}), false);
      assertEquals("labels" in (googleBody ?? {}), false);
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

  describe("Anthropic thinking signature multi-turn replay", () => {
    const userPrompt = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
    } as const;

    it("surfaces thinking blocks with text + signature on generate result", async () => {
      const runtime = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                content: [
                  {
                    type: "thinking",
                    thinking: "Let me reason step by step...",
                    signature: "sig_abc123",
                  },
                  { type: "text", text: "The answer is 42." },
                ],
                stop_reason: "end_turn",
                usage: { input_tokens: 1, output_tokens: 1 },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
      }, "claude-opus-4-6");
      const result = await runtime.doGenerate({ prompt: [userPrompt] });
      assertEquals(result.content, [
        { type: "reasoning", text: "Let me reason step by step...", signature: "sig_abc123" },
        { type: "text", text: "The answer is 42." },
      ]);
    });

    it("surfaces redacted thinking blocks as opaque reasoning parts", async () => {
      const runtime = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                content: [
                  { type: "redacted_thinking", data: "encrypted-blob" },
                  { type: "text", text: "ok" },
                ],
                stop_reason: "end_turn",
                usage: { input_tokens: 1, output_tokens: 1 },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
      }, "claude-opus-4-6");
      const result = await runtime.doGenerate({ prompt: [userPrompt] });
      assertEquals(result.content, [
        { type: "reasoning", redactedData: "encrypted-blob" },
        { type: "text", text: "ok" },
      ]);
    });

    it("replays reasoning content parts as thinking blocks on the next request", async () => {
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
      await runtime.doGenerate({
        prompt: [
          userPrompt,
          {
            role: "assistant",
            content: [
              {
                type: "reasoning",
                text: "Step by step thinking...",
                signature: "sig_abc123",
              },
              { type: "text", text: "The answer is 42." },
            ],
          },
          { role: "user", content: [{ type: "text", text: "Are you sure?" }] },
        ],
      });
      const body = captured as {
        messages: Array<{ role: string; content: Array<Record<string, unknown>> }>;
      } | null;
      assertEquals(body!.messages[1]!.role, "assistant");
      assertEquals(body!.messages[1]!.content[0], {
        type: "thinking",
        thinking: "Step by step thinking...",
        signature: "sig_abc123",
      });
      assertEquals(body!.messages[1]!.content[1], {
        type: "text",
        text: "The answer is 42.",
      });
    });

    it("surfaces text-block citations on the generate result", async () => {
      const runtime = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                content: [
                  {
                    type: "text",
                    text: "The capital of France is Paris.",
                    citations: [
                      {
                        type: "web_search_result_location",
                        cited_text: "Paris is the capital of France",
                        url: "https://example.com/france",
                        title: "France facts",
                      },
                    ],
                  },
                ],
                stop_reason: "end_turn",
                usage: { input_tokens: 1, output_tokens: 1 },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
      }, "claude-opus-4-6");
      const result = await runtime.doGenerate({
        prompt: [{
          role: "user",
          content: [{ type: "text", text: "What is the capital of France?" }],
        }],
      });
      const textPart = result.content![0] as {
        type: "text";
        text: string;
        citations?: Array<Record<string, unknown>>;
      };
      assertEquals(textPart.text, "The capital of France is Paris.");
      assertEquals(textPart.citations, [{
        type: "web_search_result_location",
        citedText: "Paris is the capital of France",
        url: "https://example.com/france",
        title: "France facts",
      }]);
    });

    it("normalizes char_location and page_location citation kinds", async () => {
      const runtime = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                content: [{
                  type: "text",
                  text: "ok",
                  citations: [
                    {
                      type: "char_location",
                      cited_text: "foo",
                      document_index: 0,
                      document_title: "Doc A",
                      start_char_index: 12,
                      end_char_index: 15,
                    },
                    {
                      type: "page_location",
                      cited_text: "bar",
                      document_index: 1,
                      start_page_number: 3,
                      end_page_number: 4,
                    },
                  ],
                }],
                stop_reason: "end_turn",
                usage: { input_tokens: 1, output_tokens: 1 },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
      }, "claude-opus-4-6");
      const result = await runtime.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Cite" }] }],
      });
      const textPart = result.content![0] as {
        citations?: Array<Record<string, unknown>>;
      };
      assertEquals(textPart.citations, [
        {
          type: "char_location",
          citedText: "foo",
          documentIndex: 0,
          documentTitle: "Doc A",
          startCharIndex: 12,
          endCharIndex: 15,
        },
        {
          type: "page_location",
          citedText: "bar",
          documentIndex: 1,
          startPageNumber: 3,
          endPageNumber: 4,
        },
      ]);
    });

    it("normalizes Google toolChoice 'tools' multi-name allowlist", async () => {
      let captured: Record<string, unknown> | null = null;
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        baseURL: "https://example.google.test/v1beta",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          captured = raw ? JSON.parse(raw) : null;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                candidates: [{
                  content: { role: "model", parts: [{ text: "ok" }] },
                  finishReason: "STOP",
                }],
                usageMetadata: {
                  promptTokenCount: 1,
                  candidatesTokenCount: 1,
                  totalTokenCount: 2,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        },
      }, "gemini-1.5-pro");
      await runtime.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        toolChoice: { type: "tools", names: ["weather", "clock"] },
      });
      const body = captured as
        | { toolConfig: { functionCallingConfig: Record<string, unknown> } }
        | null;
      assertEquals(body!.toolConfig.functionCallingConfig, {
        mode: "ANY",
        allowedFunctionNames: ["weather", "clock"],
      });
    });

    it("normalizes Google toolChoice 'auto' / 'any' / 'none' explicit modes", async () => {
      async function modeFor(toolChoice: { type: string }) {
        let captured: Record<string, unknown> | null = null;
        const runtime = createGoogleModelRuntime({
          apiKey: "k",
          baseURL: "https://example.google.test/v1beta",
          fetch: (_input, init) => {
            const raw = readRequestBody(init);
            captured = raw ? JSON.parse(raw) : null;
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  candidates: [{
                    content: { role: "model", parts: [{ text: "ok" }] },
                    finishReason: "STOP",
                  }],
                  usageMetadata: {
                    promptTokenCount: 1,
                    candidatesTokenCount: 1,
                    totalTokenCount: 2,
                  },
                }),
                { status: 200, headers: { "content-type": "application/json" } },
              ),
            );
          },
        }, "gemini-1.5-pro");
        await runtime.doGenerate({
          prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
          toolChoice,
        });
        const body = captured as
          | { toolConfig: { functionCallingConfig: { mode: string } } }
          | null;
        return body!.toolConfig.functionCallingConfig.mode;
      }
      assertEquals(await modeFor({ type: "auto" }), "AUTO");
      assertEquals(await modeFor({ type: "any" }), "ANY");
      assertEquals(await modeFor({ type: "none" }), "NONE");
    });

    it("surfaces Google groundingMetadata on the generate result when present", async () => {
      const groundingMetadata = {
        webSearchQueries: ["latest news"],
        groundingChunks: [
          {
            web: {
              uri: "https://example.com/article",
              title: "Article title",
            },
          },
        ],
        groundingSupports: [{
          segment: { startIndex: 0, endIndex: 10, text: "ok" },
          groundingChunkIndices: [0],
          confidenceScores: [0.95],
        }],
      };
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        baseURL: "https://example.google.test/v1beta",
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                candidates: [{
                  content: { role: "model", parts: [{ text: "ok" }] },
                  finishReason: "STOP",
                  groundingMetadata,
                }],
                usageMetadata: {
                  promptTokenCount: 1,
                  candidatesTokenCount: 1,
                  totalTokenCount: 2,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
      }, "gemini-2.5-pro");
      const result = await runtime.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      }) as { groundingMetadata?: Record<string, unknown> };
      assertEquals(result.groundingMetadata, groundingMetadata);
    });

    it("omits groundingMetadata when the candidate doesn't have any", async () => {
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        baseURL: "https://example.google.test/v1beta",
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                candidates: [{
                  content: { role: "model", parts: [{ text: "ok" }] },
                  finishReason: "STOP",
                }],
                usageMetadata: {
                  promptTokenCount: 1,
                  candidatesTokenCount: 1,
                  totalTokenCount: 2,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
      }, "gemini-2.5-pro");
      const result = await runtime.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      }) as { groundingMetadata?: unknown };
      assertEquals("groundingMetadata" in result, false);
    });

    it("emits Google code_execution provider tool", async () => {
      let captured: Record<string, unknown> | null = null;
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        baseURL: "https://example.google.test/v1beta",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          captured = raw ? JSON.parse(raw) : null;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                candidates: [{
                  content: { role: "model", parts: [{ text: "ok" }] },
                  finishReason: "STOP",
                }],
                usageMetadata: {
                  promptTokenCount: 1,
                  candidatesTokenCount: 1,
                  totalTokenCount: 2,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        },
      }, "gemini-2.5-pro");
      await runtime.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Compute" }] }],
        tools: [{
          type: "provider",
          name: "code_execution",
          id: "google.code_execution",
          args: {},
        }],
      });
      const body = captured as { tools: Array<Record<string, unknown>> } | null;
      assertEquals(body!.tools, [{ codeExecution: {} }]);
    });

    it("emits Google google_search provider tool alongside function declarations", async () => {
      let captured: Record<string, unknown> | null = null;
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        baseURL: "https://example.google.test/v1beta",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          captured = raw ? JSON.parse(raw) : null;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                candidates: [{
                  content: { role: "model", parts: [{ text: "ok" }] },
                  finishReason: "STOP",
                }],
                usageMetadata: {
                  promptTokenCount: 1,
                  candidatesTokenCount: 1,
                  totalTokenCount: 2,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        },
      }, "gemini-2.5-pro");
      await runtime.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Search" }] }],
        tools: [
          {
            type: "function",
            name: "weather",
            inputSchema: { type: "object", properties: {} },
          },
          {
            type: "provider",
            name: "google_search",
            id: "google.google_search",
            args: {},
          },
        ],
      });
      const body = captured as { tools: Array<Record<string, unknown>> } | null;
      assertEquals(body!.tools.length, 2);
      assertEquals("functionDeclarations" in (body!.tools[0] as Record<string, unknown>), true);
      assertEquals(body!.tools[1], { googleSearch: {} });
    });

    it("emits Google safetySettings when googleSafetySettings is set", async () => {
      let captured: Record<string, unknown> | null = null;
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        baseURL: "https://example.google.test/v1beta",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          captured = raw ? JSON.parse(raw) : null;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                candidates: [{
                  content: { role: "model", parts: [{ text: "ok" }] },
                  finishReason: "STOP",
                }],
                usageMetadata: {
                  promptTokenCount: 1,
                  candidatesTokenCount: 1,
                  totalTokenCount: 2,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        },
      }, "gemini-1.5-pro");
      await runtime.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        googleSafetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
        ],
      });
      const body = captured as { safetySettings: unknown } | null;
      assertEquals(body!.safetySettings, [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
      ]);
    });

    it("omits safetySettings when googleSafetySettings is unset or empty", async () => {
      let captured: Record<string, unknown> | null = null;
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        baseURL: "https://example.google.test/v1beta",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          captured = raw ? JSON.parse(raw) : null;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                candidates: [{
                  content: { role: "model", parts: [{ text: "ok" }] },
                  finishReason: "STOP",
                }],
                usageMetadata: {
                  promptTokenCount: 1,
                  candidatesTokenCount: 1,
                  totalTokenCount: 2,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        },
      }, "gemini-1.5-pro");
      await runtime.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        googleSafetySettings: [],
      });
      assertEquals("safetySettings" in (captured ?? {}), false);
    });

    it("emits Google cachedContent when googleCachedContent is set", async () => {
      let captured: Record<string, unknown> | null = null;
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        baseURL: "https://example.google.test/v1beta",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          captured = raw ? JSON.parse(raw) : null;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                candidates: [{
                  content: { role: "model", parts: [{ text: "ok" }] },
                  finishReason: "STOP",
                }],
                usageMetadata: {
                  promptTokenCount: 1,
                  candidatesTokenCount: 1,
                  totalTokenCount: 2,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        },
      }, "gemini-1.5-pro");
      await runtime.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        googleCachedContent: "cachedContents/abc123",
      });
      const body = captured as { cachedContent: string } | null;
      assertEquals(body!.cachedContent, "cachedContents/abc123");
    });

    it("omits cachedContent when googleCachedContent is unset", async () => {
      let captured: Record<string, unknown> | null = null;
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        baseURL: "https://example.google.test/v1beta",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          captured = raw ? JSON.parse(raw) : null;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                candidates: [{
                  content: { role: "model", parts: [{ text: "ok" }] },
                  finishReason: "STOP",
                }],
                usageMetadata: {
                  promptTokenCount: 1,
                  candidatesTokenCount: 1,
                  totalTokenCount: 2,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        },
      }, "gemini-1.5-pro");
      await runtime.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      });
      assertEquals("cachedContent" in (captured ?? {}), false);
    });

    it("emits OpenAI service_tier when serviceTier is set", async () => {
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
                  message: { role: "assistant", content: "ok" },
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
      const body = captured as { response_format: { type: string } } | null;
      assertEquals(body!.response_format, { type: "json_object" });
    });

    it("warns and omits response_format on Anthropic when responseFormat is structured", async () => {
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
      const result = await runtime.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        responseFormat: { type: "json" },
      }) as { warnings?: Array<{ setting?: string }> };
      assertEquals("response_format" in (captured ?? {}), false);
      const settingNames = (result.warnings ?? []).flatMap((w) => w.setting ? [w.setting] : []);
      assertEquals(settingNames.includes("responseFormat"), true);
    });

    it("omits citations field on text blocks that don't have them", async () => {
      const runtime = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                content: [{ type: "text", text: "no citations here" }],
                stop_reason: "end_turn",
                usage: { input_tokens: 1, output_tokens: 1 },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
      }, "claude-opus-4-6");
      const result = await runtime.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      });
      const textPart = result.content![0] as { citations?: unknown };
      assertEquals("citations" in textPart, false);
    });

    it("replays redacted reasoning parts as redacted_thinking blocks", async () => {
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
      await runtime.doGenerate({
        prompt: [
          userPrompt,
          {
            role: "assistant",
            content: [
              { type: "reasoning", redactedData: "encrypted-blob" },
              { type: "text", text: "ok" },
            ],
          },
          { role: "user", content: [{ type: "text", text: "go on" }] },
        ],
      });
      const body = captured as {
        messages: Array<{ role: string; content: Array<Record<string, unknown>> }>;
      } | null;
      assertEquals(body!.messages[1]!.content[0], {
        type: "redacted_thinking",
        data: "encrypted-blob",
      });
    });
  });

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
                output: [],
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

    it("converts user message to input_text content part on the wire", async () => {
      const { runtime, getBody } = captureResponsesRuntime();
      await runtime.doGenerate({ prompt: [userPrompt] });
      const body = getBody() as { input: Array<Record<string, unknown>> } | null;
      assertEquals(body!.input, [{
        role: "user",
        content: [{ type: "input_text", text: "Hi" }],
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
      const body = getBody() as { reasoning: Record<string, string> } | null;
      assertEquals(body!.reasoning, { effort: "high", summary: "auto" });
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
                output: [
                  {
                    type: "reasoning",
                    id: "rs_1",
                    summary: [
                      { type: "summary_text", text: "First, I'll check the weather." },
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
                ],
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
          summaries: [{ text: "First, I'll check the weather." }],
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
      assertEquals(result.usage, { inputTokens: 12, outputTokens: 34, totalTokens: 46 });
      assertEquals(result.finishReason, { unified: "stop", raw: "completed" });
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
                  'data: {"type":"response.output_item.done","item":{"id":"rs_1","type":"reasoning"}}\n\n',
                ),
                // Function call item
                encoder.encode(
                  'data: {"type":"response.output_item.added","item":{"id":"fc_1","type":"function_call","call_id":"call_w","name":"weather"}}\n\n',
                ),
                encoder.encode(
                  'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","delta":"{\\"city\\":\\"Tokyo\\"}"}\n\n',
                ),
                encoder.encode(
                  'data: {"type":"response.output_item.done","item":{"id":"fc_1","type":"function_call"}}\n\n',
                ),
                // Text message
                encoder.encode(
                  'data: {"type":"response.output_item.added","item":{"id":"msg_1","type":"message"}}\n\n',
                ),
                encoder.encode(
                  'data: {"type":"response.output_text.delta","item_id":"msg_1","delta":"It is sunny."}\n\n',
                ),
                encoder.encode(
                  'data: {"type":"response.output_item.done","item":{"id":"msg_1","type":"message"}}\n\n',
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
        "data-tool-call-status",
        "tool-input-delta",
        "tool-call",
        "text-delta",
        "finish",
      ]);

      const finish = parts.find((p) => (p as { type: string }).type === "finish") as {
        usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
      };
      assertEquals(finish.usage, {
        inputTokens: 12,
        outputTokens: 34,
        totalTokens: 46,
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
