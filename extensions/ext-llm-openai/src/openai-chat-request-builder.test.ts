import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimePromptMessage } from "veryfront/provider/shared";
import { buildOpenAIChatRequest } from "./openai-chat-request-builder.ts";

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
});
