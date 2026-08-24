import { assertEquals, assertRejects } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

import { ProviderOverloadedError, ProviderRequestError } from "veryfront/provider/shared";

import { MAX_ANTHROPIC_RAW_ASSISTANT_METADATA_BYTES } from "./anthropic-native-content.ts";
import { createAnthropicModelRuntime } from "./anthropic-provider.ts";

async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}

async function waitWithin<T>(promise: Promise<T>, timeoutMs = 500): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
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

function createSettledLegacyMcpPrompt(toolCallId: string) {
  return [{
    role: "user",
    content: [{ type: "text", text: "Echo" }],
  }, {
    role: "assistant",
    content: [],
    providerToolCalls: [{
      toolCallId,
      toolName: "echo",
      input: { value: "hello" },
    }],
    providerMetadata: {
      anthropic: {
        rawAssistantMessages: [[{
          type: "mcp_tool_use",
          id: toolCallId,
          name: "echo",
          server_name: "example-mcp",
          input: { value: "hello" },
        }]],
      },
    },
  }, {
    role: "assistant",
    content: [{ type: "text", text: "Completed." }],
    providerMetadata: {
      anthropic: {
        rawAssistantMessages: [[{
          type: "mcp_tool_result",
          tool_use_id: toolCallId,
          is_error: false,
          content: "hello",
        }]],
      },
    },
  }] as const;
}

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

  it("fails closed on an empty successful response without leaking its payload", async () => {
    const privatePayload = "<PRIVATE_PROVIDER_PAYLOAD>";
    const runtime = createAnthropicModelRuntime({
      apiKey: "k",
      baseURL: "https://example.anthropic.test/v1",
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              content: [],
              stop_reason: "end_turn",
              diagnostic: privatePayload,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
    }, "claude-sonnet-4-6");

    const error = await assertRejects(
      async () =>
        await runtime.doGenerate({
          prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        }),
      ProviderRequestError,
      "invalid successful response",
    );

    assertEquals(error.provider, "anthropic");
    assertEquals(error.status, 200);
    assertEquals(error.retryable, false);
    assertEquals(error.message.includes(privatePayload), false);
  });

  it("maps raw assistant metadata budget failures to the typed response error", async () => {
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
                  text: "x".repeat(MAX_ANTHROPIC_RAW_ASSISTANT_METADATA_BYTES),
                },
                {
                  type: "server_tool_use",
                  id: "srvtool_oversized_metadata",
                  name: "web_search",
                  input: { query: "bounded" },
                },
              ],
              stop_reason: "end_turn",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
    }, "claude-sonnet-4-6");

    const error = await assertRejects(
      () =>
        runtime.doGenerate({
          prompt: [{ role: "user", content: [{ type: "text", text: "Search" }] }],
        }),
      ProviderRequestError,
      "raw assistant metadata could not be retained safely",
    );

    assertEquals(error.provider, "anthropic");
    assertEquals(error.status, 200);
    assertEquals(error.retryable, false);
  });

  it("does not attach raw-assistant metadata to an empty assistant stream", async () => {
    const runtime = createAnthropicModelRuntime({
      apiKey: "k",
      baseURL: "https://example.anthropic.test/v1",
      fetch: () =>
        Promise.resolve(
          new Response(
            [
              'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\n',
              'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
              'event: message_stop\ndata: {"type":"message_stop"}\n\n',
            ].join(""),
            { status: 200, headers: { "content-type": "text/event-stream" } },
          ),
        ),
    }, "claude-sonnet-4-6");

    const result = await runtime.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
    });

    assertEquals(await collectAsync(result.stream), [{
      type: "finish",
      finishReason: { unified: "stop", raw: "end_turn" },
      usage: { inputTokens: 1, totalTokens: 1 },
    }]);
  });

  it("fails closed on an unknown block mixed into an otherwise valid direct response", async () => {
    const privateBlockType = "future_block_<PRIVATE_PROVIDER_PAYLOAD>";
    const runtime = createAnthropicModelRuntime({
      apiKey: "k",
      baseURL: "https://example.anthropic.test/v1",
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              content: [
                { type: "text", text: "visible" },
                { type: privateBlockType, private: "must not be ignored" },
              ],
              stop_reason: "end_turn",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
    }, "claude-sonnet-4-6");

    const error = await assertRejects(
      async () =>
        await runtime.doGenerate({
          prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        }),
      ProviderRequestError,
      "unsupported content block type",
    );
    assertEquals(error.message.includes(privateBlockType), false);
  });

  it("fails closed on an unknown block mixed into an otherwise valid stream", async () => {
    const privateBlockType = "future_block_<PRIVATE_PROVIDER_PAYLOAD>";
    const runtime = createAnthropicModelRuntime({
      apiKey: "k",
      baseURL: "https://example.anthropic.test/v1",
      fetch: () =>
        Promise.resolve(
          new Response(
            [
              'event: message_start\ndata: {"type":"message_start","message":{}}\n\n',
              'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"visible"}}\n\n',
              'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
              `event: content_block_start\ndata: ${
                JSON.stringify({
                  type: "content_block_start",
                  index: 1,
                  content_block: { type: privateBlockType, private: "must not be ignored" },
                })
              }\n\n`,
            ].join(""),
            { status: 200, headers: { "content-type": "text/event-stream" } },
          ),
        ),
    }, "claude-sonnet-4-6");
    const result = await runtime.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
    });

    const error = await assertRejects(
      () => collectAsync(result.stream),
      ProviderRequestError,
      "unsupported content block type",
    );
    assertEquals(error.message.includes(privateBlockType), false);
  });

  it("rejects malformed tool inputs and thinking fields in successful responses", async () => {
    const malformedBlocks = [
      { type: "tool_use", id: "tool_1", name: "lookup", input: [] },
      { type: "tool_use", id: "tool_1", name: "lookup", input: "private" },
      { type: "thinking", thinking: "valid", signature: 42 },
      { type: "thinking", thinking: 42, signature: "valid" },
    ];

    for (const block of malformedBlocks) {
      const runtime = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                content: [block],
                stop_reason: "end_turn",
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
      }, "claude-sonnet-4-6");

      await assertRejects(
        async () =>
          await runtime.doGenerate({
            prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
          }),
        ProviderRequestError,
        "malformed",
      );
    }
  });

  it("keeps Anthropic-schema bash, text-editor, computer, and memory calls client-executed", async () => {
    const runtime = createAnthropicModelRuntime({
      apiKey: "k",
      baseURL: "https://example.anthropic.test/v1",
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              content: [
                { type: "tool_use", id: "tool_bash", name: "bash", input: { command: "pwd" } },
                {
                  type: "tool_use",
                  id: "tool_editor",
                  name: "str_replace_editor",
                  input: { command: "view", path: "/tmp/a" },
                },
                {
                  type: "tool_use",
                  id: "tool_computer",
                  name: "computer",
                  input: { action: "screenshot" },
                },
                {
                  type: "tool_use",
                  id: "tool_memory",
                  name: "memory",
                  input: { command: "view", path: "/memories" },
                },
              ],
              stop_reason: "tool_use",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
    }, "claude-sonnet-4-6");

    const result = await runtime.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "Use local tools" }] }],
    });
    assertEquals(
      result.content?.map((part) =>
        typeof part === "object" && part !== null && "providerExecuted" in part
          ? part.providerExecuted
          : undefined
      ),
      [undefined, undefined, undefined, undefined],
    );
  });

  it("normalizes direct code-execution calls and results as provider-executed", async () => {
    const rawContent = [{
      type: "server_tool_use",
      id: "srvtool_code_direct",
      name: "code_execution",
      input: { code: "print(2)" },
    }, {
      type: "code_execution_tool_result",
      tool_use_id: "srvtool_code_direct",
      content: {
        type: "code_execution_result",
        stdout: "2\n",
        stderr: "",
        return_code: 0,
        content: [{ type: "code_execution_output", file_id: "file_result" }],
      },
    }];
    const runtime = createAnthropicModelRuntime({
      apiKey: "k",
      baseURL: "https://example.anthropic.test/v1",
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              content: rawContent,
              stop_reason: "end_turn",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
    }, "claude-sonnet-4-6");

    const result = await runtime.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "Run code" }] }],
    });
    assertEquals(result.content, [{
      type: "tool-call",
      toolCallId: "srvtool_code_direct",
      toolName: "code_execution",
      input: '{"code":"print(2)"}',
      providerExecuted: true,
    }, {
      type: "tool-result",
      toolCallId: "srvtool_code_direct",
      toolName: "code_execution",
      result: {
        type: "code_execution_result",
        stdout: "2\n",
        stderr: "",
        returnCode: 0,
        content: [{ type: "code_execution_output", fileId: "file_result" }],
      },
      providerExecuted: true,
    }]);
    assertEquals(result.providerMetadata, {
      anthropic: { rawAssistantMessages: [rawContent] },
    });
  });

  it("omits malformed Anthropic usage counters", async () => {
    const runtime = createAnthropicModelRuntime({
      apiKey: "k",
      baseURL: "https://example.anthropic.test/v1",
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              content: [{ type: "text", text: "ok" }],
              stop_reason: "end_turn",
              usage: {
                input_tokens: -1,
                output_tokens: 1.5,
                cache_creation_input_tokens: -2,
                cache_read_input_tokens: 0.5,
                veryfront: {
                  provider_cost_usd: -1,
                  cost_credits: -1,
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
    }, "claude-sonnet-4-6");

    const result = await runtime.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
    });

    assertEquals(result.usage, undefined);
  });

  it("retains raw mixed server/client assistant blocks for direct local-tool continuation", async () => {
    const rawContent = [{
      type: "server_tool_use",
      id: "server_search_mixed",
      name: "web_search",
      input: { query: "Veryfront" },
    }, {
      type: "tool_use",
      id: "local_lookup_mixed",
      name: "local_lookup",
      input: { query: "runtime" },
    }];
    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              content: rawContent,
              stop_reason: "tool_use",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
    }, "claude-sonnet-4-6");

    const result = await runtime.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "Search and inspect" }] }],
      tools: [{
        type: "provider",
        name: "web_search",
        id: "anthropic.web_search_20250305",
        args: {},
      }, {
        type: "function",
        name: "local_lookup",
        inputSchema: { type: "object" },
      }],
      maxOutputTokens: 64,
    });

    assertEquals(result.providerMetadata, {
      anthropic: { rawAssistantMessages: [rawContent] },
    });
  });

  it("retains raw mixed server/client assistant blocks for streamed local-tool continuation", async () => {
    const rawContent = [{
      type: "server_tool_use",
      id: "server_search_mixed_stream",
      name: "web_search",
      input: { query: "Veryfront" },
    }, {
      type: "tool_use",
      id: "local_lookup_mixed_stream",
      name: "local_lookup",
      input: { query: "runtime" },
    }];
    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: () =>
        Promise.resolve(
          new Response(
            [
              'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\n',
              `event: content_block_start\ndata: ${
                JSON.stringify({
                  type: "content_block_start",
                  index: 0,
                  content_block: rawContent[0],
                })
              }\n\n`,
              'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
              `event: content_block_start\ndata: ${
                JSON.stringify({
                  type: "content_block_start",
                  index: 1,
                  content_block: rawContent[1],
                })
              }\n\n`,
              'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
              'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n\n',
              'event: message_stop\ndata: {"type":"message_stop"}\n\n',
            ].join(""),
            { status: 200, headers: { "content-type": "text/event-stream" } },
          ),
        ),
    }, "claude-sonnet-4-6");

    const result = await runtime.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "Search and inspect" }] }],
      tools: [{
        type: "provider",
        name: "web_search",
        id: "anthropic.web_search_20250305",
        args: {},
      }, {
        type: "function",
        name: "local_lookup",
        inputSchema: { type: "object" },
      }],
      maxOutputTokens: 64,
    });
    const parts = await collectAsync(result.stream);
    const finish = parts.find((part) =>
      part && typeof part === "object" && "type" in part && part.type === "finish"
    );

    assertEquals(
      finish && typeof finish === "object" && "providerMetadata" in finish
        ? finish.providerMetadata
        : undefined,
      {
        anthropic: { rawAssistantMessages: [rawContent] },
      },
    );
  });

  it("continues direct pause_turn responses with the raw assistant content and unchanged tools", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    let requestCount = 0;
    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: (_input, init) => {
        requestBodies.push(JSON.parse(readRequestBody(init) ?? "{}"));
        requestCount++;
        const payload = requestCount === 1
          ? {
            content: [{
              type: "server_tool_use",
              id: "srvtool_pause_direct",
              name: "web_search",
              input: { query: "Veryfront" },
            }],
            stop_reason: "pause_turn",
            usage: { input_tokens: 8, output_tokens: 2 },
          }
          : {
            content: [{
              type: "web_search_tool_result",
              tool_use_id: "srvtool_pause_direct",
              content: [{
                type: "web_search_result",
                url: "https://veryfront.com",
                title: "Veryfront",
                page_age: null,
                encrypted_content: "opaque",
              }],
            }, { type: "text", text: "Search completed." }],
            stop_reason: "end_turn",
            usage: { input_tokens: 9, output_tokens: 4 },
          };
        return Promise.resolve(
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      },
    }, "claude-sonnet-4-6");

    const result = await runtime.doGenerate({
      prompt: [{
        role: "user",
        content: [{ type: "text", text: "Search" }],
      }],
      tools: [{
        type: "provider",
        name: "web_search",
        id: "anthropic.web_search_20250305",
        args: { maxUses: 5 },
      }],
      maxOutputTokens: 64,
    });

    assertEquals(requestCount, 2);
    assertEquals(requestBodies[1]?.tools, requestBodies[0]?.tools);
    assertEquals(requestBodies[1]?.messages, [{
      role: "user",
      content: [{ type: "text", text: "Search" }],
    }, {
      role: "assistant",
      content: [{
        type: "server_tool_use",
        id: "srvtool_pause_direct",
        name: "web_search",
        input: { query: "Veryfront" },
      }],
    }]);
    assertEquals(result, {
      content: [{
        type: "tool-call",
        toolCallId: "srvtool_pause_direct",
        toolName: "web_search",
        input: '{"query":"Veryfront"}',
        providerExecuted: true,
      }, {
        type: "tool-result",
        toolCallId: "srvtool_pause_direct",
        toolName: "web_search",
        result: [{
          type: "web_search_result",
          url: "https://veryfront.com",
          title: "Veryfront",
          pageAge: null,
          encryptedContent: "opaque",
        }],
        providerExecuted: true,
      }, { type: "text", text: "Search completed." }],
      finishReason: { unified: "stop", raw: "end_turn" },
      providerMetadata: {
        anthropic: {
          rawAssistantMessages: [[{
            type: "server_tool_use",
            id: "srvtool_pause_direct",
            name: "web_search",
            input: { query: "Veryfront" },
          }], [{
            type: "web_search_tool_result",
            tool_use_id: "srvtool_pause_direct",
            content: [{
              type: "web_search_result",
              url: "https://veryfront.com",
              title: "Veryfront",
              page_age: null,
              encrypted_content: "opaque",
            }],
          }, { type: "text", text: "Search completed." }]],
        },
      },
      usage: { inputTokens: 17, outputTokens: 6, totalTokens: 23 },
    });
  });

  it("correlates a direct MCP result with its tool name across pause_turn continuation", async () => {
    let requestCount = 0;
    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: () => {
        requestCount++;
        const payload = requestCount === 1
          ? {
            content: [{
              type: "mcp_tool_use",
              id: "mcptool_echo_direct",
              name: "echo",
              server_name: "example-mcp",
              input: { value: "hello" },
            }],
            stop_reason: "pause_turn",
          }
          : {
            content: [{
              type: "mcp_tool_result",
              tool_use_id: "mcptool_echo_direct",
              is_error: false,
              content: [{ type: "text", text: "hello", citations: null }],
            }, { type: "text", text: "MCP completed." }],
            stop_reason: "end_turn",
          };
        return Promise.resolve(
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      },
    }, "claude-sonnet-4-6");

    const result = await runtime.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "Echo" }] }],
      maxOutputTokens: 64,
    });

    assertEquals(requestCount, 2);
    assertEquals(result.content, [{
      type: "tool-call",
      toolCallId: "mcptool_echo_direct",
      toolName: "echo",
      input: '{"value":"hello"}',
      providerExecuted: true,
    }, {
      type: "tool-result",
      toolCallId: "mcptool_echo_direct",
      toolName: "echo",
      result: [{ type: "text", text: "hello", citations: null }],
      providerExecuted: true,
    }, { type: "text", text: "MCP completed." }]);
  });

  it("correlates a direct provider result with a canonical call from a prior invocation", async () => {
    const rawProviderCall = [{
      type: "mcp_tool_use",
      id: "mcptool_cross_invocation_direct",
      name: "echo",
      server_name: "example-mcp",
      input: { value: "hello" },
    }];
    const rawProviderResult = [{
      type: "mcp_tool_result",
      tool_use_id: "mcptool_cross_invocation_direct",
      is_error: false,
      content: [{ type: "text", text: "hello", citations: null }],
    }];
    let requestCount = 0;
    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: () => {
        requestCount++;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              content: rawProviderResult,
              stop_reason: "end_turn",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      },
    }, "claude-sonnet-4-6");

    const result = await runtime.doGenerate({
      prompt: [{
        role: "user",
        content: [{ type: "text", text: "Echo" }],
      }, {
        role: "assistant",
        content: [],
        providerToolCalls: [{
          toolCallId: "mcptool_cross_invocation_direct",
          toolName: "echo",
          input: { value: "hello" },
          supportsDeferredResults: true,
        }],
        providerMetadata: {
          anthropic: { rawAssistantMessages: [rawProviderCall] },
        },
      }],
      maxOutputTokens: 64,
    });

    assertEquals(requestCount, 1);
    assertEquals(result, {
      content: [{
        type: "tool-result",
        toolCallId: "mcptool_cross_invocation_direct",
        toolName: "echo",
        result: [{ type: "text", text: "hello", citations: null }],
        providerExecuted: true,
      }],
      finishReason: { unified: "stop", raw: "end_turn" },
      providerMetadata: {
        anthropic: { rawAssistantMessages: [rawProviderResult] },
      },
    });
  });

  it("does not seed response correlation from raw-only provider history", async () => {
    const rawProviderCall = [{
      type: "mcp_tool_use",
      id: "mcptool_raw_only",
      name: "echo",
      server_name: "example-mcp",
      input: { value: "hello" },
    }];
    let requestCount = 0;
    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: () => {
        requestCount++;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              content: [{
                type: "mcp_tool_result",
                tool_use_id: "mcptool_raw_only",
                is_error: false,
                content: "hello",
              }],
              stop_reason: "end_turn",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      },
    }, "claude-sonnet-4-6");

    await assertRejects(
      () =>
        runtime.doGenerate({
          prompt: [{
            role: "user",
            content: [{ type: "text", text: "Echo" }],
          }, {
            role: "assistant",
            content: [],
            providerMetadata: {
              anthropic: { rawAssistantMessages: [rawProviderCall] },
            },
          }],
          maxOutputTokens: 64,
        }),
      ProviderRequestError,
      "provider tool-result content block was malformed",
    );
    assertEquals(requestCount, 1);
  });

  it("does not seed direct correlation after a validated raw-only result settled the call", async () => {
    const toolCallId = "mcptool_settled_direct";
    let requestCount = 0;
    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: () => {
        requestCount++;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              content: [{
                type: "mcp_tool_result",
                tool_use_id: toolCallId,
                is_error: false,
                content: "duplicate",
              }],
              stop_reason: "end_turn",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      },
    }, "claude-sonnet-4-6");

    await assertRejects(
      () =>
        runtime.doGenerate({
          prompt: createSettledLegacyMcpPrompt(toolCallId),
          maxOutputTokens: 64,
        }),
      ProviderRequestError,
      "provider tool-result content block was malformed",
    );
    assertEquals(requestCount, 1);
  });

  it("does not seed streamed correlation after a validated raw-only result settled the call", async () => {
    const toolCallId = "mcptool_settled_stream";
    let requestCount = 0;
    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: () => {
        requestCount++;
        return Promise.resolve(
          new Response(
            [
              'event: message_start\ndata: {"type":"message_start","message":{}}\n\n',
              `event: content_block_start\ndata: ${
                JSON.stringify({
                  type: "content_block_start",
                  index: 0,
                  content_block: {
                    type: "mcp_tool_result",
                    tool_use_id: toolCallId,
                    is_error: false,
                    content: "duplicate",
                  },
                })
              }\n\n`,
              'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
              'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
              'event: message_stop\ndata: {"type":"message_stop"}\n\n',
            ].join(""),
            {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            },
          ),
        );
      },
    }, "claude-sonnet-4-6");

    const result = await runtime.doStream({
      prompt: createSettledLegacyMcpPrompt(toolCallId),
      maxOutputTokens: 64,
    });
    await assertRejects(
      () => collectAsync(result.stream),
      ProviderRequestError,
      "provider tool-result content block was malformed",
    );
    assertEquals(requestCount, 1);
  });

  it("does not reuse a provider call across a later user boundary", async () => {
    const rawProviderCall = [{
      type: "mcp_tool_use",
      id: "mcptool_stale_reused",
      name: "echo",
      server_name: "example-mcp",
      input: { value: "old" },
    }];
    let requestCount = 0;
    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: () => {
        requestCount++;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              content: [{
                type: "mcp_tool_result",
                tool_use_id: "mcptool_stale_reused",
                is_error: false,
                content: "stale",
              }],
              stop_reason: "end_turn",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      },
    }, "claude-sonnet-4-6");

    await assertRejects(
      () =>
        runtime.doGenerate({
          prompt: [{
            role: "user",
            content: [{ type: "text", text: "First turn" }],
          }, {
            role: "assistant",
            content: [{
              type: "tool-call",
              toolCallId: "mcptool_stale_reused",
              toolName: "echo",
              input: { value: "old" },
              providerExecuted: true,
            }],
            providerToolCalls: [{
              toolCallId: "mcptool_stale_reused",
              toolName: "echo",
              input: { value: "old" },
            }],
            providerMetadata: {
              anthropic: { rawAssistantMessages: [rawProviderCall] },
            },
          }, {
            role: "user",
            content: [{ type: "text", text: "Start a new turn" }],
          }, {
            role: "assistant",
            content: [],
            providerToolCalls: [{
              toolCallId: "mcptool_stale_reused",
              toolName: "echo",
              input: { value: "new" },
            }],
          }],
          maxOutputTokens: 64,
        }),
      ProviderRequestError,
      "provider tool-result content block was malformed",
    );
    assertEquals(requestCount, 1);
  });

  it("bounds canonical provider-call correlation state before transport", async () => {
    const createRawProviderCalls = (offset: number, length: number) =>
      Array.from({ length }, (_, index) => ({
        type: "mcp_tool_use",
        id: `mcptool_${offset + index}`,
        name: "echo",
        server_name: "example-mcp",
        input: { value: offset + index },
      }));
    const firstRawProviderCalls = createRawProviderCalls(0, 2_049);
    const secondRawProviderCalls = createRawProviderCalls(2_049, 2_048);
    let requestCount = 0;
    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: () => {
        requestCount++;
        throw new Error("fetch must not be called");
      },
    }, "claude-sonnet-4-6");

    await assertRejects(
      () =>
        runtime.doGenerate({
          prompt: [{
            role: "user",
            content: [{ type: "text", text: "Echo" }],
          }, {
            role: "assistant",
            content: [],
            providerToolCalls: firstRawProviderCalls.map((call) => ({
              toolCallId: call.id,
              toolName: call.name,
              input: call.input,
            })),
            providerMetadata: {
              anthropic: { rawAssistantMessages: [firstRawProviderCalls] },
            },
          }, {
            role: "assistant",
            content: [],
            providerToolCalls: secondRawProviderCalls.map((call) => ({
              toolCallId: call.id,
              toolName: call.name,
              input: call.input,
            })),
            providerMetadata: {
              anthropic: { rawAssistantMessages: [secondRawProviderCalls] },
            },
          }],
          maxOutputTokens: 64,
        }),
      TypeError,
      "exceeded 4096 outstanding calls",
    );
    assertEquals(requestCount, 0);
  });

  it("continues streamed pause_turn responses and emits one cumulative finish", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    let requestCount = 0;
    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: (_input, init) => {
        requestBodies.push(JSON.parse(readRequestBody(init) ?? "{}"));
        requestCount++;
        const body = requestCount === 1
          ? [
            'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":8}}}\n\n',
            'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"server_tool_use","id":"srvtool_pause_stream","name":"web_search","input":{}}}\n\n',
            'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"query\\":\\"Veryfront\\"}"}}\n\n',
            'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
            'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"pause_turn"},"usage":{"output_tokens":2}}\n\n',
            'event: message_stop\ndata: {"type":"message_stop"}\n\n',
          ].join("")
          : [
            'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":9}}}\n\n',
            'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"web_search_tool_result","tool_use_id":"srvtool_pause_stream","content":[{"type":"web_search_result","url":"https://veryfront.com","title":"Veryfront","page_age":null,"encrypted_content":"opaque"}]}}\n\n',
            'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
            'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":"Search completed."}}\n\n',
            'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
            'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}\n\n',
            'event: message_stop\ndata: {"type":"message_stop"}\n\n',
          ].join("");
        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );
      },
    }, "claude-sonnet-4-6");

    const result = await runtime.doStream({
      prompt: [{
        role: "user",
        content: [{ type: "text", text: "Search" }],
      }],
      tools: [{
        type: "provider",
        name: "web_search",
        id: "anthropic.web_search_20250305",
        args: { maxUses: 5 },
      }],
      maxOutputTokens: 64,
    });
    const parts = await collectAsync(result.stream);
    const finishes = parts.filter((part) =>
      typeof part === "object" && part !== null && "type" in part && part.type === "finish"
    );
    const toolResult = parts.find((part) =>
      typeof part === "object" && part !== null && "type" in part && part.type === "tool-result"
    );

    assertEquals(requestCount, 2);
    assertEquals(requestBodies[1]?.tools, requestBodies[0]?.tools);
    assertEquals(requestBodies[1]?.messages, [{
      role: "user",
      content: [{ type: "text", text: "Search" }],
    }, {
      role: "assistant",
      content: [{
        type: "server_tool_use",
        id: "srvtool_pause_stream",
        name: "web_search",
        input: { query: "Veryfront" },
      }],
    }]);
    assertEquals(toolResult, {
      type: "tool-result",
      toolCallId: "srvtool_pause_stream",
      toolName: "web_search",
      result: [{
        type: "web_search_result",
        url: "https://veryfront.com",
        title: "Veryfront",
        pageAge: null,
        encryptedContent: "opaque",
      }],
      providerExecuted: true,
    });
    assertEquals(finishes, [{
      type: "finish",
      finishReason: { unified: "stop", raw: "end_turn" },
      providerMetadata: {
        anthropic: {
          rawAssistantMessages: [[{
            type: "server_tool_use",
            id: "srvtool_pause_stream",
            name: "web_search",
            input: { query: "Veryfront" },
          }], [{
            type: "web_search_tool_result",
            tool_use_id: "srvtool_pause_stream",
            content: [{
              type: "web_search_result",
              url: "https://veryfront.com",
              title: "Veryfront",
              page_age: null,
              encrypted_content: "opaque",
            }],
          }, { type: "text", text: "Search completed." }]],
        },
      },
      usage: { inputTokens: 17, outputTokens: 6, totalTokens: 23 },
    }]);
  });

  it("correlates a streamed MCP result with its tool name across pause_turn continuation", async () => {
    let requestCount = 0;
    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: () => {
        requestCount++;
        const body = requestCount === 1
          ? [
            'event: message_start\ndata: {"type":"message_start","message":{}}\n\n',
            'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"mcp_tool_use","id":"mcptool_echo_stream","name":"echo","server_name":"example-mcp","input":{}}}\n\n',
            'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"value\\":\\"hello\\"}"}}\n\n',
            'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
            'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"pause_turn"}}\n\n',
            'event: message_stop\ndata: {"type":"message_stop"}\n\n',
          ].join("")
          : [
            'event: message_start\ndata: {"type":"message_start","message":{}}\n\n',
            'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"mcp_tool_result","tool_use_id":"mcptool_echo_stream","is_error":false,"content":"hello"}}\n\n',
            'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
            'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":"MCP completed."}}\n\n',
            'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
            'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
            'event: message_stop\ndata: {"type":"message_stop"}\n\n',
          ].join("");
        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );
      },
    }, "claude-sonnet-4-6");

    const result = await runtime.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "Echo" }] }],
      maxOutputTokens: 64,
    });
    const parts = await collectAsync(result.stream);
    const toolResult = parts.find((part) =>
      typeof part === "object" && part !== null && "type" in part &&
      part.type === "tool-result"
    );

    assertEquals(requestCount, 2);
    assertEquals(toolResult, {
      type: "tool-result",
      toolCallId: "mcptool_echo_stream",
      toolName: "echo",
      result: "hello",
      providerExecuted: true,
    });
  });

  it("correlates a streamed provider result with a canonical call from a prior invocation", async () => {
    const rawProviderCall = [{
      type: "mcp_tool_use",
      id: "mcptool_cross_invocation_stream",
      name: "echo",
      server_name: "example-mcp",
      input: { value: "hello" },
    }];
    let requestCount = 0;
    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: () => {
        requestCount++;
        return Promise.resolve(
          new Response(
            [
              'event: message_start\ndata: {"type":"message_start","message":{}}\n\n',
              'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"mcp_tool_result","tool_use_id":"mcptool_cross_invocation_stream","is_error":false,"content":"hello"}}\n\n',
              'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
              'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
              'event: message_stop\ndata: {"type":"message_stop"}\n\n',
            ].join(""),
            {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            },
          ),
        );
      },
    }, "claude-sonnet-4-6");

    const result = await runtime.doStream({
      prompt: [{
        role: "user",
        content: [{ type: "text", text: "Echo" }],
      }, {
        role: "assistant",
        content: [{
          type: "tool-call",
          toolCallId: "mcptool_cross_invocation_stream",
          toolName: "echo",
          input: { value: "hello" },
          providerExecuted: true,
          supportsDeferredResults: true,
        }],
        providerMetadata: {
          anthropic: { rawAssistantMessages: [rawProviderCall] },
        },
      }],
      maxOutputTokens: 64,
    });
    const parts = await collectAsync(result.stream);

    assertEquals(requestCount, 1);
    assertEquals(parts, [{
      type: "tool-result",
      toolCallId: "mcptool_cross_invocation_stream",
      toolName: "echo",
      result: "hello",
      providerExecuted: true,
    }, {
      type: "finish",
      finishReason: { unified: "stop", raw: "end_turn" },
      providerMetadata: {
        anthropic: {
          rawAssistantMessages: [[{
            type: "mcp_tool_result",
            tool_use_id: "mcptool_cross_invocation_stream",
            is_error: false,
            content: "hello",
          }]],
        },
      },
    }]);
  });

  it("aborts an in-flight pause_turn continuation without blocking on delayed cleanup", async () => {
    let requestCount = 0;
    let continuationSignal: AbortSignal | null | undefined;
    let continuationCleanupSettled = false;
    let resolveContinuationCleanup!: () => void;
    const continuationCleanup = new Promise<void>((resolve) => {
      resolveContinuationCleanup = resolve;
    });
    let notifyContinuationStarted: (() => void) | undefined;
    const continuationStarted = new Promise<void>((resolve) => {
      notifyContinuationStarted = resolve;
    });
    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: (_input, init) => {
        requestCount++;
        if (requestCount === 1) {
          return Promise.resolve(
            new Response(
              [
                'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\n',
                'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"Still working."}}\n\n',
                'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
                'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"pause_turn"}}\n\n',
                'event: message_stop\ndata: {"type":"message_stop"}\n\n',
              ].join(""),
              { status: 200, headers: { "content-type": "text/event-stream" } },
            ),
          );
        }

        continuationSignal = init && "signal" in init && init.signal instanceof AbortSignal
          ? init.signal
          : undefined;
        notifyContinuationStarted?.();
        return new Promise<Response>((_resolve, reject) => {
          const rejectAfterCleanup = () => {
            setTimeout(() => {
              continuationCleanupSettled = true;
              resolveContinuationCleanup();
              reject(
                continuationSignal?.reason ??
                  new DOMException("Continuation canceled", "AbortError"),
              );
            }, 10);
          };
          if (continuationSignal?.aborted) {
            rejectAfterCleanup();
          } else {
            continuationSignal?.addEventListener("abort", rejectAfterCleanup, { once: true });
          }
        });
      },
    }, "claude-sonnet-4-6");

    const result = await runtime.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "Continue" }] }],
      maxOutputTokens: 64,
    });
    const reader = result.stream.getReader();
    assertEquals(await reader.read(), {
      done: false,
      value: { type: "text-delta", delta: "Still working." },
    });
    const pendingRead = reader.read();
    await waitWithin(continuationStarted);

    await waitWithin(reader.cancel("consumer stopped"));
    assertEquals(continuationSignal?.aborted, true);
    assertEquals((await waitWithin(pendingRead)).done, true);
    assertEquals(requestCount, 2);
    await waitWithin(continuationCleanup);
    assertEquals(continuationCleanupSettled, true);
  });

  it("closes the upstream response body when canceled immediately after the first part", async () => {
    let upstreamCancelReason: unknown;
    let upstreamCancelSettled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            [
              'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\n',
              'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"First."}}\n\n',
            ].join(""),
          ),
        );
      },
      async cancel(reason) {
        await Promise.resolve();
        upstreamCancelReason = reason;
        upstreamCancelSettled = true;
      },
    });
    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: () =>
        Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        ),
    }, "claude-sonnet-4-6");

    const result = await runtime.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "Continue" }] }],
      maxOutputTokens: 64,
    });
    const reader = result.stream.getReader();

    assertEquals(await waitWithin(reader.read()), {
      done: false,
      value: { type: "text-delta", delta: "First." },
    });
    await waitWithin(reader.cancel("consumer stopped after first part"));

    assertEquals(upstreamCancelSettled, true);
    assertEquals(
      upstreamCancelReason,
      "consumer stopped after first part",
    );
  });

  it("accumulates every direct pause_turn assistant response across repeated pauses", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    let requestCount = 0;
    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: (_input, init) => {
        requestBodies.push(JSON.parse(readRequestBody(init) ?? "{}"));
        requestCount++;
        const payload = requestCount === 1
          ? { content: [{ type: "text", text: "First pause." }], stop_reason: "pause_turn" }
          : requestCount === 2
          ? { content: [{ type: "text", text: "Second pause." }], stop_reason: "pause_turn" }
          : { content: [{ type: "text", text: "Complete." }], stop_reason: "end_turn" };
        return Promise.resolve(
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      },
    }, "claude-sonnet-4-6");

    const result = await runtime.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "Continue" }] }],
      maxOutputTokens: 64,
    });

    assertEquals(requestCount, 3);
    assertEquals(requestBodies[2]?.messages, [{
      role: "user",
      content: [{ type: "text", text: "Continue" }],
    }, {
      role: "assistant",
      content: [{ type: "text", text: "First pause." }],
    }, {
      role: "assistant",
      content: [{ type: "text", text: "Second pause." }],
    }]);
    assertEquals(result.finishReason, { unified: "stop", raw: "end_turn" });
  });

  it("accumulates every streamed pause_turn assistant response across repeated pauses", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    let requestCount = 0;
    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: (_input, init) => {
        requestBodies.push(JSON.parse(readRequestBody(init) ?? "{}"));
        requestCount++;
        const text = requestCount === 1
          ? "First pause."
          : requestCount === 2
          ? "Second pause."
          : "Complete.";
        const stopReason = requestCount < 3 ? "pause_turn" : "end_turn";
        return Promise.resolve(
          new Response(
            [
              'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\n',
              `event: content_block_start\ndata: ${
                JSON.stringify({
                  type: "content_block_start",
                  index: 0,
                  content_block: { type: "text", text },
                })
              }\n\n`,
              'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
              `event: message_delta\ndata: ${
                JSON.stringify({
                  type: "message_delta",
                  delta: { stop_reason: stopReason },
                })
              }\n\n`,
              'event: message_stop\ndata: {"type":"message_stop"}\n\n',
            ].join(""),
            {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            },
          ),
        );
      },
    }, "claude-sonnet-4-6");

    const result = await runtime.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "Continue" }] }],
      maxOutputTokens: 64,
    });
    const parts = await collectAsync(result.stream);

    assertEquals(requestCount, 3);
    assertEquals(requestBodies[2]?.messages, [{
      role: "user",
      content: [{ type: "text", text: "Continue" }],
    }, {
      role: "assistant",
      content: [{ type: "text", text: "First pause." }],
    }, {
      role: "assistant",
      content: [{ type: "text", text: "Second pause." }],
    }]);
    assertEquals(
      parts.filter((part) =>
        part && typeof part === "object" && "type" in part && part.type === "finish"
      ).length,
      1,
    );
  });

  it("fails closed when direct pause_turn continuation exceeds its cap", async () => {
    let requestCount = 0;
    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: () => {
        requestCount++;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              content: [{ type: "text", text: `Waiting ${requestCount}.` }],
              stop_reason: "pause_turn",
              usage: { input_tokens: 1, output_tokens: 1 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      },
    }, "claude-sonnet-4-6");

    const error = await assertRejects(
      () =>
        runtime.doGenerate({
          prompt: [{ role: "user", content: [{ type: "text", text: "Wait" }] }],
          maxOutputTokens: 64,
        }),
      ProviderRequestError,
      "pause_turn continuation limit exceeded",
    );

    assertEquals(requestCount, 6);
    assertEquals(error.provider, "anthropic");
    assertEquals(error.status, 200);
    assertEquals(error.retryable, false);
  });

  it("fails closed when streamed pause_turn continuation exceeds its cap", async () => {
    let requestCount = 0;
    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: () => {
        requestCount++;
        return Promise.resolve(
          new Response(
            [
              'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\n',
              `event: content_block_start\ndata: ${
                JSON.stringify({
                  type: "content_block_start",
                  index: 0,
                  content_block: { type: "text", text: `Waiting ${requestCount}.` },
                })
              }\n\n`,
              'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
              'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"pause_turn"},"usage":{"output_tokens":1}}\n\n',
              'event: message_stop\ndata: {"type":"message_stop"}\n\n',
            ].join(""),
            { status: 200, headers: { "content-type": "text/event-stream" } },
          ),
        );
      },
    }, "claude-sonnet-4-6");

    const result = await runtime.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "Wait" }] }],
      maxOutputTokens: 64,
    });
    const error = await assertRejects(
      () => collectAsync(result.stream),
      ProviderRequestError,
      "pause_turn continuation limit exceeded",
    );

    assertEquals(requestCount, 6);
    assertEquals(error.provider, "anthropic");
    assertEquals(error.status, 200);
    assertEquals(error.retryable, false);
  });

  it("stops pause_turn continuation before a follow-up request when aborted", async () => {
    const abortController = new AbortController();
    let requestCount = 0;
    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: () => {
        requestCount++;
        abortController.abort(new DOMException("Stopped", "AbortError"));
        return Promise.resolve(
          new Response(
            JSON.stringify({
              content: [{
                type: "server_tool_use",
                id: "srvtool_pause_direct",
                name: "web_search",
                input: { query: "Veryfront" },
              }],
              stop_reason: "pause_turn",
              usage: { input_tokens: 8, output_tokens: 2 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      },
    }, "claude-sonnet-4-6");

    await assertRejects(
      () =>
        runtime.doGenerate({
          prompt: [{
            role: "user",
            content: [{ type: "text", text: "Search" }],
          }],
          maxOutputTokens: 64,
          abortSignal: abortController.signal,
        }),
      DOMException,
      "Stopped",
    );
    assertEquals(requestCount, 1);
  });

  it("preserves official web_search error codes in direct tool results", async () => {
    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              content: [{
                type: "server_tool_use",
                id: "srvtool_search_error",
                name: "web_search",
                input: { query: "Veryfront" },
              }, {
                type: "web_search_tool_result",
                tool_use_id: "srvtool_search_error",
                content: {
                  type: "web_search_tool_result_error",
                  error_code: "too_many_requests",
                },
              }],
              stop_reason: "end_turn",
              usage: { input_tokens: 4, output_tokens: 2 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
    }, "claude-sonnet-4-6");

    const result = await runtime.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "Search" }] }],
      maxOutputTokens: 64,
    });
    const errorPart = result.content?.find((part) =>
      typeof part === "object" && part !== null && "type" in part && part.type === "tool-result"
    ) as
      | { isError?: boolean; result?: unknown }
      | undefined;
    const error = errorPart?.result as
      | { name?: unknown; code?: unknown; toolCallId?: unknown; toolName?: unknown }
      | undefined;

    assertEquals(errorPart?.isError, true);
    assertEquals(error?.name, "AnthropicServerToolResultError");
    assertEquals(error?.code, "too_many_requests");
    assertEquals(error?.toolCallId, "srvtool_search_error");
    assertEquals(error?.toolName, "web_search");
  });

  it("preserves official web_fetch error codes in streamed tool errors", async () => {
    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: () =>
        Promise.resolve(
          new Response(
            [
              'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\n',
              'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"server_tool_use","id":"srvtool_fetch_error","name":"web_fetch","input":{"url":"https://example.com"}}}\n\n',
              'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
              'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"web_fetch_tool_result","tool_use_id":"srvtool_fetch_error","content":{"type":"web_fetch_tool_result_error","error_code":"url_not_allowed"}}}\n\n',
              'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
              'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":4,"output_tokens":2}}\n\n',
              'event: message_stop\ndata: {"type":"message_stop"}\n\n',
            ].join(""),
            { status: 200, headers: { "content-type": "text/event-stream" } },
          ),
        ),
    }, "claude-sonnet-4-6");

    const result = await runtime.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "Fetch" }] }],
      maxOutputTokens: 64,
    });
    const parts = await collectAsync(result.stream);
    const errorPart = parts.find((part) =>
      typeof part === "object" && part !== null && "type" in part && part.type === "tool-error"
    ) as { error?: unknown } | undefined;
    const error = errorPart?.error as
      | { name?: unknown; code?: unknown; toolCallId?: unknown; toolName?: unknown }
      | undefined;

    assertEquals(error?.name, "AnthropicServerToolResultError");
    assertEquals(error?.code, "url_not_allowed");
    assertEquals(error?.toolCallId, "srvtool_fetch_error");
    assertEquals(error?.toolName, "web_fetch");
  });

  it("preserves Veryfront gateway billing metadata for generate usage", async () => {
    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              content: [{ type: "text", text: "Done." }],
              stop_reason: "end_turn",
              usage: {
                input_tokens: 8,
                output_tokens: 2,
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
        ),
    }, "claude-sonnet-4-20250514");

    const result = await runtime.doGenerate({
      prompt: [{
        role: "user",
        content: [{ type: "text", text: "Triage this." }],
      }],
      maxOutputTokens: 64,
    });

    assertEquals(result.usage, {
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
    });
  });

  it("drains delayed Veryfront Cloud tool-use tails instead of canceling the gateway response", async () => {
    const encoder = new TextEncoder();
    let cancelCount = 0;
    let resolveClosed!: () => void;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    const runtime = createAnthropicModelRuntime({
      authToken: "vf_test_provider",
      baseURL: "https://api.veryfront.com/ai/gateway/anthropic/v1",
      name: "veryfront-cloud",
      fetch: () =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(
                  encoder.encode(
                    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\n',
                  ),
                );
                controller.enqueue(
                  encoder.encode(
                    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"bash"}}\n\n',
                  ),
                );
                controller.enqueue(
                  encoder.encode(
                    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"command\\":\\"pwd\\"}"}}\n\n',
                  ),
                );
                controller.enqueue(
                  encoder.encode(
                    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
                  ),
                );
                controller.enqueue(
                  encoder.encode(
                    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":4}}\n\n',
                  ),
                );
                controller.enqueue(
                  encoder.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n'),
                );
                setTimeout(() => {
                  controller.close();
                  resolveClosed();
                }, 150);
              },
              cancel() {
                cancelCount++;
                resolveClosed();
              },
            }),
            { status: 200, headers: { "content-type": "text/event-stream" } },
          ),
        ),
    }, "claude-sonnet-4-6");

    const result = await runtime.doStream({
      prompt: [{
        role: "user",
        content: [{ type: "text", text: "Call the tool" }],
      }],
      maxOutputTokens: 64,
    });

    const parts = await collectAsync(result.stream);
    await closed;

    assertEquals(cancelCount, 0);
    assertEquals(parts.at(-1), {
      type: "finish",
      finishReason: { unified: "tool-calls", raw: "tool_use" },
      usage: {
        inputTokens: 1,
        outputTokens: 4,
        totalTokens: 5,
      },
    });
  });

  it("sends image URL user parts as Anthropic vision content", async () => {
    let requestedInit: RequestInit | undefined;

    const runtime = createAnthropicModelRuntime({
      apiKey: "test-anthropic-key",
      baseURL: "https://example.anthropic.test/v1",
      fetch: (_input, init) => {
        requestedInit = init;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              content: [{ type: "text", text: "web app screenshot" }],
              stop_reason: "end_turn",
              usage: { input_tokens: 8, output_tokens: 2 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      },
    }, "claude-sonnet-4-20250514");

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
      maxOutputTokens: 64,
    });

    const requestBody = JSON.parse(readRequestBody(requestedInit) ?? "{}");
    assertEquals(requestBody.messages[0].content, [
      { type: "text", text: "What is this?" },
      {
        type: "image",
        source: {
          type: "url",
          url: "https://signed.example.com/web-app-screenshot.jpg",
        },
      },
    ]);
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
              content: [{ type: "text", text: "ok" }],
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
        inputSchema: {
          jsonSchema: {
            type: "object",
            properties: {
              project_reference: { type: "string" },
              path: { type: "string" },
              content: { type: "string" },
            },
            required: ["project_reference", "path", "content"],
            additionalProperties: false,
          },
        },
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
                'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"web_search_tool_result","tool_use_id":"srvtool_web_1","content":[{"type":"web_search_result","url":"https://veryfront.com","title":"Veryfront","page_age":null,"encrypted_content":"opaque"}]}}\n\n',
              ),
              encoder.encode(
                'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
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
        providerMetadata: {
          anthropic: {
            rawAssistantMessages: [[{
              type: "server_tool_use",
              id: "srvtool_web_1",
              name: "web_search",
              input: { query: "Veryfront" },
            }, {
              type: "web_search_tool_result",
              tool_use_id: "srvtool_web_1",
              content: [{
                type: "web_search_result",
                url: "https://veryfront.com",
                title: "Veryfront",
                page_age: null,
                encrypted_content: "opaque",
              }],
            }]],
          },
        },
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
                      media_type: "text/plain",
                      data: "Veryfront docs",
                    },
                    title: "Docs",
                  },
                  retrieved_at: null,
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
        providerExecuted: true,
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
          retrievedAt: null,
        },
        providerExecuted: true,
      }],
      finishReason: { unified: "stop", raw: "end_turn" },
      providerMetadata: {
        anthropic: {
          rawAssistantMessages: [[{
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
                  media_type: "text/plain",
                  data: "Veryfront docs",
                },
                title: "Docs",
              },
              retrieved_at: null,
            },
          }]],
        },
      },
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
                'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"server_tool_use","id":"srvtool_fetch_2","name":"web_fetch","input":{}}}\n\n',
              ),
              encoder.encode(
                'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"url\\":\\"https://veryfront.com/docs\\"}"}}\n\n',
              ),
              encoder.encode(
                'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
              ),
              encoder.encode(
                'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"web_fetch_tool_result","tool_use_id":"srvtool_fetch_2","content":{"type":"web_fetch_result","url":"https://veryfront.com/docs","content":{"type":"document","source":{"type":"text","media_type":"text/plain","data":"Veryfront docs"}},"retrieved_at":null}}}\n\n',
              ),
              encoder.encode(
                'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
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
          source: { type: "text", mediaType: "text/plain", data: "Veryfront docs" },
        },
        retrievedAt: null,
      },
      providerExecuted: true,
    });
    assertEquals(parts[4], {
      type: "finish",
      finishReason: { unified: "stop", raw: "end_turn" },
      providerMetadata: {
        anthropic: {
          rawAssistantMessages: [[{
            type: "server_tool_use",
            id: "srvtool_fetch_2",
            name: "web_fetch",
            input: { url: "https://veryfront.com/docs" },
          }, {
            type: "web_fetch_tool_result",
            tool_use_id: "srvtool_fetch_2",
            content: {
              type: "web_fetch_result",
              url: "https://veryfront.com/docs",
              content: {
                type: "document",
                source: {
                  type: "text",
                  media_type: "text/plain",
                  data: "Veryfront docs",
                },
              },
              retrieved_at: null,
            },
          }]],
        },
      },
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
                'event: content_block_start\r\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\r\n\r\n',
              ),
              encoder.encode(
                'event: content_block_delta\r\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\r\n\r\n',
              ),
              encoder.encode(
                'event: content_block_stop\r\ndata: {"type":"content_block_stop","index":0}\r\n\r\n',
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
        signature: "sig_123",
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
                'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":8}}}\n\n',
              ),
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
                'event: content_block_stop\ndata: {"type":"content_block_stop","index":2}\n\n',
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

  describe("Anthropic max_tokens model-aware defaults", () => {
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

    it("defaults Opus 4.8, 4.7, and 4.6 to 128k when caller omits maxOutputTokens", async () => {
      for (
        const modelId of [
          "claude-opus-4-8",
          "claude-opus-4-7",
          "claude-opus-4-6",
        ]
      ) {
        const body = await generateWith(modelId);
        assertEquals(
          (body as { max_tokens: number }).max_tokens,
          128_000,
          `expected 128k for ${modelId}`,
        );
      }
    });

    it("defaults Sonnet 4.6 to 64k when caller omits maxOutputTokens", async () => {
      const body = await generateWith("claude-sonnet-4-6");
      assertEquals((body as { max_tokens: number }).max_tokens, 64_000);
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
      for (
        const [modelId, expected] of [
          ["claude-opus-4-8", 128_000],
          ["claude-sonnet-4-6", 64_000],
        ] as const
      ) {
        const body = await generateWith(modelId, 999_999);
        assertEquals(
          (body as { max_tokens: number }).max_tokens,
          expected,
          `expected ${expected} for ${modelId}`,
        );
      }
    });

    it("passes through maxOutputTokens unchanged for unknown models", async () => {
      const body = await generateWith("some-future-model", 64_000);
      assertEquals((body as { max_tokens: number }).max_tokens, 64_000);
    });
  });

  describe("Anthropic prompt caching (cache_control breakpoints)", () => {
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
      assertEquals(body.tools[0], {
        name: "weather",
        description: "Get weather",
        input_schema: weatherTool.inputSchema,
      });
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
      let capturedInit: RequestInit | undefined;
      const runtime = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: (_input, init) => {
          capturedInit = init;
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
      return {
        runtime,
        getBody: () => captured,
        getHeader: (name: string) => readRequestHeader(capturedInit, name),
      };
    }

    it("emits the current MCP server/toolset contract and required beta", async () => {
      const { runtime, getBody, getHeader } = captureRuntime();
      await runtime.doGenerate({
        prompt: [userPrompt],
        headers: {
          "anthropic-beta": "context-management-2025-06-27, mcp-client-2025-04-04",
        },
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
      const body = getBody() as {
        mcp_servers: Array<Record<string, unknown>>;
        tools: Array<Record<string, unknown>>;
      } | null;
      assertEquals(body?.mcp_servers, [{
        type: "url",
        url: "https://example.com/mcp",
        name: "example",
        authorization_token: "Bearer abc",
      }]);
      assertEquals(body?.tools, [{
        type: "mcp_toolset",
        mcp_server_name: "example",
        default_config: { enabled: false },
        configs: {
          search: { enabled: true },
          fetch: { enabled: true },
        },
      }]);
      assertEquals(
        getHeader("anthropic-beta"),
        "context-management-2025-06-27,mcp-client-2025-11-20",
      );
    });

    it("omits mcp_servers when the option is empty or unset", async () => {
      const { runtime, getBody, getHeader } = captureRuntime();
      await runtime.doGenerate({ prompt: [userPrompt], mcpServers: [] });
      assertEquals("mcp_servers" in (getBody() ?? {}), false);
      assertEquals(getHeader("anthropic-beta"), null);

      const second = captureRuntime();
      await second.runtime.doGenerate({ prompt: [userPrompt] });
      assertEquals("mcp_servers" in (second.getBody() ?? {}), false);
      assertEquals(second.getHeader("anthropic-beta"), null);
    });

    it("adds the MCP beta to streaming requests without dropping other betas", async () => {
      let capturedInit: RequestInit | undefined;
      const encoder = new TextEncoder();
      const runtime = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: (_input, init) => {
          capturedInit = init;
          return Promise.resolve(
            new Response(
              ReadableStream.from([
                encoder.encode(
                  'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\n',
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
                encoder.encode(
                  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n',
                ),
                encoder.encode(
                  'event: message_stop\ndata: {"type":"message_stop"}\n\n',
                ),
              ]),
              { status: 200, headers: { "content-type": "text/event-stream" } },
            ),
          );
        },
      }, "claude-opus-4-6");

      const result = await runtime.doStream({
        prompt: [userPrompt],
        headers: {
          "anthropic-beta": "context-management-2025-06-27",
        },
        mcpServers: [{
          type: "url",
          url: "https://example.com/mcp",
          name: "example",
        }],
      });
      await collectAsync(result.stream);

      assertEquals(
        readRequestHeader(capturedInit, "anthropic-beta"),
        "context-management-2025-06-27,mcp-client-2025-11-20,fine-grained-tool-streaming-2025-05-14",
      );
    });

    it("keeps the required MCP beta on pause_turn continuation requests", async () => {
      const betaHeaders: Array<string | null> = [];
      let requestCount = 0;
      const runtime = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: (_input, init) => {
          requestCount++;
          betaHeaders.push(readRequestHeader(init, "anthropic-beta"));
          return Promise.resolve(
            new Response(
              JSON.stringify(
                requestCount === 1
                  ? {
                    content: [{ type: "text", text: "Working." }],
                    stop_reason: "pause_turn",
                  }
                  : {
                    content: [{ type: "text", text: "Done." }],
                    stop_reason: "end_turn",
                  },
              ),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        },
      }, "claude-opus-4-6");

      await runtime.doGenerate({
        prompt: [userPrompt],
        mcpServers: [{
          type: "url",
          url: "https://example.com/mcp",
          name: "example",
        }],
      });

      assertEquals(requestCount, 2);
      assertEquals(betaHeaders, [
        "mcp-client-2025-11-20",
        "mcp-client-2025-11-20",
      ]);
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

  describe("Anthropic thinking request options", () => {
    const userPrompt = {
      role: "user",
      content: [{ type: "text", text: "Solve this" }],
    } as const;

    function createCaptureRuntime(modelId = "claude-sonnet-4-6") {
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

    it("emits thinking config when reasoning is enabled with effort", async () => {
      const { runtime, getBody } = createCaptureRuntime();
      await runtime.doGenerate({
        prompt: [userPrompt],
        reasoning: { enabled: true, effort: "high" },
      });
      const body = getBody() as { thinking: { type: string; budget_tokens: number } };
      assertEquals(body.thinking, {
        type: "enabled",
        budget_tokens: 16_384,
      });
    });

    it("maps effort 'max' to budget_tokens 32768", async () => {
      const { runtime, getBody } = createCaptureRuntime();
      await runtime.doGenerate({
        prompt: [userPrompt],
        reasoning: { enabled: true, effort: "max" },
      });
      const body = getBody() as { thinking: { budget_tokens: number } };
      assertEquals(body.thinking.budget_tokens, 32_768);
    });

    it("honours explicit budgetTokens over effort", async () => {
      const { runtime, getBody } = createCaptureRuntime();
      await runtime.doGenerate({
        prompt: [userPrompt],
        reasoning: { enabled: true, effort: "low", budgetTokens: 4096 },
      });
      const body = getBody() as { thinking: { budget_tokens: number } };
      assertEquals(body.thinking.budget_tokens, 4096);
    });

    it("omits thinking config when reasoning is disabled", async () => {
      const { runtime, getBody } = createCaptureRuntime();
      await runtime.doGenerate({ prompt: [userPrompt] });
      const body = getBody() as { thinking?: unknown };
      assertEquals(body.thinking, undefined);
    });

    it("drops temperature and topP when thinking is enabled", async () => {
      const { runtime, getBody } = createCaptureRuntime();
      await runtime.doGenerate({
        prompt: [userPrompt],
        reasoning: { enabled: true, effort: "medium" },
        temperature: 0.7,
        topP: 0.9,
      });
      const body = getBody() as Record<string, unknown>;
      assertEquals("temperature" in body, false);
      assertEquals("top_p" in body, false);
    });
  });

  describe("Anthropic provider warnings (unsupported-setting drops)", () => {
    const userPrompt = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
    } as const;

    function okResponse() {
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
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

    it("warns on presencePenalty / frequencyPenalty / seed / topK drops", async () => {
      const runtime = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: () => Promise.resolve(okResponse()),
      }, "claude-sonnet-4-20250514");
      const result = await runtime.doGenerate({
        prompt: [userPrompt],
        presencePenalty: 0.1,
        frequencyPenalty: 0.2,
        seed: 42,
        topK: 10,
      });
      const dropped = settings(result).sort();
      assertEquals(dropped, ["frequencyPenalty", "presencePenalty", "seed", "topK"]);
    });

    it("warns when stopSequences exceeds 4", async () => {
      const runtime = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: () => Promise.resolve(okResponse()),
      }, "claude-sonnet-4-20250514");
      const result = await runtime.doGenerate({
        prompt: [userPrompt],
        stopSequences: ["a", "b", "c", "d", "e"],
      });
      const dropped = settings(result);
      assertEquals(dropped, ["stopSequences"]);
    });

    it("warns on temperature and topP when thinking is enabled", async () => {
      const runtime = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: () => Promise.resolve(okResponse()),
      }, "claude-sonnet-4-20250514");
      const result = await runtime.doGenerate({
        prompt: [userPrompt],
        reasoning: { enabled: true, effort: "medium" },
        temperature: 0.5,
        topP: 0.8,
      });
      const dropped = settings(result).sort();
      assertEquals(dropped, ["temperature", "topP"]);
    });

    it("warns on a schemaless json responseFormat", async () => {
      const runtime = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: () => Promise.resolve(okResponse()),
      }, "claude-sonnet-4-20250514");
      const result = await runtime.doGenerate({
        prompt: [userPrompt],
        responseFormat: { type: "json" },
      });
      const dropped = settings(result);
      assertEquals(dropped, ["responseFormat"]);
    });

    it("emits Anthropic output_config when responseFormat is structured", async () => {
      let captured: Record<string, unknown> | null = null;
      const runtime = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: (_input, init) => {
          captured = JSON.parse(readRequestBody(init) ?? "{}");
          return Promise.resolve(okResponse());
        },
      }, "claude-sonnet-4-20250514");
      const schema = {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      };
      const result = await runtime.doGenerate({
        prompt: [userPrompt],
        responseFormat: { type: "json_schema", name: "Person", schema, strict: true },
      });
      const body = captured as { output_config?: unknown } | null;
      // The schema is closed on the way out: Anthropic rejects an object schema
      // that does not explicitly set additionalProperties: false.
      assertEquals(body!.output_config, {
        format: { type: "json_schema", schema: { ...schema, additionalProperties: false } },
      });
      assertEquals(settings(result), []);
    });

    it("keeps requested output_config ahead of raw provider options", async () => {
      let captured: Record<string, unknown> | null = null;
      const runtime = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: (_input, init) => {
          captured = JSON.parse(readRequestBody(init) ?? "{}");
          return Promise.resolve(okResponse());
        },
      }, "claude-sonnet-4-20250514");
      const schema = {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      };
      await runtime.doGenerate({
        prompt: [userPrompt],
        providerOptions: {
          anthropic: {
            output_config: { format: { type: "text" } },
          },
        },
        responseFormat: { type: "json_schema", name: "Person", schema },
      });

      const body = captured as { output_config?: unknown } | null;
      // The schema is closed on the way out: Anthropic rejects an object schema
      // that does not explicitly set additionalProperties: false.
      assertEquals(body!.output_config, {
        format: { type: "json_schema", schema: { ...schema, additionalProperties: false } },
      });
    });

    it("advertises JSON Schema structured output only for supported model families", () => {
      const supported = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: () => Promise.resolve(okResponse()),
      }, "claude-sonnet-4-5-20250929");
      const unsupported = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: () => Promise.resolve(okResponse()),
      }, "claude-sonnet-4-20250514");
      assertEquals(supported.runtimeCapabilities?.structuredOutput, ["json_schema"]);
      assertEquals(unsupported.runtimeCapabilities?.structuredOutput, false);
    });
  });

  describe("Anthropic cache usage reporting", () => {
    const userPrompt = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
    } as const;

    it("surfaces cache_creation_input_tokens and cache_read_input_tokens", async () => {
      const runtime = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                content: [{ type: "text", text: "ok" }],
                stop_reason: "end_turn",
                usage: {
                  input_tokens: 100,
                  output_tokens: 10,
                  cache_creation_input_tokens: 50,
                  cache_read_input_tokens: 30,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
      }, "claude-sonnet-4-20250514");

      const result = await runtime.doGenerate({ prompt: [userPrompt] });
      assertEquals(result.usage, {
        inputTokens: 100,
        outputTokens: 10,
        totalTokens: 110,
        cacheCreationInputTokens: 50,
        cacheReadInputTokens: 30,
        cachedInputTokens: 30,
      });
    });

    it("omits cache fields when not present", async () => {
      const runtime = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                content: [{ type: "text", text: "ok" }],
                stop_reason: "end_turn",
                usage: {
                  input_tokens: 8,
                  output_tokens: 2,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
      }, "claude-sonnet-4-20250514");

      const result = await runtime.doGenerate({ prompt: [userPrompt] });
      assertEquals(result.usage, {
        inputTokens: 8,
        outputTokens: 2,
        totalTokens: 10,
      });
    });
  });

  describe("Anthropic thinking blocks in generate (non-streaming)", () => {
    it("parses cleartext thinking blocks with signature", async () => {
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
                    thinking: "Let me consider this carefully.",
                    signature: "sig_abc123",
                  },
                  { type: "text", text: "The answer is 42." },
                ],
                stop_reason: "end_turn",
                usage: { input_tokens: 10, output_tokens: 5 },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
      }, "claude-sonnet-4-20250514");

      const result = await runtime.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "What is the meaning?" }] }],
      });
      assertEquals(result.content, [
        {
          type: "reasoning",
          text: "Let me consider this carefully.",
          signature: "sig_abc123",
        },
        { type: "text", text: "The answer is 42." },
      ]);
    });

    it("parses redacted thinking blocks", async () => {
      const runtime = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                content: [
                  {
                    type: "redacted_thinking",
                    data: "encrypted_blob_xyz",
                  },
                  { type: "text", text: "I can help with that." },
                ],
                stop_reason: "end_turn",
                usage: { input_tokens: 10, output_tokens: 5 },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
      }, "claude-sonnet-4-20250514");

      const result = await runtime.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Help me" }] }],
      });
      assertEquals(result.content, [
        { type: "reasoning", redactedData: "encrypted_blob_xyz" },
        { type: "text", text: "I can help with that." },
      ]);
    });
  });

  describe("Anthropic thinking multi-turn replay", () => {
    it("replays cleartext thinking with signature in assistant messages", async () => {
      let requestedInit: RequestInit | undefined;
      const runtime = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: (_input, init) => {
          requestedInit = init;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                content: [{ type: "text", text: "continued" }],
                stop_reason: "end_turn",
                usage: { input_tokens: 20, output_tokens: 1 },
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
                type: "reasoning",
                text: "I need to think about this.",
                signature: "sig_replay",
              },
              { type: "text", text: "Here is my answer." },
            ],
          },
          {
            role: "user",
            content: [{ type: "text", text: "Continue" }],
          },
        ],
      });

      const body = typeof requestedInit?.body === "string"
        ? JSON.parse(requestedInit.body)
        : undefined;
      assertEquals(body?.messages[0], {
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: "I need to think about this.",
            signature: "sig_replay",
          },
          { type: "text", text: "Here is my answer." },
        ],
      });
    });

    it("replays redacted thinking blocks as redacted_thinking", async () => {
      let requestedInit: RequestInit | undefined;
      const runtime = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: (_input, init) => {
          requestedInit = init;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                content: [{ type: "text", text: "continued" }],
                stop_reason: "end_turn",
                usage: { input_tokens: 20, output_tokens: 1 },
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
                type: "reasoning",
                redactedData: "encrypted_blob_abc",
              },
              { type: "text", text: "My answer." },
            ],
          },
          {
            role: "user",
            content: [{ type: "text", text: "Continue" }],
          },
        ],
      });

      const body = typeof requestedInit?.body === "string"
        ? JSON.parse(requestedInit.body)
        : undefined;
      assertEquals(body?.messages[0], {
        role: "assistant",
        content: [
          {
            type: "redacted_thinking",
            data: "encrypted_blob_abc",
          },
          { type: "text", text: "My answer." },
        ],
      });
    });
  });

  describe("Anthropic redacted thinking in stream", () => {
    it("emits reasoning-start and reasoning-end for redacted_thinking blocks", async () => {
      const encoder = new TextEncoder();
      const runtime = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: () =>
          Promise.resolve(
            new Response(
              ReadableStream.from([
                encoder.encode(
                  'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5}}}\n\n',
                ),
                encoder.encode(
                  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"redacted_thinking","data":"encrypted"}}\n\n',
                ),
                encoder.encode(
                  'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
                ),
                encoder.encode(
                  'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":"Answer."}}\n\n',
                ),
                encoder.encode(
                  'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
                ),
                encoder.encode(
                  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":5,"output_tokens":2}}\n\n',
                ),
                encoder.encode(
                  'event: message_stop\ndata: {"type":"message_stop"}\n\n',
                ),
              ]),
              { status: 200, headers: { "content-type": "text/event-stream" } },
            ),
          ),
      }, "claude-sonnet-4-20250514");

      const result = await runtime.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      });

      const parts = await collectAsync(result.stream);
      assertEquals(parts, [
        { type: "reasoning-start", id: "thinking-0" },
        { type: "reasoning-end", id: "thinking-0", redactedData: "encrypted" },
        { type: "text-delta", delta: "Answer." },
        {
          type: "finish",
          finishReason: { unified: "stop", raw: "end_turn" },
          usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
        },
      ]);
    });
  });

  describe("Anthropic citation parsing", () => {
    it("parses citations on text blocks in generate response", async () => {
      const runtime = createAnthropicModelRuntime({
        apiKey: "k",
        baseURL: "https://example.anthropic.test/v1",
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                content: [{
                  type: "text",
                  text: "According to the docs, Veryfront is a full-stack framework.",
                  citations: [{
                    type: "web_search_result_location",
                    cited_text: "Veryfront is a full-stack framework",
                    url: "https://veryfront.com",
                    title: "Veryfront",
                    encrypted_index: "encrypted-citation-index",
                  }],
                }],
                stop_reason: "end_turn",
                usage: { input_tokens: 10, output_tokens: 5 },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
      }, "claude-sonnet-4-20250514");

      const result = await runtime.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "What is Veryfront?" }] }],
      });
      assertEquals(result.content, [{
        type: "text",
        text: "According to the docs, Veryfront is a full-stack framework.",
        citations: [{
          type: "web_search_result_location",
          citedText: "Veryfront is a full-stack framework",
          url: "https://veryfront.com",
          title: "Veryfront",
          encryptedIndex: "encrypted-citation-index",
        }],
      }]);
    });

    it("fails closed on malformed or unknown citation records", async () => {
      for (
        const citation of [
          {
            type: "web_search_result_location",
            cited_text: "Private source",
            url: "https://example.test",
          },
          {
            type: "char_location",
            cited_text: "Private source",
            document_index: 0,
            start_char_index: 0,
            end_char_index: Number.NaN,
          },
          {
            type: "future_location",
            cited_text: "Private source",
          },
        ]
      ) {
        const runtime = createAnthropicModelRuntime({
          apiKey: "k",
          baseURL: "https://example.anthropic.test/v1",
          fetch: () =>
            Promise.resolve(
              new Response(
                JSON.stringify({
                  content: [{
                    type: "text",
                    text: "Answer",
                    citations: [citation],
                  }],
                  stop_reason: "end_turn",
                  usage: { input_tokens: 1, output_tokens: 1 },
                }),
                { status: 200, headers: { "content-type": "application/json" } },
              ),
            ),
        }, "claude-sonnet-4-20250514");

        const error = await assertRejects(
          () =>
            runtime.doGenerate({
              prompt: [{ role: "user", content: [{ type: "text", text: "Question" }] }],
            }),
          ProviderRequestError,
          "text citation was malformed",
        );
        assertEquals(error.message.includes("Private source"), false);
      }
    });
  });

  describe("Anthropic userId and metadata", () => {
    const userPrompt = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
    } as const;

    it("emits metadata.user_id when userId is set", async () => {
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
      }, "claude-sonnet-4-20250514");
      await runtime.doGenerate({
        prompt: [userPrompt],
        userId: "user_42",
      });
      const body = captured as { metadata?: { user_id?: string } } | null;
      assertEquals(body?.metadata, { user_id: "user_42" });
    });

    it("omits metadata when userId is unset", async () => {
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
      }, "claude-sonnet-4-20250514");
      await runtime.doGenerate({ prompt: [userPrompt] });
      assertEquals("metadata" in (captured ?? {}), false);
    });
  });

  describe("Anthropic stop_sequences truncation", () => {
    it("truncates stop_sequences to 4 entries", async () => {
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
      }, "claude-sonnet-4-20250514");
      await runtime.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        stopSequences: ["a", "b", "c", "d", "e", "f"],
      });
      const body = captured as { stop_sequences?: string[] } | null;
      assertEquals(body?.stop_sequences, ["a", "b", "c", "d"]);
    });
  });
  describe("Anthropic in-stream retryable errors", () => {
    const encoder = new TextEncoder();

    function sse(...events: Record<string, unknown>[]): string[] {
      return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }

    function streamResponse(chunks: string[]): Response {
      return new Response(
        ReadableStream.from(chunks.map((chunk) => encoder.encode(chunk))),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    }

    const OVERLOADED = sse({
      type: "error",
      error: { type: "overloaded_error", message: "Overloaded" },
    });

    const SUCCESS = sse(
      { type: "message_start", message: { usage: { input_tokens: 3 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "hello" },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 2 },
      },
      { type: "message_stop" },
    );

    function runtimeFor(responses: (() => Response)[]) {
      const sentBodies: Record<string, unknown>[] = [];
      let attempts = 0;
      const runtime = createAnthropicModelRuntime({
        apiKey: "test-anthropic-key",
        baseURL: "https://example.anthropic.test/v1",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          sentBodies.push(raw ? JSON.parse(raw) : {});
          const next = responses[Math.min(attempts, responses.length - 1)];
          attempts++;
          if (!next) throw new Error("No stubbed response for this attempt");
          return Promise.resolve(next());
        },
      }, "claude-opus-4-6");
      return { runtime, attemptCount: () => attempts, sentBodies };
    }

    it("replays the request when the stream errors as overloaded before any output", async () => {
      const { runtime, attemptCount } = runtimeFor([
        () => streamResponse(OVERLOADED),
        () => streamResponse(SUCCESS),
      ]);

      const result = await runtime.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        maxOutputTokens: 64,
      });
      const parts = await collectAsync(result.stream);

      assertEquals(attemptCount(), 2);
      assertEquals(
        parts.some((part) =>
          (part as { type?: string; delta?: string }).type === "text-delta" &&
          (part as { delta?: string }).delta === "hello"
        ),
        true,
      );
      assertEquals(
        parts.filter((part) => (part as { type?: string }).type === "finish").length,
        1,
      );
    });

    it("does not replay once the stream has produced output", async () => {
      const partialThenOverloaded = [
        ...sse(
          { type: "message_start", message: { usage: { input_tokens: 3 } } },
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "partial" },
          },
        ),
        ...OVERLOADED,
      ];
      const { runtime, attemptCount } = runtimeFor([
        () => streamResponse(partialThenOverloaded),
        () => streamResponse(SUCCESS),
      ]);

      const result = await runtime.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        maxOutputTokens: 64,
      });

      await assertRejects(
        () => collectAsync(result.stream),
        ProviderOverloadedError,
        "provider overloaded",
      );
      assertEquals(attemptCount(), 1);
    });

    it("does not replay a non-retryable in-stream error", async () => {
      const { runtime, attemptCount } = runtimeFor([
        () =>
          streamResponse(sse({
            type: "error",
            error: { type: "authentication_error", message: "bad key" },
          })),
        () => streamResponse(SUCCESS),
      ]);

      const result = await runtime.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        maxOutputTokens: 64,
      });

      await assertRejects(() => collectAsync(result.stream), ProviderRequestError);
      assertEquals(attemptCount(), 1);
    });

    it("replays a pause_turn continuation that overloads before its first part", async () => {
      const pauseTurn = sse(
        { type: "message_start", message: { usage: { input_tokens: 3 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "first" } },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: "pause_turn" },
          usage: { output_tokens: 1 },
        },
        { type: "message_stop" },
      );
      const { runtime, attemptCount, sentBodies } = runtimeFor([
        () => streamResponse(pauseTurn),
        () => streamResponse(OVERLOADED),
        () => streamResponse(SUCCESS),
      ]);

      const result = await runtime.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        maxOutputTokens: 64,
      });
      const parts = await collectAsync(result.stream);

      assertEquals(attemptCount(), 3);
      // The replay must re-issue the continuation, not the original turn.
      // Sending `body` again would drop the paused assistant content and
      // silently restart the turn.
      const messageCounts = sentBodies.map((sent) =>
        Array.isArray((sent as { messages?: unknown[] }).messages)
          ? (sent as { messages: unknown[] }).messages.length
          : 0
      );
      assertEquals(messageCounts, [1, 2, 2]);
      const deltas = parts
        .filter((part) => (part as { type?: string }).type === "text-delta")
        .map((part) => (part as { delta?: string }).delta);
      assertEquals(deltas, ["first", "hello"]);
      assertEquals(
        parts.filter((part) => (part as { type?: string }).type === "finish").length,
        1,
      );
    });

    it("shares one replay budget across the whole call rather than resetting per request", async () => {
      const pauseTurn = sse(
        { type: "message_start", message: { usage: { input_tokens: 3 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "first" } },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: "pause_turn" },
          usage: { output_tokens: 1 },
        },
        { type: "message_stop" },
      );
      // One replay is spent before the pause_turn continuation, so the
      // continuation may only replay once more before the budget is gone.
      const { runtime, attemptCount } = runtimeFor([
        () => streamResponse(OVERLOADED),
        () => streamResponse(pauseTurn),
        () => streamResponse(OVERLOADED),
      ]);

      const result = await runtime.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        maxOutputTokens: 64,
      });

      await assertRejects(
        () => collectAsync(result.stream),
        ProviderOverloadedError,
        "provider overloaded",
      );
      assertEquals(attemptCount(), 4);
    });

    it("shares one header budget across initial stream requests and in-stream replays", async () => {
      const originalNow = performance.now;
      let now = 0;
      const { runtime, attemptCount } = runtimeFor([
        () => streamResponse(OVERLOADED),
        () => streamResponse(SUCCESS),
      ]);

      try {
        performance.now = () => now;
        const result = await runtime.doStream({
          prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
          maxOutputTokens: 64,
        });
        now = 41_000;

        await assertRejects(
          () => collectAsync(result.stream),
          ProviderOverloadedError,
          "provider overloaded",
        );
        assertEquals(attemptCount(), 1);
      } finally {
        performance.now = originalNow;
      }
    });

    it("bounds the replays and surfaces the provider failure when they are exhausted", async () => {
      const { runtime, attemptCount } = runtimeFor([() => streamResponse(OVERLOADED)]);

      const result = await runtime.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        maxOutputTokens: 64,
      });

      await assertRejects(
        () => collectAsync(result.stream),
        ProviderOverloadedError,
        "provider overloaded",
      );
      assertEquals(attemptCount(), 3);
    });
  });
});
