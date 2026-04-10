import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type {
  ModelRuntime,
  ModelRuntimeGenerateResult,
  ModelRuntimeStreamResult,
} from "#veryfront/provider/types.ts";
import { generateText, streamText } from "./runtime-bridge.ts";

async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}

type TestRuntimeOptions = {
  prompt: unknown[];
  tools?: unknown[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getTestRuntimeOptions(options: unknown): TestRuntimeOptions {
  if (!isRecord(options) || !Array.isArray(options.prompt)) {
    throw new Error("Expected runtime options with a prompt array");
  }

  return {
    prompt: options.prompt,
    ...(Array.isArray(options.tools) ? { tools: options.tools } : {}),
  };
}

const unusedGenerate: ModelRuntime["doGenerate"] = () =>
  Promise.reject(new Error("unused doGenerate"));
const unusedStream: ModelRuntime["doStream"] = () => Promise.reject(new Error("unused doStream"));

function createGenerateModel(
  provider: string,
  modelId: string,
  doGenerate: (options: TestRuntimeOptions) => Promise<ModelRuntimeGenerateResult>,
): ModelRuntime {
  return {
    provider,
    modelId,
    specificationVersion: "v3",
    doGenerate: (options) => doGenerate(getTestRuntimeOptions(options)),
    doStream: unusedStream,
  };
}

function createStreamModel(
  provider: string,
  modelId: string,
  doStream: (options: TestRuntimeOptions) => Promise<ModelRuntimeStreamResult>,
): ModelRuntime {
  return {
    provider,
    modelId,
    specificationVersion: "v3",
    doGenerate: unusedGenerate,
    doStream: (options) => doStream(getTestRuntimeOptions(options)),
  };
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
              outputTokens: { total: 5 },
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
        },
      },
    ]);
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
});
