import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { cosineSimilarity, embed, embedMany, generateText, streamText } from "./runtime-bridge.ts";
import {
  collectAsync,
  createGenerateModel,
  createStreamModel,
} from "./runtime-bridge.test-helpers.ts";

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

  it("omits flat usage without finite nonnegative fields", async () => {
    const model = createGenerateModel("test", "test/invalid-flat-usage", async () => ({
      content: [{ type: "text", text: "ok" }],
      finishReason: "stop",
      usage: {
        inputTokens: "3",
        outputTokens: -1,
        totalTokens: Number.POSITIVE_INFINITY,
        costUsd: Number.NaN,
      },
    }));

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Hello" }],
    });

    assertEquals(result.usage, undefined);
  });

  it("normalizes nested usage with finite nonnegative fields", async () => {
    const model = createGenerateModel("test", "test/nested-usage", async () => ({
      content: [{ type: "text", text: "ok" }],
      finishReason: "stop",
      usage: {
        inputTokens: {
          total: 0,
          cached: -1,
          cacheCreation: 2,
        },
        outputTokens: {
          total: 4,
          reasoning: Number.POSITIVE_INFINITY,
        },
      },
    }));

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Hello" }],
    });

    assertEquals(result.usage, {
      inputTokens: 0,
      outputTokens: 4,
      totalTokens: 4,
      cacheCreationInputTokens: 2,
    });
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

  it("preserves falsey streamed tool results by property presence", async () => {
    const model = {
      ...createStreamModel("test", "test/falsey-tool-results", async () => ({
        stream: ReadableStream.from([
          {
            type: "tool-result",
            toolCallId: "tool-null",
            toolName: "probe",
            result: null,
            output: "fallback",
          },
          {
            type: "tool-result",
            toolCallId: "tool-false",
            toolName: "probe",
            result: false,
          },
          {
            type: "tool-result",
            toolCallId: "tool-zero",
            toolName: "probe",
            output: 0,
          },
          {
            type: "tool-result",
            toolCallId: "tool-empty",
            toolName: "probe",
            result: "",
          },
        ]),
      })),
      _generateViaStream: true,
    };

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Probe" }],
    });

    assertEquals(result.toolResults, [
      { toolCallId: "tool-null", toolName: "probe", result: null },
      { toolCallId: "tool-false", toolName: "probe", result: false },
      { toolCallId: "tool-zero", toolName: "probe", result: 0 },
      { toolCallId: "tool-empty", toolName: "probe", result: "" },
    ]);
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
          inputSchema: {
            jsonSchema: {
              type: "object",
              properties: {
                city: { type: "string" },
              },
              required: ["city"],
              additionalProperties: false,
            },
          },
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
          inputSchema: {
            jsonSchema: {
              type: "object",
              properties: {
                city: { type: "string" },
              },
              required: ["city"],
              additionalProperties: false,
            },
          },
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
          inputSchema: () => ({
            jsonSchema: {
              type: "object",
              properties: {
                query: { type: "string" },
              },
              required: ["query"],
              additionalProperties: false,
            },
          }),
          outputSchema: () => ({
            jsonSchema: {
              type: "array",
            },
          }),
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
          inputSchema: () => ({
            jsonSchema: {
              type: "object",
              properties: {
                query: { type: "string" },
              },
              required: ["query"],
              additionalProperties: false,
            },
          }),
          outputSchema: () => ({
            jsonSchema: {
              type: "array",
            },
          }),
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
                retrievedAt: "2026-04-11T10:10:00Z",
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
          inputSchema: () => ({
            jsonSchema: {
              type: "object",
              properties: {
                url: { type: "string" },
              },
              required: ["url"],
              additionalProperties: false,
            },
          }),
          outputSchema: () => ({
            jsonSchema: {
              type: "object",
            },
          }),
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
          retrievedAt: "2026-04-11T10:10:00Z",
        },
        providerExecuted: true,
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
                retrievedAt: "2026-04-11T10:12:00Z",
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
          inputSchema: () => ({
            jsonSchema: {
              type: "object",
              properties: {
                url: { type: "string" },
              },
              required: ["url"],
              additionalProperties: false,
            },
          }),
          outputSchema: () => ({
            jsonSchema: {
              type: "object",
            },
          }),
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
        retrievedAt: "2026-04-11T10:12:00Z",
      },
    }]);
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

  it("rejects a single embedding response with the wrong result count", async () => {
    const model = {
      doEmbed: () => Promise.resolve({ embeddings: [] }),
    };

    await assertRejects(
      async () => {
        await embed({ model, value: "one" });
      },
      Error,
      "Embedding response count must match input count: expected 1, received 0",
    );
  });

  it("rejects a batched embedding response with the wrong result count", async () => {
    const model = {
      doEmbed: () => Promise.resolve({ embeddings: [[1, 2]] }),
    };

    await assertRejects(
      async () => {
        await embedMany({ model, values: ["one", "two"] });
      },
      Error,
      "Embedding response count must match input count: expected 2, received 1",
    );
  });

  it("rejects non-finite vectors from single and batched embedding responses", async () => {
    const singleModel = {
      doEmbed: () => Promise.resolve({ embeddings: [[1, Number.NaN]] }),
    };
    const batchModel = {
      doEmbed: () => Promise.resolve({ embeddings: [[1, 2], [3, Number.POSITIVE_INFINITY]] }),
    };

    await assertRejects(
      async () => {
        await embed({ model: singleModel, value: "one" });
      },
      Error,
      "Embedding response vector 0 must contain only finite numbers",
    );
    await assertRejects(
      async () => {
        await embedMany({ model: batchModel, values: ["one", "two"] });
      },
      Error,
      "Embedding response vector 1 must contain only finite numbers",
    );
  });

  it("rejects cosine similarity vectors with different dimensions", () => {
    assertThrows(
      () => cosineSimilarity([1], [1, 2]),
      Error,
      "Vectors must have the same length",
    );
  });

  it("returns zero cosine similarity for equal empty and zero vectors", () => {
    assertEquals(cosineSimilarity([], []), 0);
    assertEquals(cosineSimilarity([0, 0], [1, 2]), 0);
  });
});
