import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimePromptMessage } from "veryfront/provider/shared";
import { buildOpenAIResponsesRequest } from "./openai-responses-request-builder.ts";

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

describe("ext-llm-openai/openai-responses-request-builder", () => {
  it("preserves Responses request shaping, provider option merge order, and warnings", () => {
    const prompt: RuntimePromptMessage[] = [
      { role: "system", content: "You are concise." },
      { role: "system", content: "Return valid JSON." },
      {
        role: "user",
        content: [
          { type: "text", text: "Inspect this." },
          { type: "image", mediaType: "image/png", url: "https://example.test/image.png" },
          {
            type: "file",
            mediaType: "application/pdf",
            url: "https://example.test/file.pdf",
            filename: "file.pdf",
          },
        ],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will check." },
          {
            type: "reasoning",
            text: "Reasoning summary",
            signature: "encrypted_123",
          },
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "lookup",
            input: { id: "abc" },
          },
        ],
      },
      {
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: "call_1",
          toolName: "lookup",
          output: { type: "json", value: { ok: true } },
        }],
      },
    ];
    const warnings = createWarningCollector();

    const body = buildOpenAIResponsesRequest(
      "o4-mini",
      "azure",
      {
        prompt,
        maxOutputTokens: 123,
        temperature: 0.2,
        topP: 0.8,
        topK: 5,
        tools: [
          {
            type: "function",
            name: "lookup",
            description: "Look up a value",
            inputSchema: {
              jsonSchema: { type: "object", properties: { id: { type: "string" } } },
            },
          },
          {
            type: "provider",
            name: "web",
            id: "openai.web_search_preview",
            args: { searchContextSize: "low" },
          },
          {
            type: "provider",
            name: "ignored",
            id: "anthropic.web_search",
            args: {},
          },
        ],
        toolChoice: "auto",
        presencePenalty: 0.1,
        frequencyPenalty: 0.2,
        reasoning: { enabled: true, effort: "max" },
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
            max_output_tokens: 456,
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
      model: "o4-mini",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "Inspect this." },
            {
              type: "input_image",
              image_url: "https://example.test/image.png",
              detail: "auto",
            },
            {
              type: "input_file",
              file_url: "https://example.test/file.pdf",
              filename: "file.pdf",
            },
          ],
        },
        {
          role: "assistant",
          content: [{ type: "output_text", text: "I will check." }],
        },
        {
          type: "reasoning",
          encrypted_content: "encrypted_123",
          summary: [{ type: "summary_text", text: "Reasoning summary" }],
        },
        {
          type: "function_call",
          call_id: "call_1",
          name: "lookup",
          arguments: '{"id":"abc"}',
        },
        {
          type: "function_call_output",
          call_id: "call_1",
          output: '{"ok":true}',
        },
      ],
      instructions: "You are concise.\n\nReturn valid JSON.",
      stream: true,
      max_output_tokens: 456,
      tools: [
        {
          type: "function",
          name: "lookup",
          description: "Look up a value",
          parameters: { type: "object", properties: { id: { type: "string" } } },
        },
        {
          type: "web_search_preview",
          search_context_size: "low",
        },
      ],
      tool_choice: "auto",
      reasoning: { effort: "high", summary: "auto" },
      user: "user_123",
      service_tier: "flex",
      parallel_tool_calls: false,
      text: {
        format: {
          type: "json_schema",
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
