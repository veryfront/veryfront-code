import { assertEquals } from "#veryfront/testing/assert.ts";
import { assertGreaterOrEqual } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  ProviderOverloadedError,
  withToolInputStatusTransitions,
} from "./runtime-loader.ts";
import { createGoogleEmbeddingRuntime, createGoogleModelRuntime } from "./runtime-loader.ts";
// createAnthropicModelRuntime has moved to ext-anthropic (PR 12, Task 7). Import
// from the extension path so cross-provider tests still exercise it.
import { createAnthropicModelRuntime } from "../../extensions/ext-anthropic/src/anthropic-provider.ts";
// createOpenAIModelRuntime has moved to ext-openai (PR 11, Task 14). Import
// from the extension path so the shared "omits provider metadata" test still
// exercises all three providers together.
import { createOpenAIModelRuntime } from "../../extensions/ext-openai/src/openai-provider.ts";

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

  // Google-only generate/stream/embedding/thought tests migrated to
  // extensions/ext-google/src/google-provider.test.ts

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
});
