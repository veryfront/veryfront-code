import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimePromptMessage } from "veryfront/provider/shared";
import {
  buildGoogleGenerateContentRequest,
  type RuntimeToolDefinition,
} from "./google-request-builder.ts";

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
            name: "code_execution",
            id: "google.code_execution",
            args: {},
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
        { codeExecution: {} },
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

  it("accepts only the explicitly supported Google provider-tool schemas", () => {
    const prompt: RuntimePromptMessage[] = [{
      role: "user",
      content: [{ type: "text", text: "Search and calculate." }],
    }];
    const buildWithTools = (tools: RuntimeToolDefinition[]) =>
      buildGoogleGenerateContentRequest(
        "google",
        { prompt, tools },
        createWarningCollector(),
      );

    assertEquals(
      buildWithTools([
        {
          type: "provider",
          name: "code_execution",
          id: "google.code_execution",
          args: {},
        },
        {
          type: "provider",
          name: "google_search",
          id: "google.google_search",
          args: {
            searchTypes: { webSearch: {}, imageSearch: {} },
            timeRangeFilter: {
              startTime: "2026-01-01T00:00:00Z",
              endTime: "2026-07-01T00:00:00+00:00",
            },
          },
        },
      ]).tools,
      [
        { codeExecution: {} },
        {
          googleSearch: {
            searchTypes: { webSearch: {}, imageSearch: {} },
            timeRangeFilter: {
              startTime: "2026-01-01T00:00:00Z",
              endTime: "2026-07-01T00:00:00+00:00",
            },
          },
        },
      ],
    );

    const malformedCases: Array<{
      tools: RuntimeToolDefinition[];
      issue: string;
    }> = [
      {
        tools: [{
          type: "provider",
          name: "future_tool",
          id: "google.future_tool",
          args: {},
        }],
        issue: "Unsupported Google provider tool id",
      },
      {
        tools: [{
          type: "provider",
          name: "web_search",
          id: "anthropic.web_search",
          args: {},
        }],
        issue: "provider tool for another provider",
      },
      {
        tools: [{
          type: "provider",
          name: "code",
          id: "google.code_execution",
          args: {},
        }],
        issue: "provider tool name must be code_execution",
      },
      {
        tools: [{
          type: "provider",
          name: "code_execution",
          id: "google.code_execution",
          args: { enabled: true },
        }],
        issue: "google.code_execution args must be an empty object",
      },
      {
        tools: [{
          type: "provider",
          name: "google_search",
          id: "google.google_search",
          args: { futureOption: true },
        }],
        issue: "google.google_search args contained an unsupported field",
      },
      {
        tools: [{
          type: "provider",
          name: "google_search",
          id: "google.google_search",
          args: { searchTypes: { webSearch: { enabled: true } } },
        }],
        issue: "google.google_search webSearch must be an empty object",
      },
      {
        tools: [{
          type: "provider",
          name: "google_search",
          id: "google.google_search",
          args: {
            timeRangeFilter: { startTime: "2026-01-01T00:00:00Z" },
          },
        }],
        issue: "timeRangeFilter requires both startTime and endTime",
      },
      {
        tools: [{
          type: "provider",
          name: "google_search",
          id: "google.google_search",
          args: {
            timeRangeFilter: {
              startTime: "not-a-timestamp",
              endTime: "2026-01-01T00:00:00Z",
            },
          },
        }],
        issue: "startTime must be an RFC 3339 timestamp",
      },
      {
        tools: [{
          type: "provider",
          name: "google_search",
          id: "google.google_search",
          args: {
            timeRangeFilter: {
              startTime: "2026-02-29T00:00:00Z",
              endTime: "2026-03-01T00:00:00Z",
            },
          },
        }],
        issue: "startTime must be an RFC 3339 timestamp",
      },
      {
        tools: [{
          type: "provider",
          name: "google_search",
          id: "google.google_search",
          args: {
            timeRangeFilter: {
              startTime: "2024-02-29T24:00:00Z",
              endTime: "2024-03-01T00:00:00Z",
            },
          },
        }],
        issue: "startTime must be an RFC 3339 timestamp",
      },
      {
        tools: [{
          type: "provider",
          name: "google_search",
          id: "google.google_search",
          args: {
            timeRangeFilter: {
              startTime: "2026-07-01T00:00:00Z",
              endTime: "2026-01-01T00:00:00Z",
            },
          },
        }],
        issue: "startTime must not be after endTime",
      },
      {
        tools: [
          {
            type: "provider",
            name: "google_search",
            id: "google.google_search",
            args: {},
          },
          {
            type: "provider",
            name: "google_search",
            id: "google.google_search",
            args: {},
          },
        ],
        issue: "Google provider tool id was duplicated",
      },
    ];

    for (const { tools, issue } of malformedCases) {
      assertThrows(
        () => buildWithTools(tools),
        TypeError,
        issue,
      );
    }
  });

  it("replays signed Google assistant parts exactly from provider metadata", () => {
    const rawAssistantParts = [
      {
        text: "Private thought.",
        thought: true,
        thoughtSignature: "thought-signature",
      },
      {
        functionCall: {
          id: "tool_paris",
          name: "weather",
          args: { city: "Paris" },
        },
        thoughtSignature: "parallel-call-signature",
      },
      {
        functionCall: {
          id: "tool_london",
          name: "weather",
          args: { city: "London" },
        },
      },
    ];
    const warnings = createWarningCollector();

    const body = buildGoogleGenerateContentRequest(
      "google",
      {
        prompt: [{
          role: "assistant",
          content: [
            { type: "reasoning", text: "Private thought." },
            {
              type: "tool-call",
              toolCallId: "tool_paris",
              toolName: "weather",
              input: { city: "Paris" },
            },
            {
              type: "tool-call",
              toolCallId: "tool_london",
              toolName: "weather",
              input: { city: "London" },
            },
          ],
          providerMetadata: {
            google: { rawAssistantParts },
          },
        }],
      },
      warnings,
    );

    assertEquals(body.contents, [{
      role: "model",
      parts: rawAssistantParts,
    }]);
  });

  it("replays Google code-execution parts exactly even without a thought signature", () => {
    const rawAssistantParts = [
      {
        executableCode: {
          id: "code_1",
          language: "PYTHON",
          code: "print('ok')",
        },
      },
      {
        codeExecutionResult: {
          id: "code_1",
          outcome: "OUTCOME_OK",
          output: "ok\n",
        },
      },
      { text: "Done." },
    ];

    const body = buildGoogleGenerateContentRequest(
      "google",
      {
        prompt: [{
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "code_1",
              toolName: "code_execution",
              input: { language: "PYTHON", code: "print('ok')" },
              providerExecuted: true,
            },
            { type: "text", text: "Done." },
          ],
          providerMetadata: {
            google: { rawAssistantParts },
          },
        }],
      },
      createWarningCollector(),
    );

    assertEquals(body.contents, [{
      role: "model",
      parts: rawAssistantParts,
    }]);
  });

  it("fails closed on malformed signed-assistant metadata", () => {
    assertThrows(
      () =>
        buildGoogleGenerateContentRequest(
          "google",
          {
            prompt: [{
              role: "assistant",
              content: [{ type: "text", text: "Fallback text must not hide bad metadata." }],
              providerMetadata: {
                google: {
                  rawAssistantParts: [{ text: "answer", thoughtSignature: 42 }],
                },
              },
            }],
          },
          createWarningCollector(),
        ),
      TypeError,
      "Google thought signature must be a non-empty string",
    );
    assertThrows(
      () =>
        buildGoogleGenerateContentRequest(
          "google",
          {
            prompt: [{
              role: "assistant",
              content: [{
                type: "tool-call",
                toolCallId: "tool_1",
                toolName: "lookup",
                input: {},
              }],
              providerMetadata: {
                google: {
                  rawAssistantParts: [{
                    functionCall: { id: "tool_1", name: "lookup", args: [] },
                    thoughtSignature: "signature",
                  }],
                },
              },
            }],
          },
          createWarningCollector(),
        ),
      TypeError,
      "Google raw assistant function call is malformed",
    );
    assertThrows(
      () =>
        buildGoogleGenerateContentRequest(
          "google",
          {
            prompt: [{
              role: "assistant",
              content: [{ type: "text", text: "Do not fall back." }],
              providerMetadata: {
                google: {
                  rawAssistantParts: [{
                    executableCode: {
                      id: "code_1",
                      language: "PYTHON",
                      code: "print('ok')",
                    },
                  }, {
                    codeExecutionResult: {
                      id: "code_2",
                      outcome: "OUTCOME_OK",
                      output: "ok\n",
                    },
                  }],
                },
              },
            }],
          },
          createWarningCollector(),
        ),
      TypeError,
      "code execution result id did not match executable code",
    );
    assertThrows(
      () =>
        buildGoogleGenerateContentRequest(
          "google",
          {
            prompt: [{
              role: "assistant",
              content: [{ type: "text", text: "Do not fall back." }],
              providerMetadata: {
                google: {
                  rawAssistantParts: [{
                    inlineData: { mimeType: "image/png", data: "AAAA" },
                    thoughtSignature: "signature",
                  }],
                },
              },
            }],
          },
          createWarningCollector(),
        ),
      TypeError,
      'Google part data field "inlineData" is unsupported',
    );
    assertThrows(
      () =>
        buildGoogleGenerateContentRequest(
          "google",
          {
            prompt: [{
              role: "assistant",
              content: [{
                type: "tool-call",
                toolCallId: "code_1",
                toolName: "code_execution",
                input: { language: "PYTHON", code: "print('ok')" },
                providerExecuted: true,
              }],
            }],
          },
          createWarningCollector(),
        ),
      TypeError,
      "Google provider-executed assistant tool calls require exact raw replay metadata",
    );
  });

  it("accepts only non-negative safe explicit Google thinking budgets", () => {
    const prompt: RuntimePromptMessage[] = [{
      role: "user",
      content: [{ type: "text", text: "Think." }],
    }];
    const valid = buildGoogleGenerateContentRequest(
      "google",
      {
        prompt,
        reasoning: { enabled: true, effort: "low", budgetTokens: 0 },
      },
      createWarningCollector(),
    );
    assertEquals(valid.generationConfig, {
      thinkingConfig: {
        includeThoughts: true,
        thinkingBudget: 0,
      },
    });

    for (
      const budgetTokens of [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        1.5,
        -1,
        -2,
        Number.MAX_SAFE_INTEGER + 1,
      ]
    ) {
      assertThrows(
        () =>
          buildGoogleGenerateContentRequest(
            "google",
            {
              prompt,
              reasoning: { enabled: true, budgetTokens },
            },
            createWarningCollector(),
          ),
        TypeError,
        "Google reasoning budgetTokens must be a non-negative safe integer",
      );
    }
  });
});
