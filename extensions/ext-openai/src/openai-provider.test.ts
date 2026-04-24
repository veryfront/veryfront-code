import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
// Error classes are shared plumbing — import from the shared barrel so this
// test stays decoupled from core's runtime-loader internals.
import {
  ProviderOverloadedError,
  ProviderQuotaError,
  ProviderRateLimitError,
  ProviderRequestError,
} from "veryfront/provider/shared";
import {
  createOpenAIEmbeddingRuntime,
  createOpenAIModelRuntime,
  createOpenAIResponsesRuntime,
} from "./openai-provider.ts";

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
// OpenAI Chat Completions — core generate / stream / SSE
// ---------------------------------------------------------------------------

describe("openai-provider", () => {
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
