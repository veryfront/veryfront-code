import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimePromptMessage } from "veryfront/provider/shared";
import { buildGoogleGenerateContentRequest } from "./google-request-builder.ts";

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

describe("ext-llm-google/google-request-builder", () => {
  it("preserves generateContent request shaping, provider option merge order, and warnings", () => {
    const prompt: RuntimePromptMessage[] = [
      { role: "system", content: "You are concise." },
      {
        role: "user",
        content: [
          { type: "text", text: "Inspect this." },
          { type: "image", mediaType: "image/png", url: "https://example.test/image.png" },
        ],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will check." },
          {
            type: "tool-call",
            toolCallId: "tool_1",
            toolName: "lookup",
            input: { id: "abc" },
          },
        ],
      },
      {
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: "tool_1",
          toolName: "lookup",
          output: { type: "json", value: { ok: true } },
        }],
      },
    ];
    const warnings = createWarningCollector();

    const body = buildGoogleGenerateContentRequest(
      "vertex",
      {
        prompt,
        maxOutputTokens: 123,
        temperature: 0.2,
        topP: 0.8,
        topK: 5,
        stopSequences: ["END"],
        seed: 7,
        presencePenalty: 0.1,
        frequencyPenalty: 0.2,
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
            name: "code",
            id: "google.code_execution",
            args: { enabled: true },
          },
        ],
        toolChoice: { type: "tool", name: "lookup" },
        reasoning: { enabled: true, effort: "high" },
        responseFormat: { type: "json" },
        userId: "user_123",
        requestLabels: { tenant: "acme" },
        googleCachedContent: "cachedContents/abc",
        googleSafetySettings: [{
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_NONE",
        }],
        providerOptions: {
          google: {
            custom_google: true,
            generationConfig: { temperature: 0.9 },
          },
          vertex: {
            custom_vertex: true,
          },
        },
      },
      warnings,
    );

    assertEquals(body, {
      contents: [
        {
          role: "user",
          parts: [
            { text: "Inspect this." },
            {
              fileData: {
                mimeType: "image/png",
                fileUri: "https://example.test/image.png",
              },
            },
          ],
        },
        {
          role: "model",
          parts: [
            { text: "I will check." },
            {
              functionCall: {
                id: "tool_1",
                name: "lookup",
                args: { id: "abc" },
              },
            },
          ],
        },
        {
          role: "user",
          parts: [{
            functionResponse: {
              id: "tool_1",
              name: "lookup",
              response: { result: { ok: true } },
            },
          }],
        },
      ],
      systemInstruction: { parts: [{ text: "You are concise." }] },
      tools: [
        {
          functionDeclarations: [{
            name: "lookup",
            description: "Look up a value",
            parameters: { type: "object", properties: { id: { type: "string" } } },
          }],
        },
        { codeExecution: { enabled: true } },
      ],
      toolConfig: {
        functionCallingConfig: {
          mode: "ANY",
          allowedFunctionNames: ["lookup"],
        },
      },
      generationConfig: { temperature: 0.9 },
      labels: { tenant: "acme" },
      cachedContent: "cachedContents/abc",
      safetySettings: [{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }],
      custom_google: true,
      custom_vertex: true,
    });
    assertEquals(warnings.drain().map((warning) => warning.setting), [
      "presencePenalty",
      "frequencyPenalty",
      "responseFormat",
    ]);
  });
});
