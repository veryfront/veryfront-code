import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { repairToolCall } from "#veryfront/agent/runtime/repair-tool-call.ts";
import { createRuntimeJsonSchema } from "#veryfront/agent/runtime/runtime-tool-builder.ts";
import { embed, embedMany, generateText, streamText } from "./runtime-bridge.ts";
import {
  collectAsync,
  createGenerateModel,
  createStreamModel,
} from "./runtime-bridge.test-helpers.ts";

function createWebSearchTools() {
  const inputSchema = createRuntimeJsonSchema({
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
    additionalProperties: false,
  });

  return {
    inputSchema,
    tools: {
      web_search: {
        type: "provider",
        id: "anthropic.web_search_20250305",
        args: {},
        inputSchema: () => inputSchema,
      },
    },
  };
}

function getErrorName(value: unknown): string | undefined {
  return value && typeof value === "object" && "name" in value &&
      typeof value.name === "string"
    ? value.name
    : undefined;
}

type PromiseSettlement<T> =
  | { kind: "fulfilled"; value: T }
  | { kind: "rejected"; error: unknown }
  | { kind: "timeout" };

async function settleWithin<T>(
  promise: PromiseLike<T>,
  timeoutMs = 100,
): Promise<PromiseSettlement<T>> {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise).then<PromiseSettlement<T>, PromiseSettlement<T>>(
        (value) => ({ kind: "fulfilled", value }),
        (error: unknown) => ({ kind: "rejected", error }),
      ),
      new Promise<PromiseSettlement<T>>((resolve) => {
        timeout = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

describe("runtime-bridge", () => {
  it("uses the direct generate path for models without tools", async () => {
    let called = false;

    const model = createGenerateModel("test", "test/direct-generate", async (options) => {
      called = true;
      assertEquals(options.prompt, [{
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      }]);
      return {
        content: [{ type: "text", text: "World" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 3 },
          outputTokens: { total: 4 },
        },
      };
    });

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Hello" }],
      temperature: 0,
    });

    assertEquals(called, true);
    assertEquals(result.text, "World");
    assertEquals(result.finishReason, "stop");
    assertEquals(result.usage, {
      inputTokens: 3,
      outputTokens: 4,
      totalTokens: 7,
    });
  });

  it("forwards signed and redacted reasoning through the canonical prompt contract", async () => {
    const model = createGenerateModel("test", "test/reasoning-replay", async (options) => {
      assertEquals(options.prompt, [{
        role: "assistant",
        content: [
          { type: "reasoning", text: "Checked evidence.", signature: "sig_123" },
          { type: "reasoning", redactedData: "encrypted_123" },
          { type: "text", text: "Initial answer." },
        ],
      }, {
        role: "user",
        content: [{ type: "text", text: "Continue" }],
      }]);
      return {
        content: [{ type: "text", text: "Continued." }],
        finishReason: "stop",
      };
    });

    const result = await generateText({
      model,
      messages: [{
        role: "assistant",
        content: [
          { type: "reasoning", text: "Checked evidence.", signature: "sig_123" },
          { type: "reasoning", redactedData: "encrypted_123" },
          { type: "text", text: "Initial answer." },
        ],
      }, {
        role: "user",
        content: "Continue",
      }],
    });

    assertEquals(result.text, "Continued.");
  });

  it("forwards reasoning options to direct generate models", async () => {
    const model = createGenerateModel("test", "test/reasoning-generate", async (options) => {
      assertEquals(options.reasoning, { enabled: false });
      return {
        content: [{ type: "text", text: "ok" }],
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    });

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Hello" }],
      reasoning: { enabled: false },
    });

    assertEquals(result.text, "ok");
  });

  it("buffers the stream path for models that prefer streamed generate", async () => {
    let called = false;

    const model = {
      ...createStreamModel(
        "veryfront-cloud",
        "veryfront-cloud/openai/gpt-test",
        async (options) => {
          called = true;
          assertEquals(options.prompt, [{
            role: "user",
            content: [{ type: "text", text: "Hello" }],
          }]);
          return {
            stream: ReadableStream.from([
              { type: "text-delta", delta: "Hel" },
              { type: "text-delta", delta: "lo" },
              {
                type: "finish",
                finishReason: { unified: "stop", raw: "stop" },
                usage: {
                  inputTokens: { total: 2 },
                  outputTokens: { total: 5 },
                },
              },
            ]),
          };
        },
      ),
      _generateViaStream: true,
    };

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Hello" }],
      temperature: 0,
    });

    assertEquals(called, true);
    assertEquals(result.text, "Hello");
    assertEquals(result.finishReason, "stop");
    assertEquals(result.usage, {
      inputTokens: 2,
      outputTokens: 5,
      totalTokens: 7,
    });
  });

  it("buffers streamed tool calls for models that prefer streamed generate", async () => {
    const model = {
      ...createStreamModel("veryfront-cloud", "veryfront-cloud/anthropic/claude-test", async () => {
        return {
          stream: ReadableStream.from([
            { type: "tool-input-start", id: "tool-1", toolName: "search" },
            { type: "tool-input-delta", id: "tool-1", delta: '{"query":' },
            { type: "tool-input-delta", id: "tool-1", delta: '"webgpu"}' },
            { type: "tool-input-end", id: "tool-1" },
            {
              type: "finish",
              finishReason: "tool-calls",
              usage: { inputTokens: 4, outputTokens: 3 },
            },
          ]),
        };
      }),
      _generateViaStream: true,
    };

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Search" }],
      tools: {
        search: {
          description: "Search",
          inputSchema: createRuntimeJsonSchema({
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
            additionalProperties: false,
          }),
        },
      },
      temperature: 0,
    });

    assertEquals(result.finishReason, "tool-calls");
    assertEquals(result.toolCalls, [{
      toolCallId: "tool-1",
      toolName: "search",
      input: { query: "webgpu" },
    }]);
    assertEquals(result.usage, {
      inputTokens: 4,
      outputTokens: 3,
      totalTokens: 7,
    });
  });

  it("rejects buffered generation when the model stream emits an error part", async () => {
    const model = {
      ...createStreamModel("test", "test/error-stream", async () => ({
        stream: ReadableStream.from([
          { type: "text-delta", delta: "partial" },
          { type: "error", error: new Error("provider stream failed") },
        ]),
      })),
      _generateViaStream: true,
    };

    await assertRejects(
      () =>
        Promise.resolve(generateText({
          model,
          messages: [{ role: "user", content: "Hello" }],
        })),
      Error,
      "provider stream failed",
    );
  });

  it("preserves provider-executed metadata and null results while buffering a stream", async () => {
    const model = {
      ...createStreamModel("test", "test/provider-tool-stream", async () => ({
        stream: ReadableStream.from([
          {
            type: "tool-input-start",
            id: "provider-tool-1",
            toolName: "web_search",
            providerExecuted: true,
          },
          {
            type: "tool-input-delta",
            id: "provider-tool-1",
            delta: '{"query":"Veryfront"}',
          },
          { type: "tool-input-end", id: "provider-tool-1" },
          {
            type: "tool-result",
            toolCallId: "provider-tool-1",
            toolName: "web_search",
            result: null,
            providerExecuted: true,
          },
        ]),
      })),
      _generateViaStream: true,
    };

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Search" }],
      tools: {
        web_search: {
          type: "provider",
          id: "anthropic.web_search_20250305",
          args: {},
          inputSchema: () =>
            createRuntimeJsonSchema({
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
              additionalProperties: false,
            }),
        },
      },
    });

    assertEquals(result.toolCalls, [{
      toolCallId: "provider-tool-1",
      toolName: "web_search",
      input: { query: "Veryfront" },
      providerExecuted: true,
    }]);
    assertEquals(result.toolResults, [{
      toolCallId: "provider-tool-1",
      toolName: "web_search",
      result: null,
      providerExecuted: true,
    }]);
  });

  it("preserves provider-executed metadata from direct generate results", async () => {
    const model = createGenerateModel("test", "test/provider-tool-generate", async () => ({
      content: [
        {
          type: "tool-call",
          toolCallId: "provider-tool-2",
          toolName: "web_fetch",
          input: '{"url":"https://veryfront.com"}',
          providerExecuted: true,
        },
        {
          type: "tool-result",
          toolCallId: "provider-tool-2",
          toolName: "web_fetch",
          result: { status: 200 },
          providerExecuted: true,
        },
      ],
      finishReason: "stop",
    }));

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Fetch" }],
      tools: {
        web_fetch: {
          type: "provider",
          id: "anthropic.web_fetch_20250910",
          args: {},
          inputSchema: () =>
            createRuntimeJsonSchema({
              type: "object",
              properties: { url: { type: "string" } },
              required: ["url"],
              additionalProperties: false,
            }),
        },
      },
    });

    assertEquals(result.toolCalls, [{
      toolCallId: "provider-tool-2",
      toolName: "web_fetch",
      input: { url: "https://veryfront.com" },
      providerExecuted: true,
    }]);
    assertEquals(result.toolResults, [{
      toolCallId: "provider-tool-2",
      toolName: "web_fetch",
      result: { status: 200 },
      providerExecuted: true,
    }]);
  });

  it("quarantines only metadata for unpaired direct tool results when requested", async () => {
    const model = createGenerateModel("test", "test/unpaired-tool-result", async () => ({
      content: [{
        type: "tool-result",
        toolCallId: "unpaired-provider-tool",
        toolName: "web_search",
        result: { secretProviderPayload: "must-not-cross-the-runtime-boundary" },
        providerExecuted: true,
      }],
      finishReason: "stop",
    }));

    const defaultResult = await generateText({
      model,
      messages: [{ role: "user", content: "Search" }],
    });
    assertEquals(defaultResult.toolResults, undefined);
    assertEquals(defaultResult.quarantinedToolResults, undefined);

    const quarantinedResult = await generateText({
      model,
      messages: [{ role: "user", content: "Search" }],
      quarantineUnpairedToolResults: true,
    });
    assertEquals(quarantinedResult.toolResults, undefined);
    assertEquals(quarantinedResult.quarantinedToolResults, [{
      toolCallId: "unpaired-provider-tool",
      toolName: "web_search",
    }]);
    assertEquals(
      JSON.stringify(quarantinedResult).includes("must-not-cross-the-runtime-boundary"),
      false,
    );
  });

  it("bounds and deduplicates quarantined tool-result metadata", async () => {
    const longIdentifier = "x".repeat(2_048);
    const model = createGenerateModel("test", "test/bounded-tool-result-quarantine", async () => ({
      content: [
        {
          type: "tool-result" as const,
          toolCallId: longIdentifier,
          toolName: longIdentifier,
          result: "private-result",
        },
        {
          type: "tool-result" as const,
          toolCallId: longIdentifier,
          toolName: "duplicate",
          result: "private-result",
        },
        ...Array.from({ length: 130 }, (_, index) => ({
          type: "tool-result" as const,
          toolCallId: `unpaired-${index}`,
          toolName: `tool-${index}`,
          result: "private-result",
        })),
      ],
      finishReason: "stop",
    }));

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Search" }],
      quarantineUnpairedToolResults: true,
    });

    assertEquals(result.quarantinedToolResults?.length, 128);
    assertEquals(result.quarantinedToolResults?.[0]?.toolCallId.length, 1_024);
    assertEquals(result.quarantinedToolResults?.[0]?.toolName.length, 1_024);
    assertEquals(
      result.quarantinedToolResults?.some((metadata) => metadata.toolName === "duplicate"),
      false,
    );
    assertEquals(JSON.stringify(result).includes("private-result"), false);
  });

  it("quarantines unpaired results while buffering generate-via-stream", async () => {
    const model = {
      ...createStreamModel("test", "test/streamed-tool-result-quarantine", async () => ({
        stream: ReadableStream.from([
          {
            type: "tool-result",
            toolCallId: "unpaired-stream-tool",
            toolName: "web_search",
            result: { privateResult: true },
          },
          { type: "finish", finishReason: "stop" },
        ]),
      })),
      _generateViaStream: true,
    };

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Search" }],
      quarantineUnpairedToolResults: true,
    });

    assertEquals(result.toolResults, undefined);
    assertEquals(result.quarantinedToolResults, [{
      toolCallId: "unpaired-stream-tool",
      toolName: "web_search",
    }]);
    assertEquals(JSON.stringify(result).includes("privateResult"), false);
  });

  it("ignores malformed unpaired result metadata while buffering generate-via-stream", async () => {
    const model = {
      ...createStreamModel("test", "test/malformed-tool-result-quarantine", async () => ({
        stream: ReadableStream.from([
          { type: "tool-result", result: { privateResult: true } },
          {
            type: "tool-error",
            toolCallId: 42,
            toolName: null,
            error: "private-error",
          },
          { type: "finish", finishReason: "stop" },
        ]),
      })),
      _generateViaStream: true,
    };

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Search" }],
      quarantineUnpairedToolResults: true,
    });

    assertEquals(result.toolResults, undefined);
    assertEquals(result.quarantinedToolResults, undefined);
    assertEquals(JSON.stringify(result).includes("privateResult"), false);
    assertEquals(JSON.stringify(result).includes("private-error"), false);
  });

  it("uses registered function metadata instead of spoofed direct markers", async () => {
    const model = createGenerateModel("test", "test/spoofed-direct-metadata", async () => ({
      content: [
        {
          type: "tool-call",
          toolCallId: "local-direct-1",
          toolName: "local_lookup",
          input: '{"query":"Veryfront"}',
          providerExecuted: true,
          dynamic: true,
        },
        {
          type: "tool-result",
          toolCallId: "local-direct-1",
          toolName: "local_lookup",
          result: { spoofed: true },
          providerExecuted: true,
          dynamic: true,
        },
      ],
      finishReason: "stop",
    }));

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Look it up" }],
      tools: {
        local_lookup: {
          description: "Local lookup",
          inputSchema: createRuntimeJsonSchema({
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
            additionalProperties: false,
          }),
        },
      },
    });

    assertEquals(result.toolCalls, [{
      toolCallId: "local-direct-1",
      toolName: "local_lookup",
      input: { query: "Veryfront" },
    }]);
    assertEquals(result.toolResults, undefined);
  });

  it("uses registered function metadata instead of spoofed streamed markers", async () => {
    const model = createStreamModel("test", "test/spoofed-stream-metadata", async () => ({
      stream: ReadableStream.from([
        {
          type: "tool-call",
          toolCallId: "local-stream-1",
          toolName: "local_lookup",
          input: '{"query":"Veryfront"}',
          providerExecuted: true,
          dynamic: true,
        },
        {
          type: "tool-result",
          toolCallId: "local-stream-1",
          toolName: "local_lookup",
          result: { spoofed: true },
          providerExecuted: true,
          dynamic: true,
        },
        { type: "finish", finishReason: "stop" },
      ]),
    }));

    const result = streamText({
      model,
      messages: [{ role: "user", content: "Look it up" }],
      tools: {
        local_lookup: {
          description: "Local lookup",
          inputSchema: createRuntimeJsonSchema({
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
            additionalProperties: false,
          }),
        },
      },
    });

    assertEquals(await collectAsync(result.fullStream), [
      {
        type: "tool-call",
        toolCallId: "local-stream-1",
        toolName: "local_lookup",
        input: '{"query":"Veryfront"}',
      },
      { type: "finish", finishReason: "stop" },
    ]);
  });

  it("uses registered dynamic metadata instead of spoofed streamed provider markers", async () => {
    const model = createStreamModel("test", "test/spoofed-stream-dynamic", async () => ({
      stream: ReadableStream.from([
        {
          type: "tool-call",
          toolCallId: "dynamic-stream-1",
          toolName: "dynamic_lookup",
          input: '{"query":"Veryfront"}',
          providerExecuted: true,
        },
        {
          type: "tool-result",
          toolCallId: "dynamic-stream-1",
          toolName: "dynamic_lookup",
          result: { spoofed: true },
          providerExecuted: true,
        },
        { type: "finish", finishReason: "tool-calls" },
      ]),
    }));

    const result = streamText({
      model,
      messages: [{ role: "user", content: "Look it up" }],
      tools: {
        dynamic_lookup: {
          type: "dynamic",
          description: "Dynamic lookup",
          inputSchema: createRuntimeJsonSchema({
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
            additionalProperties: false,
          }),
        },
      },
    });

    assertEquals(await collectAsync(result.fullStream), [
      {
        type: "tool-call",
        toolCallId: "dynamic-stream-1",
        toolName: "dynamic_lookup",
        input: '{"query":"Veryfront"}',
        dynamic: true,
      },
      { type: "finish", finishReason: "tool-calls" },
    ]);
  });

  it("does not trust a partial provider marker on an unknown direct call", async () => {
    const model = createGenerateModel("test", "test/partial-unknown-marker", async () => ({
      content: [{
        type: "tool-call",
        toolCallId: "unknown-provider-only",
        toolName: "unknown_tool",
        input: "{}",
        providerExecuted: true,
      }],
      finishReason: "tool-calls",
    }));

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Run it" }],
    });

    assertEquals(result.toolCalls, [{
      toolCallId: "unknown-provider-only",
      toolName: "unknown_tool",
      input: {},
    }]);
    assertEquals(getErrorName(result.toolResults?.[0]?.result), "AI_NoSuchToolError");
    assertEquals(result.toolResults?.[0]?.providerExecuted, undefined);
    assertEquals(result.toolResults?.[0]?.dynamic, undefined);
  });

  it("uses the direct stream path for models without tools", async () => {
    const model = createStreamModel("test", "test/direct-stream", async (options) => {
      assertEquals(options.prompt, [{
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      }]);
      return {
        stream: ReadableStream.from([
          { type: "text-delta", delta: "Hel" },
          { type: "text-delta", delta: "lo" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: { total: 2 },
              outputTokens: { total: 5, reasoning: 3 },
            },
          },
        ]),
      };
    });

    const result = streamText({
      model,
      messages: [{ role: "user", content: "Hello" }],
      temperature: 0,
    });

    const [textDeltas, fullStreamParts] = await Promise.all([
      collectAsync(result.textStream),
      collectAsync(result.fullStream),
    ]);

    assertEquals(textDeltas, ["Hel", "lo"]);
    assertEquals(fullStreamParts, [
      { type: "text-delta", text: "Hel" },
      { type: "text-delta", text: "lo" },
      {
        type: "finish",
        finishReason: "stop",
        totalUsage: {
          inputTokens: 2,
          outputTokens: 5,
          reasoningTokens: 3,
        },
      },
    ]);
  });

  it("rejects a second stream view started after direct consumption", async () => {
    const model = createStreamModel("test", "test/late-second-stream", async () => ({
      stream: ReadableStream.from([
        { type: "text-delta", delta: "Hel" },
        { type: "text-delta", delta: "lo" },
      ]),
    }));
    const result = streamText({
      model,
      messages: [{ role: "user", content: "Hello" }],
    });

    const fullIterator = result.fullStream[Symbol.asyncIterator]();
    assertEquals(await fullIterator.next(), {
      value: { type: "text-delta", text: "Hel" },
      done: false,
    });
    await assertRejects(
      () => collectAsync(result.textStream),
      Error,
      "must start consumption concurrently",
    );
    await fullIterator.return?.();
  });

  it("cancels a sole stream consumer without waiting for an unused branch", async () => {
    let cancelled = false;
    const model = createStreamModel("test", "test/sole-stream-cancel", async () => ({
      stream: new ReadableStream({
        pull(controller) {
          controller.enqueue({ type: "text-delta", delta: "chunk" });
        },
        cancel() {
          cancelled = true;
        },
      }),
    }));
    const result = streamText({
      model,
      messages: [{ role: "user", content: "Hello" }],
    });

    for await (const _part of result.fullStream) break;

    assertEquals(cancelled, true);
  });

  it("handles an abandoned stream request rejection", async () => {
    let called = false;
    const model = createStreamModel("test", "test/abandoned-stream", async () => {
      called = true;
      throw new Error("stream failed");
    });

    streamText({
      model,
      messages: [{ role: "user", content: "Hello" }],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assertEquals(called, true);
  });

  it("forwards reasoning options to direct stream models", async () => {
    const model = createStreamModel("test", "test/reasoning-stream", async (options) => {
      assertEquals(options.reasoning, { enabled: true, budgetTokens: 2048 });
      return {
        stream: ReadableStream.from([
          { type: "text-delta", delta: "ok" },
          { type: "finish", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1 } },
        ]),
      };
    });

    const result = streamText({
      model,
      messages: [{ role: "user", content: "Hello" }],
      reasoning: { enabled: true, budgetTokens: 2048 },
    });

    assertEquals(await collectAsync(result.textStream), ["ok"]);
  });

  it("uses the direct generate path for ordinary function tools", async () => {
    let called = false;

    const model = createGenerateModel("test", "test/direct-generate-tools", async (options) => {
      called = true;
      assertEquals(options.prompt, [{
        role: "user",
        content: [{ type: "text", text: "Check weather" }],
      }]);
      assertEquals(options.tools, [{
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
      }]);
      return {
        content: [{
          type: "tool-call",
          toolCallId: "tool-1",
          toolName: "weather",
          input: '{"city":"Tokyo"}',
        }],
        finishReason: { unified: "tool-calls", raw: "tool_use" },
        usage: {
          inputTokens: { total: 8 },
          outputTokens: { total: 2 },
        },
      };
    });

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Check weather" }],
      tools: {
        weather: {
          description: "Get the weather",
          inputSchema: createRuntimeJsonSchema({
            type: "object",
            properties: {
              city: { type: "string" },
            },
            required: ["city"],
            additionalProperties: false,
          }),
        },
      },
      temperature: 0,
    });

    assertEquals(called, true);
    assertEquals(result.text, "");
    assertEquals(result.finishReason, "tool-calls");
    assertEquals(result.toolCalls, [{
      toolCallId: "tool-1",
      toolName: "weather",
      input: { city: "Tokyo" },
    }]);
  });

  it("uses the direct stream path for ordinary function tools", async () => {
    const model = createStreamModel("test", "test/direct-stream-tools", async (options) => {
      assertEquals(options.prompt, [{
        role: "user",
        content: [{ type: "text", text: "Check weather" }],
      }]);
      assertEquals(options.tools, [{
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
      }]);
      return {
        stream: ReadableStream.from([
          { type: "tool-input-start", id: "tool-1", toolName: "weather" },
          { type: "tool-input-delta", id: "tool-1", delta: '{"city":' },
          { type: "tool-input-delta", id: "tool-1", delta: '"Tokyo"}' },
          {
            type: "tool-call",
            toolCallId: "tool-1",
            toolName: "weather",
            input: '{"city":"Tokyo"}',
          },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: "tool_use" },
            usage: {
              inputTokens: { total: 8 },
              outputTokens: { total: 2 },
            },
          },
        ]),
      };
    });

    const result = streamText({
      model,
      messages: [{ role: "user", content: "Check weather" }],
      tools: {
        weather: {
          description: "Get the weather",
          inputSchema: createRuntimeJsonSchema({
            type: "object",
            properties: {
              city: { type: "string" },
            },
            required: ["city"],
            additionalProperties: false,
          }),
        },
      },
      temperature: 0,
    });

    const [textDeltas, fullStreamParts] = await Promise.all([
      collectAsync(result.textStream),
      collectAsync(result.fullStream),
    ]);

    assertEquals(textDeltas, []);
    assertEquals(fullStreamParts, [
      { type: "tool-input-start", id: "tool-1", toolName: "weather" },
      { type: "tool-input-delta", id: "tool-1", delta: '{"city":' },
      { type: "tool-input-delta", id: "tool-1", delta: '"Tokyo"}' },
      { type: "tool-input-end", id: "tool-1" },
      {
        type: "tool-call",
        toolCallId: "tool-1",
        toolName: "weather",
        input: '{"city":"Tokyo"}',
      },
      {
        type: "finish",
        finishReason: "tool-calls",
        totalUsage: {
          inputTokens: 8,
          outputTokens: 2,
        },
      },
    ]);
  });

  it("uses the direct stream path for provider-native tools", async () => {
    const model = createStreamModel(
      "anthropic",
      "anthropic/test-direct-provider-tools",
      async (options) => {
        assertEquals(options.prompt, [{
          role: "user",
          content: [{ type: "text", text: "Research Veryfront" }],
        }]);
        assertEquals(options.tools, [{
          type: "provider",
          name: "web_search",
          id: "anthropic.web_search_20250305",
          args: {
            maxUses: 5,
          },
        }]);

        return {
          stream: ReadableStream.from([
            {
              type: "tool-call",
              toolCallId: "tool-web-1",
              toolName: "web_search",
              input: '{"query":"Veryfront"}',
              providerExecuted: true,
              dynamic: true,
            },
            {
              type: "tool-result",
              toolCallId: "tool-web-1",
              toolName: "web_search",
              result: [{
                url: "https://veryfront.com",
                title: "Veryfront",
                pageAge: null,
                encryptedContent: "opaque",
                type: "web_search_result",
              }],
              providerExecuted: true,
              dynamic: true,
            },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: { total: 6 },
                outputTokens: { total: 9 },
              },
            },
          ]),
        };
      },
    );

    const result = streamText({
      model,
      messages: [{ role: "user", content: "Research Veryfront" }],
      tools: {
        web_search: {
          type: "provider",
          id: "anthropic.web_search_20250305",
          args: {
            maxUses: 5,
          },
          inputSchema: () =>
            createRuntimeJsonSchema({
              type: "object",
              properties: {
                query: { type: "string" },
              },
              required: ["query"],
              additionalProperties: false,
            }),
          outputSchema: () => createRuntimeJsonSchema({ type: "array" }),
          supportsDeferredResults: true,
        },
      },
      temperature: 0,
    });

    const [textDeltas, fullStreamParts] = await Promise.all([
      collectAsync(result.textStream),
      collectAsync(result.fullStream),
    ]);

    assertEquals(textDeltas, []);
    assertEquals(fullStreamParts, [
      {
        type: "tool-call",
        toolCallId: "tool-web-1",
        toolName: "web_search",
        input: '{"query":"Veryfront"}',
        providerExecuted: true,
        supportsDeferredResults: true,
      },
      {
        type: "tool-result",
        toolCallId: "tool-web-1",
        toolName: "web_search",
        result: [{
          url: "https://veryfront.com",
          title: "Veryfront",
          pageAge: null,
          encryptedContent: "opaque",
          type: "web_search_result",
        }],
        providerExecuted: true,
        supportsDeferredResults: true,
      },
      {
        type: "finish",
        finishReason: "stop",
        totalUsage: {
          inputTokens: 6,
          outputTokens: 9,
        },
      },
    ]);
  });

  it("uses the direct generate path for provider-native tools", async () => {
    const model = createGenerateModel(
      "anthropic",
      "anthropic/test-direct-provider-generate",
      async (options) => {
        assertEquals(options.prompt, [{
          role: "user",
          content: [{ type: "text", text: "Research Veryfront" }],
        }]);
        assertEquals(options.tools, [{
          type: "provider",
          name: "web_search",
          id: "anthropic.web_search_20250305",
          args: {
            maxUses: 5,
          },
        }]);

        return {
          content: [
            {
              type: "tool-call",
              toolCallId: "tool-web-2",
              toolName: "web_search",
              input: '{"query":"Veryfront"}',
              dynamic: true,
            },
            {
              type: "tool-result",
              toolCallId: "tool-web-2",
              toolName: "web_search",
              result: [{
                url: "https://veryfront.com",
                title: "Veryfront",
                pageAge: null,
                encryptedContent: "opaque",
                type: "web_search_result",
              }],
              dynamic: true,
            },
          ],
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 6 },
            outputTokens: { total: 9 },
          },
        };
      },
    );

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Research Veryfront" }],
      tools: {
        web_search: {
          type: "provider",
          id: "anthropic.web_search_20250305",
          args: {
            maxUses: 5,
          },
          inputSchema: () =>
            createRuntimeJsonSchema({
              type: "object",
              properties: {
                query: { type: "string" },
              },
              required: ["query"],
              additionalProperties: false,
            }),
          outputSchema: () => createRuntimeJsonSchema({ type: "array" }),
          supportsDeferredResults: true,
        },
      },
      temperature: 0,
    });

    assertEquals(result.text, "");
    assertEquals(result.finishReason, "stop");
    assertEquals(result.toolCalls, [{
      toolCallId: "tool-web-2",
      toolName: "web_search",
      input: { query: "Veryfront" },
      providerExecuted: true,
      supportsDeferredResults: true,
    }]);
    assertEquals(result.toolResults, [{
      toolCallId: "tool-web-2",
      toolName: "web_search",
      result: [{
        url: "https://veryfront.com",
        title: "Veryfront",
        pageAge: null,
        encryptedContent: "opaque",
        type: "web_search_result",
      }],
      providerExecuted: true,
      supportsDeferredResults: true,
    }]);
  });

  it("uses the direct stream path for provider-native web_fetch", async () => {
    const model = createStreamModel(
      "anthropic",
      "anthropic/test-direct-provider-web-fetch-stream",
      async (options) => {
        assertEquals(options.prompt, [{
          role: "user",
          content: [{ type: "text", text: "Fetch the docs page" }],
        }]);
        assertEquals(options.tools, [{
          type: "provider",
          name: "web_fetch",
          id: "anthropic.web_fetch_20250910",
          args: {},
        }]);

        return {
          stream: ReadableStream.from([
            {
              type: "tool-call",
              toolCallId: "tool-fetch-1",
              toolName: "web_fetch",
              input: '{"url":"https://veryfront.com/docs"}',
              providerExecuted: true,
            },
            {
              type: "tool-result",
              toolCallId: "tool-fetch-1",
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
                retrievedAt: null,
              },
              providerExecuted: true,
            },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: { total: 5 },
                outputTokens: { total: 8 },
              },
            },
          ]),
        };
      },
    );

    const result = streamText({
      model,
      messages: [{ role: "user", content: "Fetch the docs page" }],
      tools: {
        web_fetch: {
          type: "provider",
          id: "anthropic.web_fetch_20250910",
          args: {},
          inputSchema: () =>
            createRuntimeJsonSchema({
              type: "object",
              properties: {
                url: { type: "string" },
              },
              required: ["url"],
              additionalProperties: false,
            }),
          outputSchema: () => createRuntimeJsonSchema({ type: "object" }),
          supportsDeferredResults: true,
        },
      },
      temperature: 0,
    });

    const [textDeltas, fullStreamParts] = await Promise.all([
      collectAsync(result.textStream),
      collectAsync(result.fullStream),
    ]);

    assertEquals(textDeltas, []);
    assertEquals(fullStreamParts, [
      {
        type: "tool-call",
        toolCallId: "tool-fetch-1",
        toolName: "web_fetch",
        input: '{"url":"https://veryfront.com/docs"}',
        providerExecuted: true,
        supportsDeferredResults: true,
      },
      {
        type: "tool-result",
        toolCallId: "tool-fetch-1",
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
          retrievedAt: null,
        },
        providerExecuted: true,
        supportsDeferredResults: true,
      },
      {
        type: "finish",
        finishReason: "stop",
        totalUsage: {
          inputTokens: 5,
          outputTokens: 8,
        },
      },
    ]);
  });

  it("uses the direct generate path for provider-native web_fetch", async () => {
    const model = createGenerateModel(
      "anthropic",
      "anthropic/test-direct-provider-web-fetch-generate",
      async (options) => {
        assertEquals(options.prompt, [{
          role: "user",
          content: [{ type: "text", text: "Fetch the docs page" }],
        }]);
        assertEquals(options.tools, [{
          type: "provider",
          name: "web_fetch",
          id: "anthropic.web_fetch_20250910",
          args: {},
        }]);

        return {
          content: [
            {
              type: "tool-call",
              toolCallId: "tool-fetch-2",
              toolName: "web_fetch",
              input: '{"url":"https://veryfront.com/docs"}',
            },
            {
              type: "tool-result",
              toolCallId: "tool-fetch-2",
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
                retrievedAt: null,
              },
            },
          ],
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 4 },
            outputTokens: { total: 6 },
          },
        };
      },
    );

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Fetch the docs page" }],
      tools: {
        web_fetch: {
          type: "provider",
          id: "anthropic.web_fetch_20250910",
          args: {},
          inputSchema: () =>
            createRuntimeJsonSchema({
              type: "object",
              properties: {
                url: { type: "string" },
              },
              required: ["url"],
              additionalProperties: false,
            }),
          outputSchema: () => createRuntimeJsonSchema({ type: "object" }),
          supportsDeferredResults: true,
        },
      },
      temperature: 0,
    });

    assertEquals(result.text, "");
    assertEquals(result.finishReason, "stop");
    assertEquals(result.toolCalls, [{
      toolCallId: "tool-fetch-2",
      toolName: "web_fetch",
      input: { url: "https://veryfront.com/docs" },
      providerExecuted: true,
      supportsDeferredResults: true,
    }]);
    assertEquals(result.toolResults, [{
      toolCallId: "tool-fetch-2",
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
        retrievedAt: null,
      },
      providerExecuted: true,
      supportsDeferredResults: true,
    }]);
  });

  it("does not invoke tool-call repair for a valid direct call", async () => {
    const { tools } = createWebSearchTools();
    let repairCalls = 0;
    const model = createGenerateModel("test", "test/valid-tool-call", async () => ({
      content: [{
        type: "tool-call",
        toolCallId: "valid-web-search",
        toolName: "web_search",
        input: '{"query":"Veryfront"}',
      }],
      finishReason: "tool-calls",
    }));

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Search for Veryfront" }],
      tools,
      experimental_repairToolCall: () => {
        repairCalls += 1;
        return null;
      },
    });

    assertEquals(repairCalls, 0);
    assertEquals(result.toolCalls, [{
      toolCallId: "valid-web-search",
      toolName: "web_search",
      input: { query: "Veryfront" },
      providerExecuted: true,
    }]);
    assertEquals(result.toolResults?.length, 1);
    assertEquals(getErrorName(result.toolResults?.[0]?.result), "AI_MissingToolResultError");
    assertEquals(result.toolResults?.[0]?.isError, true);
    assertEquals(result.toolResults?.[0]?.providerExecuted, true);
  });

  it("repairs malformed provider tool input in direct generation", async () => {
    const { inputSchema, tools } = createWebSearchTools();
    let repairCalls = 0;
    const model = createGenerateModel("test", "test/repair-direct-tool-call", async () => ({
      content: [{
        type: "tool-call",
        toolCallId: "repair-direct",
        toolName: "web_search",
        input: "Veryfront",
      }],
      finishReason: "tool-calls",
    }));

    const result = await generateText({
      model,
      system: { content: "Use provider search." },
      messages: [{ role: "user", content: "Search for Veryfront" }],
      tools,
      experimental_repairToolCall: async (context) => {
        repairCalls += 1;
        assertEquals(context.system, "Use provider search.");
        assertEquals(context.messages, [{ role: "user", content: "Search for Veryfront" }]);
        assertEquals(context.tools === tools, true);
        assertEquals(
          await context.inputSchema({ toolName: "web_search" }),
          inputSchema.jsonSchema,
        );
        return repairToolCall(context);
      },
    });

    assertEquals(repairCalls, 1);
    assertEquals(result.toolCalls, [{
      toolCallId: "repair-direct",
      toolName: "web_search",
      input: { query: "Veryfront" },
      providerExecuted: true,
    }]);
    assertEquals(result.toolResults?.length, 1);
    assertEquals(getErrorName(result.toolResults?.[0]?.result), "AI_MissingToolResultError");
    assertEquals(result.toolResults?.[0]?.isError, true);
    assertEquals(result.toolResults?.[0]?.providerExecuted, true);
  });

  it("repairs malformed provider tool input while buffering generate-via-stream", async () => {
    const { tools } = createWebSearchTools();
    let repairCalls = 0;
    const model = {
      ...createStreamModel("test", "test/repair-buffered-tool-call", async () => ({
        stream: ReadableStream.from([
          {
            type: "tool-input-start",
            id: "repair-buffered",
            toolName: "web_search",
          },
          { type: "tool-input-delta", id: "repair-buffered", delta: "Veryfront" },
          { type: "tool-input-end", id: "repair-buffered" },
          { type: "finish", finishReason: "tool-calls" },
        ]),
      })),
      _generateViaStream: true,
    };

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Search for Veryfront" }],
      tools,
      experimental_repairToolCall: (context) => {
        repairCalls += 1;
        return repairToolCall(context);
      },
    });

    assertEquals(repairCalls, 1);
    assertEquals(result.toolCalls, [{
      toolCallId: "repair-buffered",
      toolName: "web_search",
      input: { query: "Veryfront" },
      providerExecuted: true,
    }]);
    assertEquals(result.toolResults?.length, 1);
    assertEquals(getErrorName(result.toolResults?.[0]?.result), "AI_MissingToolResultError");
    assertEquals(result.toolResults?.[0]?.isError, true);
    assertEquals(result.toolResults?.[0]?.providerExecuted, true);
  });

  it("repairs and deduplicates end-plus-final provider calls in a live stream", async () => {
    const { tools } = createWebSearchTools();
    let repairCalls = 0;
    const model = createStreamModel("test", "test/repair-live-tool-call", async () => ({
      stream: ReadableStream.from([
        {
          type: "tool-input-start",
          id: "repair-live",
          toolName: "web_search",
        },
        { type: "tool-input-delta", id: "repair-live", delta: "Veryfront" },
        { type: "tool-input-end", id: "repair-live" },
        {
          type: "tool-call",
          toolCallId: "repair-live",
          toolName: "web_search",
          input: "{}",
        },
        { type: "finish", finishReason: "tool-calls" },
      ]),
    }));

    const result = streamText({
      model,
      messages: [{ role: "user", content: "Search for Veryfront" }],
      tools,
      experimental_repairToolCall: (context) => {
        repairCalls += 1;
        return repairToolCall(context);
      },
    });
    const parts = await collectAsync(result.fullStream);

    assertEquals(repairCalls, 1);
    assertEquals(parts.slice(0, 4), [
      {
        type: "tool-input-start",
        id: "repair-live",
        toolName: "web_search",
        providerExecuted: true,
      },
      {
        type: "tool-input-delta",
        id: "repair-live",
        delta: '{"query":"Veryfront"}',
      },
      { type: "tool-input-end", id: "repair-live" },
      {
        type: "tool-call",
        toolCallId: "repair-live",
        toolName: "web_search",
        input: '{"query":"Veryfront"}',
        providerExecuted: true,
      },
    ]);
    const missingResult = parts[4] as {
      type?: unknown;
      toolCallId?: unknown;
      toolName?: unknown;
      error?: unknown;
      isError?: unknown;
      providerExecuted?: unknown;
    };
    assertEquals(missingResult.type, "tool-error");
    assertEquals(missingResult.toolCallId, "repair-live");
    assertEquals(missingResult.toolName, "web_search");
    assertEquals(getErrorName(missingResult.error), "AI_MissingToolResultError");
    assertEquals(missingResult.isError, true);
    assertEquals(missingResult.providerExecuted, true);
    assertEquals(parts[5], { type: "finish", finishReason: "tool-calls" });
  });

  it("emits one terminal live-stream error and suppresses a later provider result", async () => {
    const { tools } = createWebSearchTools();
    let originalError: unknown;
    const model = createStreamModel("test", "test/invalid-live-tool-call", async () => ({
      stream: ReadableStream.from([
        {
          type: "tool-call",
          toolCallId: "invalid-live",
          toolName: "web_search",
          input: "Veryfront",
        },
        {
          type: "tool-result",
          toolCallId: "invalid-live",
          toolName: "web_search",
          result: { shouldNotOverwrite: true },
        },
        { type: "finish", finishReason: "tool-calls" },
      ]),
    }));

    const result = streamText({
      model,
      messages: [{ role: "user", content: "Search" }],
      tools,
      experimental_repairToolCall: (context) => {
        originalError = context.error;
        return null;
      },
    });
    const parts = await collectAsync(result.fullStream);
    const terminalError = parts[0] as {
      type?: unknown;
      toolCallId?: unknown;
      error?: unknown;
      isError?: unknown;
      providerExecuted?: unknown;
    };

    assertEquals(parts.length, 2);
    assertEquals(terminalError.type, "tool-error");
    assertEquals(terminalError.toolCallId, "invalid-live");
    assertEquals(terminalError.error === originalError, true);
    assertEquals(terminalError.isError, true);
    assertEquals(terminalError.providerExecuted, true);
    assertEquals(parts[1], { type: "finish", finishReason: "tool-calls" });
  });

  it("keeps streamed provider results correlated after repairing a missing tool name", async () => {
    const { tools } = createWebSearchTools();
    const model = createStreamModel("test", "test/repair-live-tool-name", async () => ({
      stream: ReadableStream.from([
        {
          type: "tool-call",
          toolCallId: "repair-live-name",
          toolName: "search_the_web",
          input: '{"query":"Veryfront"}',
        },
        {
          type: "tool-result",
          toolCallId: "repair-live-name",
          toolName: "search_the_web",
          result: { matches: 1 },
        },
        { type: "finish", finishReason: "tool-calls" },
      ]),
    }));

    const result = streamText({
      model,
      messages: [{ role: "user", content: "Search" }],
      tools,
      experimental_repairToolCall: (context) => ({
        ...context.toolCall,
        toolName: "web_search",
      }),
    });

    assertEquals(await collectAsync(result.fullStream), [
      {
        type: "tool-call",
        toolCallId: "repair-live-name",
        toolName: "web_search",
        input: '{"query":"Veryfront"}',
        providerExecuted: true,
      },
      {
        type: "tool-result",
        toolCallId: "repair-live-name",
        toolName: "web_search",
        result: { matches: 1 },
        providerExecuted: true,
      },
      { type: "finish", finishReason: "tool-calls" },
    ]);
  });

  it("buffers provisional stream input and emits one repaired canonical lifecycle", async () => {
    const { tools } = createWebSearchTools();
    const model = createStreamModel("test", "test/repair-streamed-lifecycle", async () => ({
      stream: ReadableStream.from([
        {
          type: "tool-input-start",
          id: "repair-lifecycle",
          toolName: "search_the_web",
        },
        {
          type: "tool-input-delta",
          id: "repair-lifecycle",
          delta: '{"query":"Veryfront"}',
        },
        { type: "tool-input-end", id: "repair-lifecycle" },
        {
          type: "tool-call",
          toolCallId: "repair-lifecycle",
          toolName: "search_the_web",
          input: "{}",
        },
        {
          type: "tool-result",
          toolCallId: "repair-lifecycle",
          toolName: "search_the_web",
          result: { matches: 1 },
        },
        { type: "finish", finishReason: "stop" },
      ]),
    }));

    const result = streamText({
      model,
      messages: [{ role: "user", content: "Search" }],
      tools,
      experimental_repairToolCall: (context) => ({
        ...context.toolCall,
        toolName: "web_search",
      }),
    });

    assertEquals(await collectAsync(result.fullStream), [
      {
        type: "tool-input-start",
        id: "repair-lifecycle",
        toolName: "web_search",
        providerExecuted: true,
      },
      {
        type: "tool-input-delta",
        id: "repair-lifecycle",
        delta: '{"query":"Veryfront"}',
      },
      { type: "tool-input-end", id: "repair-lifecycle" },
      {
        type: "tool-call",
        toolCallId: "repair-lifecycle",
        toolName: "web_search",
        input: '{"query":"Veryfront"}',
        providerExecuted: true,
      },
      {
        type: "tool-result",
        toolCallId: "repair-lifecycle",
        toolName: "web_search",
        result: { matches: 1 },
        providerExecuted: true,
      },
      { type: "finish", finishReason: "stop" },
    ]);
  });

  it("preserves an incomplete canonical lifecycle without fabricating a tool call", async () => {
    const model = createStreamModel("test", "test/incomplete-streamed-lifecycle", async () => ({
      stream: ReadableStream.from([
        {
          type: "tool-input-start",
          id: "incomplete-lifecycle",
          toolName: "weather",
          providerExecuted: true,
          dynamic: true,
        },
        {
          type: "tool-input-delta",
          id: "incomplete-lifecycle",
          delta: '{"city":"Tok',
        },
        { type: "finish", finishReason: "length" },
      ]),
    }));

    const result = streamText({
      model,
      messages: [{ role: "user", content: "Check weather" }],
      tools: {
        weather: {
          description: "Get the weather",
          inputSchema: createRuntimeJsonSchema({
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"],
            additionalProperties: false,
          }),
        },
      },
    });

    assertEquals(await collectAsync(result.fullStream), [
      {
        type: "tool-input-start",
        id: "incomplete-lifecycle",
        toolName: "weather",
      },
      {
        type: "tool-input-delta",
        id: "incomplete-lifecycle",
        delta: '{"city":"Tok',
      },
      { type: "finish", finishReason: "length" },
    ]);
  });

  it("preserves the original validation error when repair declines", async () => {
    const { tools } = createWebSearchTools();
    let originalError: unknown;
    const model = createGenerateModel("test", "test/repair-null", async () => ({
      content: [
        {
          type: "tool-call",
          toolCallId: "repair-null",
          toolName: "web_search",
          input: "Veryfront",
        },
        {
          type: "tool-result",
          toolCallId: "repair-null",
          toolName: "web_search",
          result: { shouldNotOverwrite: true },
        },
      ],
      finishReason: "tool-calls",
    }));

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Search" }],
      tools,
      experimental_repairToolCall: (context) => {
        originalError = context.error;
        return null;
      },
    });

    assertEquals(getErrorName(originalError), "AI_InvalidToolInputError");
    assertEquals(result.toolCalls, [{
      toolCallId: "repair-null",
      toolName: "web_search",
      input: "Veryfront",
      providerExecuted: true,
    }]);
    assertEquals(result.toolResults?.length, 1);
    assertEquals(result.toolResults?.[0]?.result === originalError, true);
    assertEquals(result.toolResults?.[0]?.isError, true);
    assertEquals(result.toolResults?.[0]?.providerExecuted, true);
  });

  it("wraps a thrown repair callback in a correlated repair error", async () => {
    const { tools } = createWebSearchTools();
    const callbackError = new Error("repair service unavailable");
    let originalError: unknown;
    const model = createGenerateModel("test", "test/repair-throw", async () => ({
      content: [{
        type: "tool-call",
        toolCallId: "repair-throw",
        toolName: "web_search",
        input: "Veryfront",
      }],
      finishReason: "tool-calls",
    }));

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Search" }],
      tools,
      experimental_repairToolCall: (context) => {
        originalError = context.error;
        throw callbackError;
      },
    });
    const repairError = result.toolResults?.[0]?.result;

    assertEquals(getErrorName(repairError), "AI_ToolCallRepairError");
    assertEquals(
      (repairError as { originalError?: unknown } | undefined)?.originalError === originalError,
      true,
    );
    assertEquals((repairError as Error | undefined)?.cause === callbackError, true);
    assertEquals(result.toolResults?.[0]?.isError, true);
  });

  it("wraps an invalid repair callback result in a correlated repair error", async () => {
    const { tools } = createWebSearchTools();
    const model = createGenerateModel("test", "test/repair-invalid-result", async () => ({
      content: [{
        type: "tool-call",
        toolCallId: "repair-invalid-result",
        toolName: "web_search",
        input: "Veryfront",
      }],
      finishReason: "tool-calls",
    }));

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Search" }],
      tools,
      experimental_repairToolCall: () => undefined as never,
    });

    assertEquals(getErrorName(result.toolResults?.[0]?.result), "AI_ToolCallRepairError");
    assertEquals(result.toolResults?.[0]?.isError, true);
  });

  it("revalidates a repaired call once without recursively repairing it", async () => {
    const { tools } = createWebSearchTools();
    let repairCalls = 0;
    const model = createGenerateModel("test", "test/repair-revalidation", async () => ({
      content: [{
        type: "tool-call",
        toolCallId: "repair-invalid-output",
        toolName: "web_search",
        input: "Veryfront",
      }],
      finishReason: "tool-calls",
    }));

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Search" }],
      tools,
      experimental_repairToolCall: (context) => {
        repairCalls += 1;
        return { ...context.toolCall, input: '{"query":42}' };
      },
    });

    assertEquals(repairCalls, 1);
    assertEquals(getErrorName(result.toolResults?.[0]?.result), "AI_InvalidToolInputError");
    assertEquals(result.toolResults?.[0]?.isError, true);
  });

  it("emits a correlated terminal error for a missing tool", async () => {
    const model = createGenerateModel("test", "test/missing-tool", async () => ({
      content: [{
        type: "tool-call",
        toolCallId: "missing-tool",
        toolName: "not_registered",
        input: "{}",
      }],
      finishReason: "tool-calls",
    }));

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Call it" }],
    });

    assertEquals(result.toolCalls, [{
      toolCallId: "missing-tool",
      toolName: "not_registered",
      input: {},
    }]);
    assertEquals(getErrorName(result.toolResults?.[0]?.result), "AI_NoSuchToolError");
    assertEquals(result.toolResults?.[0]?.toolCallId, "missing-tool");
    assertEquals(result.toolResults?.[0]?.isError, true);
  });

  it("repairs a missing tool name and revalidates against the resolved schema", async () => {
    const { tools } = createWebSearchTools();
    let repairCalls = 0;
    const model = createGenerateModel("test", "test/repair-missing-tool", async () => ({
      content: [
        {
          type: "tool-call",
          toolCallId: "repair-missing-tool",
          toolName: "search_the_web",
          input: '{"query":"Veryfront"}',
        },
        {
          type: "tool-result",
          toolCallId: "repair-missing-tool",
          toolName: "search_the_web",
          result: { matches: 1 },
        },
      ],
      finishReason: "tool-calls",
    }));

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Search" }],
      tools,
      experimental_repairToolCall: (context) => {
        repairCalls += 1;
        assertEquals(getErrorName(context.error), "AI_NoSuchToolError");
        return { ...context.toolCall, toolName: "web_search" };
      },
    });

    assertEquals(repairCalls, 1);
    assertEquals(result.toolCalls, [{
      toolCallId: "repair-missing-tool",
      toolName: "web_search",
      input: { query: "Veryfront" },
      providerExecuted: true,
    }]);
    assertEquals(result.toolResults, [{
      toolCallId: "repair-missing-tool",
      toolName: "web_search",
      result: { matches: 1 },
      providerExecuted: true,
    }]);
  });

  it("accepts provider-executed dynamic calls that have no client-side definition", async () => {
    const model = createGenerateModel("test", "test/provider-dynamic-tool", async () => ({
      content: [{
        type: "tool-call",
        toolCallId: "provider-dynamic-tool",
        toolName: "provider_generated_tool",
        input: '{"value":7}',
        providerExecuted: true,
        dynamic: true,
      }],
      finishReason: "tool-calls",
    }));

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Run the generated tool" }],
    });

    assertEquals(result.toolCalls, [{
      toolCallId: "provider-dynamic-tool",
      toolName: "provider_generated_tool",
      input: { value: 7 },
      providerExecuted: true,
      dynamic: true,
    }]);
    assertEquals(result.toolResults?.length, 1);
    assertEquals(getErrorName(result.toolResults?.[0]?.result), "AI_MissingToolResultError");
    assertEquals(result.toolResults?.[0]?.isError, true);
    assertEquals(result.toolResults?.[0]?.providerExecuted, true);
    assertEquals(result.toolResults?.[0]?.dynamic, true);
  });

  it("lets abort win while awaiting asynchronous repair", async () => {
    const { tools } = createWebSearchTools();
    const enteredRepair = Promise.withResolvers<void>();
    const releaseRepair = Promise.withResolvers<void>();
    const controller = new AbortController();
    const model = createGenerateModel("test", "test/repair-abort", async () => ({
      content: [{
        type: "tool-call",
        toolCallId: "repair-abort",
        toolName: "web_search",
        input: "Veryfront",
      }],
      finishReason: "tool-calls",
    }));

    const generation = Promise.resolve(generateText({
      model,
      messages: [{ role: "user", content: "Search" }],
      tools,
      abortSignal: controller.signal,
      experimental_repairToolCall: async (context) => {
        enteredRepair.resolve();
        await releaseRepair.promise;
        return repairToolCall(context);
      },
    }));

    await enteredRepair.promise;
    controller.abort();
    const error = await assertRejects(() => generation);
    releaseRepair.resolve();

    assertEquals(getErrorName(error), "AbortError");
  });

  it("lets abort win while a lazy provider input schema is materializing", async () => {
    const enteredSchema = Promise.withResolvers<void>();
    const releaseSchema = Promise.withResolvers<ReturnType<typeof createRuntimeJsonSchema>>();
    const controller = new AbortController();
    const model = createGenerateModel("test", "test/schema-materialization-abort", async () => ({
      content: [{ type: "text", text: "model must not be reached before abort" }],
      finishReason: "stop",
    }));

    const generation = Promise.resolve(generateText({
      model,
      messages: [{ role: "user", content: "Search" }],
      tools: {
        web_search: {
          type: "provider",
          id: "anthropic.web_search_20250305",
          args: {},
          inputSchema: () => {
            enteredSchema.resolve();
            return releaseSchema.promise;
          },
        },
      },
      abortSignal: controller.signal,
    }));

    await enteredSchema.promise;
    controller.abort("schema materialization cancelled");
    const settlement = await settleWithin(generation);
    releaseSchema.resolve(createRuntimeJsonSchema({ type: "object" }));

    assertEquals(settlement.kind, "rejected");
    assertEquals(
      settlement.kind === "rejected" ? getErrorName(settlement.error) : undefined,
      "AbortError",
    );
  });

  it("lets abort win while nested JSON Schema materialization is pending", async () => {
    const enteredSchema = Promise.withResolvers<void>();
    const releaseJsonSchema = Promise.withResolvers<Record<string, unknown>>();
    const controller = new AbortController();
    let modelCalls = 0;
    const model = createGenerateModel("test", "test/nested-schema-abort", async () => {
      modelCalls += 1;
      return { content: [{ type: "text", text: "unreachable" }], finishReason: "stop" };
    });

    const generation = Promise.resolve(generateText({
      model,
      messages: [{ role: "user", content: "Search" }],
      tools: {
        search: {
          description: "Search",
          inputSchema: {
            get jsonSchema() {
              enteredSchema.resolve();
              return releaseJsonSchema.promise;
            },
            validate: (input: unknown) => ({ success: true as const, value: input }),
          },
        },
      },
      abortSignal: controller.signal,
    }));

    await enteredSchema.promise;
    controller.abort("nested schema materialization cancelled");
    const settlement = await settleWithin(generation);
    releaseJsonSchema.resolve({ type: "object" });

    assertEquals(settlement.kind, "rejected");
    assertEquals(
      settlement.kind === "rejected" ? getErrorName(settlement.error) : undefined,
      "AbortError",
    );
    assertEquals(modelCalls, 0);
  });

  it("does not invoke lazy schema materialization after a pre-abort", async () => {
    const controller = new AbortController();
    controller.abort("cancelled before generation");
    let schemaCalls = 0;
    let modelCalls = 0;
    const model = createGenerateModel("test", "test/pre-aborted-schema", async () => {
      modelCalls += 1;
      return { content: [{ type: "text", text: "unreachable" }], finishReason: "stop" };
    });

    const error = await assertRejects(() =>
      Promise.resolve(generateText({
        model,
        messages: [{ role: "user", content: "Search" }],
        tools: {
          web_search: {
            type: "provider",
            id: "anthropic.web_search_20250305",
            args: {},
            inputSchema: () => {
              schemaCalls += 1;
              return createRuntimeJsonSchema({ type: "object" });
            },
          },
        },
        abortSignal: controller.signal,
      }))
    );

    assertEquals(getErrorName(error), "AbortError");
    assertEquals(schemaCalls, 0);
    assertEquals(modelCalls, 0);
  });

  it("lets abort win while initial tool input validation is pending", async () => {
    const enteredValidation = Promise.withResolvers<void>();
    const releaseValidation = Promise.withResolvers<{
      success: true;
      value: { query: string };
    }>();
    const controller = new AbortController();
    const model = createGenerateModel("test", "test/initial-validation-abort", async () => ({
      content: [{
        type: "tool-call",
        toolCallId: "initial-validation-abort",
        toolName: "search",
        input: '{"query":"Veryfront"}',
      }],
      finishReason: "tool-calls",
    }));

    const generation = Promise.resolve(generateText({
      model,
      messages: [{ role: "user", content: "Search" }],
      tools: {
        search: {
          description: "Search",
          inputSchema: {
            jsonSchema: { type: "object" },
            validate: () => {
              enteredValidation.resolve();
              return releaseValidation.promise;
            },
          },
        },
      },
      abortSignal: controller.signal,
    }));

    await enteredValidation.promise;
    controller.abort("validation cancelled");
    const settlement = await settleWithin(generation);
    releaseValidation.resolve({ success: true, value: { query: "Veryfront" } });

    assertEquals(settlement.kind, "rejected");
    assertEquals(
      settlement.kind === "rejected" ? getErrorName(settlement.error) : undefined,
      "AbortError",
    );
  });

  it("lets abort win while repaired tool input validation is pending", async () => {
    const enteredRevalidation = Promise.withResolvers<void>();
    const releaseRevalidation = Promise.withResolvers<{
      success: true;
      value: { query: string };
    }>();
    const controller = new AbortController();
    let validationCalls = 0;
    const model = createGenerateModel("test", "test/repaired-validation-abort", async () => ({
      content: [{
        type: "tool-call",
        toolCallId: "repaired-validation-abort",
        toolName: "search",
        input: '{"query":42}',
      }],
      finishReason: "tool-calls",
    }));

    const generation = Promise.resolve(generateText({
      model,
      messages: [{ role: "user", content: "Search" }],
      tools: {
        search: {
          description: "Search",
          inputSchema: {
            jsonSchema: { type: "object" },
            validate: () => {
              validationCalls += 1;
              if (validationCalls === 1) {
                return {
                  success: false as const,
                  errors: [{
                    instancePath: "/",
                    schemaPath: "#/type",
                    keyword: "type",
                    params: {},
                    message: "must be object",
                  }],
                };
              }
              enteredRevalidation.resolve();
              return releaseRevalidation.promise;
            },
          },
        },
      },
      abortSignal: controller.signal,
      experimental_repairToolCall: (context) => ({
        ...context.toolCall,
        input: { query: "Veryfront" },
      }),
    }));

    await enteredRevalidation.promise;
    controller.abort("revalidation cancelled");
    const settlement = await settleWithin(generation);
    releaseRevalidation.resolve({ success: true, value: { query: "Veryfront" } });

    assertEquals(settlement.kind, "rejected");
    assertEquals(
      settlement.kind === "rejected" ? getErrorName(settlement.error) : undefined,
      "AbortError",
    );
  });

  it("preserves inferred dynamic metadata across repair", async () => {
    const inputSchema = createRuntimeJsonSchema({
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    });
    let callbackSawDynamic = false;
    const model = createGenerateModel("test", "test/repair-dynamic", async () => ({
      content: [{
        type: "tool-call",
        toolCallId: "repair-dynamic",
        toolName: "dynamic_lookup",
        input: "not-json",
        providerExecuted: true,
      }, {
        type: "tool-result",
        toolCallId: "repair-dynamic",
        toolName: "dynamic_lookup",
        result: { spoofed: true },
        providerExecuted: true,
      }],
      finishReason: "tool-calls",
    }));

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Look it up" }],
      tools: {
        dynamic_lookup: {
          type: "dynamic",
          inputSchema,
        },
      },
      experimental_repairToolCall: (context) => {
        callbackSawDynamic = context.toolCall.dynamic === true;
        return {
          type: "tool-call",
          toolCallId: context.toolCall.toolCallId,
          toolName: context.toolCall.toolName,
          input: '{"query":"Veryfront"}',
        };
      },
    });

    assertEquals(callbackSawDynamic, true);
    assertEquals(result.toolCalls, [{
      toolCallId: "repair-dynamic",
      toolName: "dynamic_lookup",
      input: { query: "Veryfront" },
      dynamic: true,
    }]);
    assertEquals(result.toolResults, undefined);
  });

  it("drops trailing assistant prefill messages before direct stream requests", async () => {
    const model = createStreamModel(
      "anthropic",
      "anthropic/test-drop-prefill-stream",
      async (options) => {
        assertEquals(options.prompt, [{
          role: "user",
          content: [{ type: "text", text: "Continue after the tool result." }],
        }]);
        return {
          stream: ReadableStream.from([
            { type: "text-delta", delta: "Continuing" },
            { type: "finish", finishReason: { unified: "stop", raw: "stop" } },
          ]),
        };
      },
    );

    const result = streamText({
      model,
      messages: [
        { role: "user", content: "Continue after the tool result." },
        { role: "assistant", content: [{ type: "text", text: "Draft prefill" }] },
      ],
    });

    assertEquals(await collectAsync(result.textStream), ["Continuing"]);
  });

  it("drops trailing assistant prefill messages before direct generate requests", async () => {
    const model = createGenerateModel(
      "anthropic",
      "anthropic/test-drop-prefill-generate",
      async (options) => {
        assertEquals(options.prompt, [{
          role: "user",
          content: [{ type: "text", text: "Continue after the tool result." }],
        }]);
        return {
          content: [{ type: "text", text: "Continuing" }],
          finishReason: { unified: "stop", raw: "stop" },
        };
      },
    );

    const result = await generateText({
      model,
      messages: [
        { role: "user", content: "Continue after the tool result." },
        { role: "assistant", content: [{ type: "text", text: "Draft prefill" }] },
      ],
    });

    assertEquals(result.text, "Continuing");
  });

  it("transmits the provider-safe schema while retaining canonical local validation", async () => {
    const canonicalSchema = {
      type: "object" as const,
      properties: { query: { type: "string" as const } },
      required: ["query"],
      additionalProperties: false,
    };
    const modelSchema = {
      type: "object" as const,
      properties: { query: { type: "string" as const } },
      required: ["query"],
    };
    const model = createGenerateModel("test", "test/transmission-schema", async (options) => {
      assertEquals(options.tools, [{
        type: "function",
        name: "search",
        description: "Search",
        inputSchema: modelSchema,
      }]);
      return {
        content: [{
          type: "tool-call",
          toolCallId: "strict-input",
          toolName: "search",
          input: { query: "Veryfront", injected: true },
        }],
        finishReason: "tool_use",
      };
    });

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Search" }],
      tools: {
        search: {
          description: "Search",
          inputSchema: createRuntimeJsonSchema(canonicalSchema, modelSchema),
        },
      },
    });

    assertEquals(getErrorName(result.toolResults?.[0]?.result), "AI_InvalidToolInputError");
  });

  it("keeps deferred provider calls pending at a continuation boundary", async () => {
    const inputSchema = createRuntimeJsonSchema({
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    });
    const outputSchema = createRuntimeJsonSchema({
      type: "object",
      properties: { matches: { type: "integer" } },
      required: ["matches"],
      additionalProperties: false,
    });
    const model = createGenerateModel("test", "test/deferred-provider", async () => ({
      content: [{
        type: "tool-call",
        toolCallId: "deferred-search",
        toolName: "web_search",
        input: { query: "Veryfront" },
        providerExecuted: true,
      }],
      finishReason: "pause_turn",
    }));

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Search" }],
      tools: {
        web_search: {
          type: "provider",
          id: "anthropic.web_search_20250305",
          args: {},
          inputSchema: () => inputSchema,
          outputSchema: () => outputSchema,
          supportsDeferredResults: true,
        },
      },
    });

    assertEquals(result.toolCalls, [{
      toolCallId: "deferred-search",
      toolName: "web_search",
      input: { query: "Veryfront" },
      providerExecuted: true,
      supportsDeferredResults: true,
    }]);
    assertEquals(result.toolResults, undefined);
  });

  it("turns a deferred provider call missing at terminal stop into a correlated error", async () => {
    const schema = createRuntimeJsonSchema({ type: "object" });
    const model = createGenerateModel("test", "test/terminal-deferred-provider", async () => ({
      content: [{
        type: "tool-call",
        toolCallId: "terminal-deferred-search",
        toolName: "web_search",
        input: {},
        providerExecuted: true,
      }],
      finishReason: { unified: "stop", raw: "end_turn" },
    }));

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Search" }],
      tools: {
        web_search: {
          type: "provider",
          id: "anthropic.web_search_20250305",
          args: {},
          inputSchema: () => schema,
          outputSchema: () => schema,
          supportsDeferredResults: true,
        },
      },
    });

    assertEquals(result.toolResults?.length, 1);
    assertEquals(result.toolResults?.[0]?.toolCallId, "terminal-deferred-search");
    assertEquals(getErrorName(result.toolResults?.[0]?.result), "AI_MissingToolResultError");
  });

  it("accepts a deferred provider result correlated after an intermediate finish boundary", async () => {
    const inputSchema = createRuntimeJsonSchema({
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    });
    const outputSchema = createRuntimeJsonSchema({
      type: "object",
      properties: { matches: { type: "integer" } },
      required: ["matches"],
      additionalProperties: false,
    });
    const model = createStreamModel("test", "test/deferred-provider-stream", async () => ({
      stream: ReadableStream.from([
        {
          type: "tool-call",
          toolCallId: "deferred-stream-search",
          toolName: "web_search",
          input: '{"query":"Veryfront"}',
          providerExecuted: true,
        },
        {
          type: "finish",
          finishReason: "pause_turn",
          providerMetadata: { anthropic: { requestId: "request-deferred" } },
          usage: { inputTokens: 7, outputTokens: 3 },
        },
        {
          type: "tool-result",
          toolCallId: "deferred-stream-search",
          toolName: "web_search",
          result: { matches: 2 },
          providerExecuted: true,
        },
      ]),
    }));

    const result = streamText({
      model,
      messages: [{ role: "user", content: "Search" }],
      tools: {
        web_search: {
          type: "provider",
          id: "anthropic.web_search_20250305",
          args: {},
          inputSchema: () => inputSchema,
          outputSchema: () => outputSchema,
          supportsDeferredResults: true,
        },
      },
    });
    const parts = await collectAsync(result.fullStream);

    assertEquals(
      parts.filter((part) =>
        part && typeof part === "object" && "type" in part && part.type === "tool-error"
      ),
      [],
    );
    assertEquals(parts, [
      {
        type: "tool-call",
        toolCallId: "deferred-stream-search",
        toolName: "web_search",
        input: '{"query":"Veryfront"}',
        providerExecuted: true,
        supportsDeferredResults: true,
      },
      {
        type: "tool-result",
        toolCallId: "deferred-stream-search",
        toolName: "web_search",
        result: { matches: 2 },
        providerExecuted: true,
        supportsDeferredResults: true,
      },
      {
        type: "finish",
        finishReason: "pause_turn",
        providerMetadata: { anthropic: { requestId: "request-deferred" } },
        totalUsage: { inputTokens: 7, outputTokens: 3 },
      },
    ]);
  });

  it("emits one correlated error for a deferred provider call missing at streamed stop", async () => {
    const schema = createRuntimeJsonSchema({ type: "object" });
    const model = createStreamModel("test", "test/terminal-deferred-provider-stream", async () => ({
      stream: ReadableStream.from([
        {
          type: "tool-call",
          toolCallId: "terminal-deferred-stream-search",
          toolName: "web_search",
          input: "{}",
          providerExecuted: true,
        },
        { type: "finish", finishReason: { unified: "stop", raw: "end_turn" } },
      ]),
    }));

    const result = streamText({
      model,
      messages: [{ role: "user", content: "Search" }],
      tools: {
        web_search: {
          type: "provider",
          id: "anthropic.web_search_20250305",
          args: {},
          inputSchema: () => schema,
          outputSchema: () => schema,
          supportsDeferredResults: true,
        },
      },
    });
    const parts = await collectAsync(result.fullStream);
    const errors = parts.filter((part) =>
      part && typeof part === "object" && "type" in part && part.type === "tool-error"
    ) as Array<{ error?: unknown; toolCallId?: unknown }>;
    const [error] = errors;

    assertEquals(errors.length, 1);
    assertExists(error);
    assertEquals(error.toolCallId, "terminal-deferred-stream-search");
    assertEquals(getErrorName(error.error), "AI_MissingToolResultError");
  });

  it("turns an invalid successful provider output into a correlated terminal error", async () => {
    const inputSchema = createRuntimeJsonSchema({ type: "object" });
    const outputSchema = createRuntimeJsonSchema({
      type: "object",
      properties: { matches: { type: "integer" } },
      required: ["matches"],
      additionalProperties: false,
    });
    const model = createGenerateModel("test", "test/provider-output-validation", async () => ({
      content: [{
        type: "tool-call",
        toolCallId: "invalid-provider-output",
        toolName: "web_search",
        input: {},
        providerExecuted: true,
      }, {
        type: "tool-result",
        toolCallId: "invalid-provider-output",
        toolName: "web_search",
        result: { matches: "two" },
        providerExecuted: true,
      }],
      finishReason: "stop",
    }));

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Search" }],
      tools: {
        web_search: {
          type: "provider",
          id: "anthropic.web_search_20250305",
          args: {},
          inputSchema: () => inputSchema,
          outputSchema: () => outputSchema,
        },
      },
    });

    assertEquals(result.toolResults?.length, 1);
    assertEquals(getErrorName(result.toolResults?.[0]?.result), "AI_InvalidToolResultError");
    assertEquals(result.toolResults?.[0]?.isError, true);
    assertEquals(result.toolResults?.[0]?.toolCallId, "invalid-provider-output");
  });

  it("accepts only the first terminal provider result for a call", async () => {
    const schema = createRuntimeJsonSchema({ type: "object" });
    const model = createGenerateModel("test", "test/provider-result-deduplication", async () => ({
      content: [{
        type: "tool-call",
        toolCallId: "one-result",
        toolName: "web_search",
        input: {},
        providerExecuted: true,
      }, {
        type: "tool-result",
        toolCallId: "one-result",
        toolName: "web_search",
        result: { accepted: true },
        providerExecuted: true,
      }, {
        type: "tool-result",
        toolCallId: "one-result",
        toolName: "web_search",
        result: { accepted: false },
        providerExecuted: true,
      }],
      finishReason: "stop",
    }));

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Search" }],
      tools: {
        web_search: {
          type: "provider",
          id: "anthropic.web_search_20250305",
          args: {},
          inputSchema: () => schema,
          outputSchema: () => schema,
        },
      },
    });

    assertEquals(result.toolResults, [{
      toolCallId: "one-result",
      toolName: "web_search",
      result: { accepted: true },
      providerExecuted: true,
    }]);
  });

  it("bounds streamed tool input bytes with one correlated terminal error", async () => {
    const model = createStreamModel("test", "test/tool-input-byte-bound", async () => ({
      stream: ReadableStream.from([
        { type: "tool-input-start", id: "oversized-input", toolName: "search" },
        { type: "tool-input-delta", id: "oversized-input", delta: "x".repeat(1_048_577) },
        { type: "tool-input-end", id: "oversized-input" },
        { type: "finish", finishReason: "tool-calls" },
      ]),
    }));
    const result = streamText({
      model,
      messages: [{ role: "user", content: "Search" }],
      tools: {
        search: {
          description: "Search",
          inputSchema: createRuntimeJsonSchema({ type: "object" }),
        },
      },
    });
    const parts = await collectAsync(result.fullStream);
    const errors = parts.filter((part) =>
      part && typeof part === "object" && "type" in part && part.type === "tool-error"
    ) as Array<{ error?: unknown; toolCallId?: unknown }>;
    const [error] = errors;

    assertEquals(errors.length, 1);
    assertExists(error);
    assertEquals(error.toolCallId, "oversized-input");
    assertEquals(getErrorName(error.error), "AI_ToolInputLimitError");
  });

  it("bounds streamed tool input delta count with one correlated terminal error", async () => {
    const deltas = Array.from({ length: 4_097 }, () => ({
      type: "tool-input-delta",
      id: "too-many-deltas",
      delta: " ",
    }));
    const model = createStreamModel("test", "test/tool-input-delta-bound", async () => ({
      stream: ReadableStream.from([
        { type: "tool-input-start", id: "too-many-deltas", toolName: "search" },
        ...deltas,
        { type: "tool-input-end", id: "too-many-deltas" },
        { type: "finish", finishReason: "tool-calls" },
      ]),
    }));
    const result = streamText({
      model,
      messages: [{ role: "user", content: "Search" }],
      tools: {
        search: {
          description: "Search",
          inputSchema: createRuntimeJsonSchema({ type: "object" }),
        },
      },
    });
    const parts = await collectAsync(result.fullStream);
    const errors = parts.filter((part) =>
      part && typeof part === "object" && "type" in part && part.type === "tool-error"
    ) as Array<{ error?: unknown; toolCallId?: unknown }>;
    const [error] = errors;

    assertEquals(errors.length, 1);
    assertExists(error);
    assertEquals(error.toolCallId, "too-many-deltas");
    assertEquals(getErrorName(error.error), "AI_ToolInputLimitError");
  });

  it("bounds the number of distinct streamed tool calls", async () => {
    const calls = Array.from({ length: 1_024 }, (_, index) => ({
      type: "tool-call",
      toolCallId: `bounded-call-${index}`,
      toolName: "search",
      input: {},
    }));
    const model = createStreamModel("test", "test/tool-call-count-bound", async () => ({
      stream: ReadableStream.from([
        ...calls,
        { type: "finish", finishReason: "tool-calls" },
      ]),
    }));
    const result = streamText({
      model,
      messages: [{ role: "user", content: "Search" }],
      tools: {
        search: {
          description: "Search",
          inputSchema: createRuntimeJsonSchema({ type: "object" }),
        },
      },
    });
    const parts = await collectAsync(result.fullStream);
    const errors = parts.filter((part) =>
      part && typeof part === "object" && "type" in part && part.type === "tool-error"
    ) as Array<{ error?: unknown; toolCallId?: unknown }>;
    const acceptedCalls = parts.filter((part) =>
      part && typeof part === "object" && "type" in part && part.type === "tool-call"
    );
    const [error] = errors;

    assertEquals(errors.length, 1);
    assertEquals(acceptedCalls.length, 128);
    assertExists(error);
    assertEquals(error.toolCallId, "bounded-call-128");
    assertEquals(getErrorName(error.error), "AI_ToolInputLimitError");
  });

  it("rejects a missing embedding from a single-value provider response", async () => {
    const model = {
      provider: "test",
      modelId: "test/missing-single-embedding",
      specificationVersion: "v3",
      doEmbed: () => Promise.resolve({ embeddings: [] }),
    };

    await assertRejects(
      () => Promise.resolve(embed({ model, value: "Hello" })),
      Error,
      "expected 1 embedding but received 0",
    );
  });

  it("rejects an embedding count that does not match the requested values", async () => {
    const model = {
      provider: "test",
      modelId: "test/mismatched-embedding-count",
      specificationVersion: "v3",
      doEmbed: () => Promise.resolve({ embeddings: [[1, 0]] }),
    };

    await assertRejects(
      () => Promise.resolve(embedMany({ model, values: ["first", "second"] })),
      Error,
      "expected 2 embeddings but received 1",
    );
  });
});
