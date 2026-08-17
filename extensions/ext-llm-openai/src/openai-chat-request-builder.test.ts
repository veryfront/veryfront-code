import { fromError } from "#veryfront/errors";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimePromptMessage } from "veryfront/provider/shared";
import { buildOpenAIChatRequest } from "./openai-chat-request-builder.ts";

function captureThrownError(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error("Expected function to throw");
}

function createWarningCollector() {
  const warnings: Array<{
    type: "unsupported-setting" | "other";
    setting?: string;
    details?: string;
    provider: string;
  }> = [];

  return {
    push(warning: {
      type: "unsupported-setting" | "other";
      setting?: string;
      details?: string;
      provider: string;
    }) {
      warnings.push(warning);
    },
    drain() {
      return warnings.slice();
    },
  };
}

describe("ext-llm-openai/openai-chat-request-builder", () => {
  it("sets default reasoning effort for GPT-5.5 chat requests", () => {
    const warnings = createWarningCollector();

    const body = buildOpenAIChatRequest(
      "gpt-5.5",
      "openai",
      {
        prompt: [{ role: "user", content: [{ type: "text", text: "Think carefully." }] }],
        temperature: 0.2,
      },
      true,
      warnings,
    );

    assertEquals(body.reasoning_effort, "medium");
    assertEquals(body.temperature, undefined);
    assertEquals(warnings.drain().map((warning) => warning.setting), ["temperature"]);
  });

  it("omits reasoning when function tools exceed the transport capability", () => {
    const warnings = createWarningCollector();

    const body = buildOpenAIChatRequest(
      "gpt-5.5",
      "veryfront-cloud",
      {
        prompt: [{ role: "user", content: [{ type: "text", text: "Use the tool." }] }],
        tools: [{
          type: "function",
          name: "lookup",
          inputSchema: { jsonSchema: { type: "object", properties: {} } },
        }],
        providerOptions: {
          "veryfront-cloud": { reasoning_effort: "high" },
        },
      },
      true,
      warnings,
      { reasoningWithFunctionTools: false },
    );

    assertEquals(body.tools?.[0]?.function.name, "lookup");
    assertEquals(body.reasoning_effort, undefined);
    assertEquals(
      warnings.drain().map((warning) => warning.setting),
      ["reasoning"],
    );
  });

  it("retains reasoning when the restricted transport has no function tools", () => {
    const warnings = createWarningCollector();

    const body = buildOpenAIChatRequest(
      "gpt-5.5",
      "veryfront-cloud",
      {
        prompt: [{ role: "user", content: [{ type: "text", text: "Think carefully." }] }],
      },
      true,
      warnings,
      { reasoningWithFunctionTools: false },
    );

    assertEquals(body.reasoning_effort, "medium");
    assertEquals(warnings.drain(), []);
  });

  it("uses the final provider-options tool list for reasoning compatibility", () => {
    for (const stream of [false, true]) {
      const injectedToolWarnings = createWarningCollector();
      const withInjectedTool = buildOpenAIChatRequest(
        "gpt-5.5",
        "veryfront-cloud",
        {
          prompt: [{ role: "user", content: [{ type: "text", text: "Use the tool." }] }],
          providerOptions: {
            "veryfront-cloud": {
              tools: [{
                type: "function",
                function: {
                  name: "lookup",
                  parameters: { type: "object", properties: {} },
                },
              }],
            },
          },
        },
        stream,
        injectedToolWarnings,
        { reasoningWithFunctionTools: false },
      );

      assertEquals(withInjectedTool.reasoning_effort, undefined);
      assertEquals(
        injectedToolWarnings.drain().map((warning) => warning.setting),
        ["reasoning"],
      );

      const removedToolWarnings = createWarningCollector();
      const withRemovedTool = buildOpenAIChatRequest(
        "gpt-5.5",
        "veryfront-cloud",
        {
          prompt: [{ role: "user", content: [{ type: "text", text: "No tool." }] }],
          tools: [{
            type: "function",
            name: "lookup",
            inputSchema: { jsonSchema: { type: "object", properties: {} } },
          }],
          providerOptions: { "veryfront-cloud": { tools: [] } },
        },
        stream,
        removedToolWarnings,
        { reasoningWithFunctionTools: false },
      );

      assertEquals(withRemovedTool.reasoning_effort, "medium");
      assertEquals(removedToolWarnings.drain(), []);
    }
  });

  it("does not set default reasoning effort for GPT-5 chat snapshots", () => {
    const warnings = createWarningCollector();

    const body = buildOpenAIChatRequest(
      "gpt-5-chat-latest",
      "openai",
      {
        prompt: [{ role: "user", content: [{ type: "text", text: "Be concise." }] }],
        temperature: 0.2,
      },
      true,
      warnings,
    );

    assertEquals(body.reasoning_effort, undefined);
    assertEquals(body.temperature, 0.2);
    assertEquals(warnings.drain(), []);
  });

  it("does not set default reasoning effort for legacy o1 chat variants", () => {
    const warnings = createWarningCollector();

    const body = buildOpenAIChatRequest(
      "o1-mini",
      "openai",
      {
        prompt: [{ role: "user", content: [{ type: "text", text: "Be concise." }] }],
        temperature: 0.2,
      },
      true,
      warnings,
    );

    assertEquals(body.reasoning_effort, undefined);
    assertEquals(body.temperature, undefined);
    assertEquals(warnings.drain().map((warning) => warning.setting), ["temperature"]);
  });

  it("does not set default reasoning effort for OpenAI-compatible providers but still drops rejected sampling params", () => {
    const warnings = createWarningCollector();

    const body = buildOpenAIChatRequest(
      "gpt-5.5",
      "azure",
      {
        prompt: [{ role: "user", content: [{ type: "text", text: "Be concise." }] }],
        temperature: 0.2,
      },
      true,
      warnings,
    );

    assertEquals(body.reasoning_effort, undefined);
    assertEquals(body.temperature, undefined);
    assertEquals(warnings.drain().map((warning) => warning.setting), ["temperature"]);
  });

  it("drops rejected sampling params when explicit reasoning is disabled", () => {
    const warnings = createWarningCollector();

    const body = buildOpenAIChatRequest(
      "o3-mini",
      "openai",
      {
        prompt: [{ role: "user", content: [{ type: "text", text: "Be concise." }] }],
        reasoning: { enabled: false },
        temperature: 0.2,
      },
      true,
      warnings,
    );

    assertEquals(body.reasoning_effort, undefined);
    assertEquals(body.temperature, undefined);
    assertEquals(warnings.drain().map((warning) => warning.setting), ["temperature"]);
  });

  it("merges the legacy openai-compatible provider options bucket below openai keys", () => {
    const warnings = createWarningCollector();

    const body = buildOpenAIChatRequest(
      "gpt-4o-mini",
      "openai",
      {
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        providerOptions: {
          "openai-compatible": {
            custom_compat: true,
            service_tier: "flex",
          },
          openai: {
            service_tier: "default",
          },
        },
      },
      true,
      warnings,
    );

    assertEquals(body.custom_compat, true);
    assertEquals(body.service_tier, "default");
  });

  it("lets an openai max_tokens override beat a legacy openai-compatible max_completion_tokens", () => {
    const warnings = createWarningCollector();

    const body = buildOpenAIChatRequest(
      "gpt-4o-mini",
      "openai",
      {
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        providerOptions: {
          "openai-compatible": {
            max_completion_tokens: 111,
          },
          openai: {
            max_tokens: 222,
          },
        },
      },
      true,
      warnings,
    );

    assertEquals(body.max_completion_tokens, 222);
    assertEquals(body.max_tokens, undefined);
  });

  it("protects runtime-owned Chat transport fields during provider-option merges", () => {
    const providerBucket: Record<string, unknown> = {
      model: "attacker-model",
      messages: [{ role: "user", content: "replaced" }],
      stream: false,
      stream_options: { include_usage: false },
      custom_option: true,
    };
    Object.defineProperty(providerBucket, "__proto__", {
      value: { polluted: true },
      enumerable: true,
    });
    const prompt: RuntimePromptMessage[] = [{
      role: "user",
      content: [{ type: "text", text: "Original" }],
    }];

    const streamed = buildOpenAIChatRequest(
      "gpt-4o-mini",
      "openai",
      { prompt, providerOptions: { openai: providerBucket } },
      true,
      createWarningCollector(),
    );
    assertEquals(streamed.model, "gpt-4o-mini");
    assertEquals(streamed.messages, [{ role: "user", content: "Original" }]);
    assertEquals(streamed.stream, true);
    assertEquals(streamed.stream_options, { include_usage: true });
    assertEquals(streamed.custom_option, true);
    assertEquals(Object.getPrototypeOf(streamed), Object.prototype);
    assertEquals((streamed as Record<string, unknown>).polluted, undefined);

    const generated = buildOpenAIChatRequest(
      "gpt-4o-mini",
      "openai",
      { prompt, providerOptions: { openai: { stream: true, stream_options: {} } } },
      false,
      createWarningCollector(),
    );
    assertEquals(Object.hasOwn(generated, "stream"), false);
    assertEquals(Object.hasOwn(generated, "stream_options"), false);
  });

  it("preserves chat request shaping, provider option merge order, and warnings", () => {
    const prompt: RuntimePromptMessage[] = [
      { role: "system", content: "You are concise." },
      {
        role: "user",
        content: [
          { type: "text", text: "Inspect this." },
          { type: "image", mediaType: "image/png", url: "https://example.test/image.png" },
        ],
      },
    ];
    const warnings = createWarningCollector();

    const body = buildOpenAIChatRequest(
      "gpt-4o-mini",
      "azure",
      {
        prompt,
        maxOutputTokens: 123,
        temperature: 0.2,
        topP: 0.8,
        topK: 5,
        stopSequences: ["END"],
        tools: [{
          type: "function",
          name: "lookup",
          description: "Look up a value",
          inputSchema: { jsonSchema: { type: "object", properties: { id: { type: "string" } } } },
        }],
        toolChoice: "auto",
        seed: 7,
        presencePenalty: 0.1,
        frequencyPenalty: 0.2,
        reasoning: { enabled: true, effort: "high" },
        userId: "user_123",
        serviceTier: "flex",
        parallelToolCalls: false,
        responseFormat: {
          type: "json_schema",
          name: "lookup_result",
          schema: { jsonSchema: { type: "object", properties: { value: { type: "string" } } } },
          description: "Lookup result",
          strict: true,
        },
        providerOptions: {
          openai: {
            custom_openai: true,
            max_tokens: 456,
          },
          azure: {
            custom_azure: true,
            temperature: 0.9,
          },
        },
      },
      true,
      warnings,
    );

    assertEquals(body, {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are concise." },
        {
          role: "user",
          content: [
            { type: "text", text: "Inspect this." },
            { type: "image_url", image_url: { url: "https://example.test/image.png" } },
          ],
        },
      ],
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: 456,
      stop: ["END"],
      tools: [{
        type: "function",
        function: {
          name: "lookup",
          parameters: { type: "object", properties: { id: { type: "string" } } },
          description: "Look up a value",
        },
      }],
      tool_choice: "auto",
      seed: 7,
      reasoning_effort: "high",
      user: "user_123",
      service_tier: "flex",
      parallel_tool_calls: false,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "lookup_result",
          description: "Lookup result",
          schema: { type: "object", properties: { value: { type: "string" } } },
          strict: true,
        },
      },
      custom_openai: true,
      custom_azure: true,
      temperature: 0.9,
    });
    assertEquals(warnings.drain().map((warning) => warning.setting), [
      "topK",
      "temperature",
      "topP",
      "presencePenalty",
      "frequencyPenalty",
    ]);
  });

  it("rejects hosted-tool results that Chat Completions cannot replay", () => {
    const callMessage =
      "OpenAI-compatible provider-executed assistant tool calls cannot be replayed through Chat Completions";
    const callError = captureThrownError(() =>
      buildOpenAIChatRequest(
        "gpt-4o-mini",
        "openai",
        {
          prompt: [{
            role: "assistant",
            content: [{
              type: "tool-call",
              toolCallId: "ws_1",
              toolName: "web_search",
              input: { query: "Veryfront" },
              providerExecuted: true,
            }],
          }],
        },
        false,
        createWarningCollector(),
      )
    );
    assertEquals(callError instanceof TypeError, true);
    assertEquals(callError.message, callMessage);
    assertEquals(callError.name, "VeryfrontError[config]");
    assertEquals(fromError(callError), { type: "config", message: callMessage });

    const resultMessage =
      "OpenAI-compatible provider-executed assistant tool results cannot be replayed through Chat Completions";
    const resultError = captureThrownError(() =>
      buildOpenAIChatRequest(
        "gpt-4o-mini",
        "openai",
        {
          prompt: [{
            role: "assistant",
            content: [{
              type: "tool-result",
              toolCallId: "ws_1",
              toolName: "web_search",
              result: { status: "completed" },
              providerExecuted: true,
            }],
          }],
        },
        false,
        createWarningCollector(),
      )
    );
    assertEquals(resultError instanceof TypeError, true);
    assertEquals(resultError.message, resultMessage);
    assertEquals(resultError.name, "VeryfrontError[config]");
    assertEquals(fromError(resultError), { type: "config", message: resultMessage });
  });
});
