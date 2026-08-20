import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAssistantContentPart, RuntimePromptMessage } from "veryfront/provider/shared";
import {
  buildGoogleGenerateContentRequest,
  type RuntimeToolDefinition,
} from "./google-request-builder.ts";
import {
  createGoogleProviderMetadata,
  reconcileGoogleProviderMetadata,
} from "./google-thought-signatures.ts";

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

function buildGoogleAssistantReplay(
  rawAssistantParts: Array<Record<string, unknown>>,
  content: readonly RuntimeAssistantContentPart[],
  providerToolCalls?: readonly {
    toolCallId: string;
    toolName: string;
    input: unknown;
  }[],
) {
  return buildGoogleGenerateContentRequest(
    "google",
    {
      prompt: [{
        role: "assistant",
        content,
        ...(providerToolCalls ? { providerToolCalls } : {}),
        providerMetadata: {
          google: { rawAssistantParts },
        },
      }],
    },
    createWarningCollector(),
  );
}

function buildGoogleAssistantReplayFromMetadata(
  providerMetadata: Record<string, unknown>,
  content: readonly RuntimeAssistantContentPart[],
) {
  return buildGoogleGenerateContentRequest(
    "google",
    {
      prompt: [{ role: "assistant", content, providerMetadata }],
    },
    createWarningCollector(),
  );
}

function nestedGoogleArguments(wrappers: number): Record<string, unknown> {
  let value: Record<string, unknown> = { leaf: true };
  for (let index = 0; index < wrappers; index += 1) {
    value = { nested: value };
  }
  return value;
}

function assertJsonEquals(actual: unknown, expected: unknown): void {
  assertEquals(
    JSON.parse(JSON.stringify(actual)),
    JSON.parse(JSON.stringify(expected)),
  );
}

async function runNoBrandEval(script: string): Promise<unknown> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["eval", "--config=deno.json", script],
    cwd: new URL("../../../", import.meta.url),
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stderr = new TextDecoder().decode(output.stderr);
  assertEquals(output.code, 0, stderr);
  return JSON.parse(new TextDecoder().decode(output.stdout));
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
      // Provider options replace generationConfig, but the requested response
      // format is re-pinned afterwards so an override cannot drop it.
      generationConfig: { temperature: 0.9, responseMimeType: "application/json" },
      labels: { tenant: "acme" },
      cachedContent: "cachedContents/abc",
      safetySettings: [{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }],
      custom_google: true,
      custom_vertex: true,
    });
    assertEquals(warnings.drain().map((warning) => warning.setting), [
      "presencePenalty",
      "frequencyPenalty",
    ]);
  });

  it("pins structured JSON Schema after provider generationConfig overrides", () => {
    const schema = {
      type: "object",
      $defs: {
        forecast: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
      $ref: "#/$defs/forecast",
    };

    const body = buildGoogleGenerateContentRequest(
      "google",
      {
        prompt: [{ role: "user", content: [{ type: "text", text: "Forecast" }] }],
        responseFormat: { type: "json_schema", name: "Forecast", schema },
        providerOptions: {
          google: {
            generationConfig: {
              temperature: 0.9,
              responseMimeType: "text/plain",
              responseJsonSchema: { type: "string" },
            },
          },
        },
      },
      createWarningCollector(),
    );

    assertEquals(body.generationConfig, {
      temperature: 0.9,
      responseMimeType: "application/json",
      responseJsonSchema: schema,
    });
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

    assertJsonEquals(body.contents, [{
      role: "model",
      parts: rawAssistantParts,
    }]);
  });

  it("reconciles suppressed calls without stripping surviving signatures", () => {
    const suppressedPart = {
      functionCall: { id: "stale-1", name: "missing_tool", args: {} },
      thoughtSignature: "stale-signature",
    };
    const survivingPart = {
      functionCall: { id: "lookup-1", name: "lookup", args: { query: "Veryfront" } },
      thoughtSignature: "surviving-signature",
    };
    const metadata = createGoogleProviderMetadata([suppressedPart, survivingPart]);
    if (metadata === undefined) {
      throw new Error("Expected signed Google provider metadata");
    }

    assertJsonEquals(
      reconcileGoogleProviderMetadata(metadata, [{ id: "stale-1", name: "missing_tool" }]),
      {
        google: {
          rawAssistantParts: [survivingPart],
          rawAssistantPartIndexes: [1],
        },
      },
    );
    assertEquals(
      reconcileGoogleProviderMetadata(metadata, [{ id: "absent", name: "missing_tool" }]),
      metadata,
    );
    assertEquals(
      reconcileGoogleProviderMetadata(metadata, [
        { id: "stale-1", name: "missing_tool" },
        { id: "lookup-1", name: "lookup" },
      ]),
      undefined,
    );

    const unsignedSurvivor = createGoogleProviderMetadata([
      suppressedPart,
      { functionCall: { id: "lookup-1", name: "lookup", args: {} } },
    ]);
    if (unsignedSurvivor === undefined) {
      throw new Error("Expected mixed Google provider metadata");
    }
    assertThrows(
      () =>
        reconcileGoogleProviderMetadata(unsignedSurvivor, [{
          id: "stale-1",
          name: "missing_tool",
        }]),
      TypeError,
      "could not preserve a surviving signed tool call",
    );
  });

  it("keeps anonymous raw-position ids stable after suppressing an earlier call", () => {
    const suppressedPart = {
      functionCall: { name: "missing_tool", args: {} },
      thoughtSignature: "stale-signature",
    };
    const survivingPart = {
      functionCall: { name: "lookup", args: { query: "Veryfront" } },
      thoughtSignature: "surviving-signature",
    };
    const metadata = createGoogleProviderMetadata([suppressedPart, survivingPart]);
    if (metadata === undefined) {
      throw new Error("Expected signed Google provider metadata");
    }
    const reconciled = reconcileGoogleProviderMetadata(metadata, [{
      id: "tool-0",
      name: "missing_tool",
    }]);
    if (reconciled === undefined) {
      throw new Error("Expected surviving Google provider metadata");
    }

    const body = buildGoogleAssistantReplayFromMetadata(reconciled, [{
      type: "tool-call",
      toolCallId: "tool-1",
      toolName: "lookup",
      input: { query: "Veryfront" },
    }]);

    assertJsonEquals(body.contents, [{ role: "model", parts: [survivingPart] }]);
  });

  it("accepts raw-position and legacy occurrence ids while preserving exact correlation", () => {
    const rawAssistantParts: [
      Record<string, unknown>,
      Record<string, unknown>,
      Record<string, unknown>,
      Record<string, unknown>,
    ] = [{
      text: "Private thought.",
      thought: true,
      thoughtSignature: "signature",
    }, {
      functionCall: {
        name: "weather",
        args: { city: "Paris" },
      },
    }, {
      text: "Checking another city.",
    }, {
      functionCall: {
        name: "weather",
        args: { city: "London" },
      },
    }];
    const canonicalCalls: [
      Extract<RuntimeAssistantContentPart, { type: "tool-call" }>,
      Extract<RuntimeAssistantContentPart, { type: "tool-call" }>,
    ] = [{
      type: "tool-call",
      toolCallId: "tool-1",
      toolName: "weather",
      input: '{"city":"Paris"}',
    }, {
      type: "tool-call",
      toolCallId: "tool-3",
      toolName: "weather",
      input: { city: "London" },
    }];

    assertJsonEquals(
      buildGoogleAssistantReplay(rawAssistantParts, canonicalCalls).contents,
      [{ role: "model", parts: rawAssistantParts }],
    );
    assertJsonEquals(
      buildGoogleAssistantReplay(
        rawAssistantParts,
        [
          { ...canonicalCalls[0], toolCallId: "tool-0" },
          { ...canonicalCalls[1], toolCallId: "tool-1" },
        ],
      ).contents,
      [{ role: "model", parts: rawAssistantParts }],
    );

    const mismatches = [
      [{ ...canonicalCalls[0], toolCallId: "tool-0" }, canonicalCalls[1]],
      [canonicalCalls[0], { ...canonicalCalls[1], toolCallId: "tool-1" }],
      [{ ...canonicalCalls[0], toolCallId: "tool-0" }, {
        ...canonicalCalls[1],
        toolCallId: "tool-0",
      }],
      [{ ...canonicalCalls[0], toolName: "forecast" }, canonicalCalls[1]],
      [{ ...canonicalCalls[0], input: { city: "Berlin" } }, canonicalCalls[1]],
      [canonicalCalls[1], canonicalCalls[0]],
      [canonicalCalls[0]],
    ];
    for (const content of mismatches) {
      assertThrows(
        () => buildGoogleAssistantReplay(rawAssistantParts, content),
        TypeError,
        "Google raw assistant metadata did not match canonical provider tool history",
      );
    }
  });

  it("restarts legacy anonymous occurrence ids for each persisted assistant turn", () => {
    const firstRawParts = [{
      text: "First private thought.",
      thought: true,
      thoughtSignature: "first-signature",
    }, {
      functionCall: {
        name: "weather",
        args: { city: "Paris" },
      },
    }];
    const secondRawParts = [{
      text: "Second private thought.",
      thought: true,
      thoughtSignature: "second-signature",
    }, {
      functionCall: {
        name: "weather",
        args: { city: "London" },
      },
    }];
    const legacyCall = (city: string): RuntimeAssistantContentPart => ({
      type: "tool-call",
      toolCallId: "tool-0",
      toolName: "weather",
      input: { city },
    });

    const body = buildGoogleGenerateContentRequest(
      "google",
      {
        prompt: [{
          role: "assistant",
          content: [legacyCall("Paris")],
          providerMetadata: {
            google: { rawAssistantParts: firstRawParts },
          },
        }, {
          role: "user",
          content: [{ type: "text", text: "Check another city." }],
        }, {
          role: "assistant",
          content: [legacyCall("London")],
          providerMetadata: {
            google: { rawAssistantParts: secondRawParts },
          },
        }],
      },
      createWarningCollector(),
    );

    assertJsonEquals(body.contents, [{
      role: "model",
      parts: firstRawParts,
    }, {
      role: "user",
      parts: [{ text: "Check another city." }],
    }, {
      role: "model",
      parts: secondRawParts,
    }]);
  });

  it("allows raw-only client function replay only when its canonical projection is absent", () => {
    const rawAssistantParts = [{
      functionCall: {
        id: "raw_only",
        name: "historical_tool",
        args: { retained: true },
      },
      thoughtSignature: "signature",
    }];

    assertJsonEquals(
      buildGoogleAssistantReplay(rawAssistantParts, [{
        type: "text",
        text: "The normalized call was compacted.",
      }]).contents,
      [{ role: "model", parts: rawAssistantParts }],
    );
    assertThrows(
      () =>
        buildGoogleAssistantReplay(rawAssistantParts, [{
          type: "tool-call",
          toolCallId: "different",
          toolName: "historical_tool",
          input: { retained: true },
        }]),
      TypeError,
      "Google raw assistant metadata did not match canonical provider tool history",
    );
  });

  it("rejects duplicate client calls instead of coalescing identical ids", () => {
    const rawAssistantParts = [{
      functionCall: {
        id: "call_1",
        name: "lookup",
        args: { id: 1 },
      },
      thoughtSignature: "signature",
    }];
    const call: RuntimeAssistantContentPart = {
      type: "tool-call",
      toolCallId: "call_1",
      toolName: "lookup",
      input: { id: 1 },
    };

    assertThrows(
      () => buildGoogleAssistantReplay(rawAssistantParts, [call, { ...call }]),
      TypeError,
      "Google raw assistant metadata did not match canonical provider tool history",
    );
  });

  it("preserves interleaving between client and provider calls", () => {
    const rawAssistantParts = [{
      functionCall: {
        id: "lookup_1",
        name: "lookup",
        args: { id: 1 },
      },
      thoughtSignature: "signature",
    }, {
      executableCode: {
        id: "code_1",
        language: "PYTHON",
        code: "print(1)",
      },
    }, {
      codeExecutionResult: {
        id: "code_1",
        outcome: "OUTCOME_OK",
        output: "1\n",
      },
    }];
    const ordinaryCall: RuntimeAssistantContentPart = {
      type: "tool-call",
      toolCallId: "lookup_1",
      toolName: "lookup",
      input: { id: 1 },
    };
    const providerCall: RuntimeAssistantContentPart = {
      type: "tool-call",
      toolCallId: "code_1",
      toolName: "code_execution",
      input: { language: "PYTHON", code: "print(1)" },
      providerExecuted: true,
    };

    assertJsonEquals(
      buildGoogleAssistantReplay(
        rawAssistantParts,
        [ordinaryCall, providerCall],
      ).contents,
      [{ role: "model", parts: rawAssistantParts }],
    );
    assertThrows(
      () =>
        buildGoogleAssistantReplay(
          rawAssistantParts,
          [providerCall, ordinaryCall],
        ),
      TypeError,
      "Google raw assistant metadata did not match canonical provider tool history",
    );
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

    assertJsonEquals(body.contents, [{
      role: "model",
      parts: rawAssistantParts,
    }]);
  });

  it("rejects raw code-execution replay that disagrees with canonical provider content", () => {
    const rawAssistantParts = [{
      executableCode: {
        id: "code_1",
        language: "PYTHON",
        code: "print('ok')",
      },
    }, {
      codeExecutionResult: {
        id: "code_1",
        outcome: "OUTCOME_OK",
        output: "ok\n",
      },
    }];
    const build = (
      canonical: {
        id?: string;
        name?: string;
        input?: unknown;
        result?: unknown;
        isError?: boolean;
      },
      rawParts: Array<Record<string, unknown>> = rawAssistantParts,
    ) =>
      buildGoogleGenerateContentRequest(
        "google",
        {
          prompt: [{
            role: "assistant",
            content: [{
              type: "tool-call",
              toolCallId: canonical.id ?? "code_1",
              toolName: canonical.name ?? "code_execution",
              input: canonical.input ?? {
                language: "PYTHON",
                code: "print('ok')",
              },
              providerExecuted: true,
            }, {
              type: "tool-result",
              toolCallId: canonical.id ?? "code_1",
              toolName: canonical.name ?? "code_execution",
              result: canonical.result ?? {
                outcome: "OUTCOME_OK",
                output: "ok\n",
              },
              ...(canonical.isError === true ? { isError: true } : {}),
              providerExecuted: true,
            }],
            providerMetadata: {
              google: { rawAssistantParts: rawParts },
            },
          }],
        },
        createWarningCollector(),
      );

    assertJsonEquals(build({}).contents, [{
      role: "model",
      parts: rawAssistantParts,
    }]);
    for (
      const canonical of [
        { id: "different-id" },
        { name: "different-name" },
        { input: { language: "PYTHON", code: "print('different')" } },
        { result: { outcome: "OUTCOME_OK", output: "different\n" } },
        { isError: true },
      ]
    ) {
      assertThrows(
        () => build(canonical),
        TypeError,
        "Google raw assistant metadata did not match canonical provider tool history",
      );
    }
    assertThrows(
      () =>
        build({}, [{
          text: "Signed reasoning without code execution",
          thought: true,
          thoughtSignature: "signature",
        }]),
      TypeError,
      "Google raw assistant metadata did not match canonical provider tool history",
    );
  });

  it("correlates provider code calls and results one-for-one in occurrence order", () => {
    const rawAssistantParts: [
      Record<string, unknown>,
      Record<string, unknown>,
      Record<string, unknown>,
      Record<string, unknown>,
    ] = [{
      executableCode: {
        id: "code_a",
        language: "PYTHON",
        code: "print('a')",
      },
    }, {
      executableCode: {
        id: "code_b",
        language: "PYTHON",
        code: "print('b')",
      },
    }, {
      codeExecutionResult: {
        id: "code_a",
        outcome: "OUTCOME_OK",
        output: "a\n",
      },
    }, {
      codeExecutionResult: {
        id: "code_b",
        outcome: "OUTCOME_FAILED",
        output: "b failed\n",
      },
    }];
    const calls: [
      RuntimeAssistantContentPart,
      RuntimeAssistantContentPart,
    ] = [{
      type: "tool-call",
      toolCallId: "code_a",
      toolName: "code_execution",
      input: { language: "PYTHON", code: "print('a')" },
      providerExecuted: true,
    }, {
      type: "tool-call",
      toolCallId: "code_b",
      toolName: "code_execution",
      input: { language: "PYTHON", code: "print('b')" },
      providerExecuted: true,
    }];
    const results: [
      RuntimeAssistantContentPart,
      RuntimeAssistantContentPart,
    ] = [{
      type: "tool-result",
      toolCallId: "code_a",
      toolName: "code_execution",
      result: { outcome: "OUTCOME_OK", output: "a\n" },
      providerExecuted: true,
    }, {
      type: "tool-result",
      toolCallId: "code_b",
      toolName: "code_execution",
      result: { outcome: "OUTCOME_FAILED", output: "b failed\n" },
      isError: true,
      providerExecuted: true,
    }];

    assertJsonEquals(
      buildGoogleAssistantReplay(rawAssistantParts, [...calls, ...results]).contents,
      [{ role: "model", parts: rawAssistantParts }],
    );
    for (
      const content of [
        [calls[1], calls[0], ...results],
        [...calls, results[1], results[0]],
        [calls[0], { ...calls[0] }, ...results],
        [...calls, results[0], { ...results[0] }],
      ]
    ) {
      assertThrows(
        () => buildGoogleAssistantReplay(rawAssistantParts, content),
        TypeError,
        "Google raw assistant metadata did not match canonical provider tool history",
      );
    }

    const interleavedRawParts = [
      rawAssistantParts[0],
      rawAssistantParts[2],
      rawAssistantParts[1],
      rawAssistantParts[3],
    ];
    assertJsonEquals(
      buildGoogleAssistantReplay(
        interleavedRawParts,
        [calls[0], results[0], calls[1], results[1]],
      ).contents,
      [{ role: "model", parts: interleavedRawParts }],
    );
    assertThrows(
      () =>
        buildGoogleAssistantReplay(
          interleavedRawParts,
          [...calls, ...results],
        ),
      TypeError,
      "Google raw assistant metadata did not match canonical provider tool history",
    );
  });

  it("coalesces only matching providerToolCalls/content projections", () => {
    const rawAssistantParts = [{
      executableCode: {
        id: "code_a",
        language: "PYTHON",
        code: "print('a')",
      },
    }, {
      executableCode: {
        id: "code_b",
        language: "PYTHON",
        code: "print('b')",
      },
    }, {
      codeExecutionResult: {
        id: "code_a",
        outcome: "OUTCOME_OK",
        output: "a\n",
      },
    }, {
      codeExecutionResult: {
        id: "code_b",
        outcome: "OUTCOME_OK",
        output: "b\n",
      },
    }];
    const contentCalls: [
      RuntimeAssistantContentPart,
      RuntimeAssistantContentPart,
    ] = [{
      type: "tool-call",
      toolCallId: "code_a",
      toolName: "code_execution",
      input: { language: "PYTHON", code: "print('a')" },
      providerExecuted: true,
    }, {
      type: "tool-call",
      toolCallId: "code_b",
      toolName: "code_execution",
      input: { language: "PYTHON", code: "print('b')" },
      providerExecuted: true,
    }];
    const providerToolCalls: [
      { toolCallId: string; toolName: string; input: unknown },
      { toolCallId: string; toolName: string; input: unknown },
    ] = [{
      toolCallId: "code_a",
      toolName: "code_execution",
      input: { language: "PYTHON", code: "print('a')" },
    }, {
      toolCallId: "code_b",
      toolName: "code_execution",
      input: { language: "PYTHON", code: "print('b')" },
    }];

    assertJsonEquals(
      buildGoogleAssistantReplay(
        rawAssistantParts,
        contentCalls,
        providerToolCalls,
      ).contents,
      [{ role: "model", parts: rawAssistantParts }],
    );
    assertThrows(
      () =>
        buildGoogleAssistantReplay(
          rawAssistantParts,
          contentCalls,
          [providerToolCalls[1], providerToolCalls[0]],
        ),
      TypeError,
      "Google raw assistant metadata did not match canonical provider tool history",
    );
    assertThrows(
      () =>
        buildGoogleAssistantReplay(
          rawAssistantParts,
          contentCalls,
          [providerToolCalls[0], { ...providerToolCalls[0] }],
        ),
      TypeError,
      "Google raw assistant metadata did not match canonical provider tool history",
    );
  });

  it("uses the provider's deterministic ids when correlating anonymous code execution", () => {
    const rawAssistantParts = [{
      functionCall: {
        id: "google-code-execution-0",
        name: "lookup",
        args: {},
      },
      thoughtSignature: "signature",
    }, {
      executableCode: {
        language: "PYTHON",
        code: "print('ok')",
      },
    }, {
      codeExecutionResult: {
        outcome: "OUTCOME_OK",
        output: "ok\n",
      },
    }];

    const body = buildGoogleGenerateContentRequest(
      "google",
      {
        prompt: [{
          role: "assistant",
          content: [{
            type: "tool-call",
            toolCallId: "google-code-execution-1",
            toolName: "code_execution",
            input: '{"code":"print(\'ok\')","language":"PYTHON"}',
            providerExecuted: true,
          }],
          providerMetadata: {
            google: { rawAssistantParts },
          },
        }],
      },
      createWarningCollector(),
    );

    assertJsonEquals(body.contents, [{
      role: "model",
      parts: rawAssistantParts,
    }]);
  });

  it("correlates raw code execution with legacy providerToolCalls metadata", () => {
    assertThrows(
      () =>
        buildGoogleGenerateContentRequest(
          "google",
          {
            prompt: [{
              role: "assistant",
              content: [{ type: "text", text: "Execution complete" }],
              providerToolCalls: [{
                toolCallId: "different-id",
                toolName: "code_execution",
                input: { language: "PYTHON", code: "print('ok')" },
              }],
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
                      id: "code_1",
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
      "Google raw assistant metadata did not match canonical provider tool history",
    );
  });

  it("owns exact-replay metadata without invoking accessors or retaining live input", () => {
    let getterReads = 0;
    const hostileExecutableCode = Object.defineProperty(
      { id: "code_1", language: "PYTHON" },
      "code",
      {
        enumerable: true,
        get() {
          getterReads += 1;
          return "print('changed')";
        },
      },
    );
    assertThrows(
      () =>
        createGoogleProviderMetadata([{
          executableCode: hostileExecutableCode,
        }]),
      TypeError,
      "Provider JSON snapshot must contain only enumerable data properties",
    );
    assertEquals(getterReads, 0);
    assertThrows(
      () =>
        buildGoogleGenerateContentRequest(
          "google",
          {
            prompt: [{
              role: "assistant",
              content: [{ type: "text", text: "Do not invoke the getter." }],
              providerMetadata: {
                google: {
                  rawAssistantParts: [{
                    executableCode: hostileExecutableCode,
                  }],
                },
              },
            }],
          },
          createWarningCollector(),
        ),
      TypeError,
      "Provider JSON snapshot must contain only enumerable data properties",
    );
    assertEquals(getterReads, 0);

    const sourcePart = {
      functionCall: {
        id: "call_1",
        name: "lookup",
        args: { value: "original" },
      },
      thoughtSignature: "signature",
    };
    const sourceParts = [sourcePart];
    const providerMetadata = createGoogleProviderMetadata(sourceParts);
    sourcePart.functionCall.args.value = "mutated";
    assertEquals(Object.isFrozen(providerMetadata), true);

    const body = buildGoogleGenerateContentRequest(
      "google",
      {
        prompt: [{
          role: "assistant",
          content: [{
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "lookup",
            input: { value: "original" },
          }],
          providerMetadata,
        }],
      },
      createWarningCollector(),
    );
    assertJsonEquals(body.contents, [{
      role: "model",
      parts: [{
        functionCall: {
          args: { value: "original" },
          id: "call_1",
          name: "lookup",
        },
        thoughtSignature: "signature",
      }],
    }]);
  });

  it("isolates Google replay from unrelated provider metadata namespaces", () => {
    let unrelatedGetterReads = 0;
    const unrelatedNamespace = Object.defineProperty(
      { oversized: "x".repeat(8 * 1024 * 1024 + 1) },
      "hostile",
      {
        enumerable: true,
        get() {
          unrelatedGetterReads += 1;
          return "private";
        },
      },
    );
    const body = buildGoogleGenerateContentRequest(
      "google",
      {
        prompt: [{
          role: "assistant",
          content: [{ type: "text", text: "No Google metadata." }],
          providerMetadata: {
            anotherProvider: unrelatedNamespace,
          },
        }],
      },
      createWarningCollector(),
    );
    assertEquals(body.contents, [{
      role: "model",
      parts: [{ text: "No Google metadata." }],
    }]);
    assertEquals(unrelatedGetterReads, 0);

    let groundingGetterReads = 0;
    const hostileGroundingMetadata = Object.defineProperty(
      { oversized: "x".repeat(8 * 1024 * 1024 + 1) },
      "privateField",
      {
        enumerable: true,
        get() {
          groundingGetterReads += 1;
          return "private";
        },
      },
    );
    const groundingOnlyBody = buildGoogleGenerateContentRequest(
      "google",
      {
        prompt: [{
          role: "assistant",
          content: [{ type: "text", text: "No exact replay metadata." }],
          providerMetadata: {
            google: {
              groundingMetadata: hostileGroundingMetadata,
              futureMetadata: new Date(0),
            },
          },
        }],
      },
      createWarningCollector(),
    );
    assertEquals(groundingOnlyBody.contents, [{
      role: "model",
      parts: [{ text: "No exact replay metadata." }],
    }]);
    assertEquals(groundingGetterReads, 0);

    let googleGetterReads = 0;
    const providerMetadata = Object.defineProperty(
      {},
      "google",
      {
        enumerable: true,
        get() {
          googleGetterReads += 1;
          return { rawAssistantParts: [] };
        },
      },
    );
    assertThrows(
      () =>
        buildGoogleGenerateContentRequest(
          "google",
          {
            prompt: [{
              role: "assistant",
              content: [{ type: "text", text: "Do not invoke Google metadata." }],
              providerMetadata,
            }],
          },
          createWarningCollector(),
        ),
      TypeError,
      "Google provider metadata namespace must be an enumerable data property",
    );
    assertEquals(googleGetterReads, 0);
  });

  it("accepts plain thought-signature and grounding metadata without Proxy detection", async () => {
    const result = await runNoBrandEval(`
      Object.defineProperty(globalThis, "caches", {
        configurable: true,
        value: {},
      });
      Object.defineProperty(globalThis, "WebSocketPair", {
        configurable: true,
        value: function WebSocketPair() {},
      });

      const { canIdentifyProxyWithoutHooks } = await import(
        "./src/platform/compat/error-introspection.ts"
      );
      const { buildGoogleGenerateContentRequest } = await import(
        "./extensions/ext-llm-google/src/google-request-builder.ts"
      );
      const { createGoogleProviderMetadata } = await import(
        "./extensions/ext-llm-google/src/google-thought-signatures.ts"
      );

      const metadata = createGoogleProviderMetadata(
        [{ text: "Private thought.", thought: true, thoughtSignature: "sig_edge" }],
        { source: "google-search" },
      );
      const body = buildGoogleGenerateContentRequest(
        "google",
        {
          prompt: [{
            role: "assistant",
            content: [{ type: "reasoning", text: "Private thought." }],
            providerMetadata: metadata,
          }],
        },
        { push() {}, drain() { return []; } },
      );
      console.log(JSON.stringify({
        canIdentifyProxyWithoutHooks,
        metadata,
        parts: body.contents[0].parts,
      }));
    `);
    assertEquals(result, {
      canIdentifyProxyWithoutHooks: false,
      metadata: {
        google: {
          rawAssistantParts: [{
            text: "Private thought.",
            thought: true,
            thoughtSignature: "sig_edge",
          }],
          groundingMetadata: { source: "google-search" },
        },
      },
      parts: [{
        text: "Private thought.",
        thought: true,
        thoughtSignature: "sig_edge",
      }],
    });
  });

  it("enforces the exact Google raw-part count boundary", () => {
    const atLimit = Array.from(
      { length: 4_096 },
      (_, index) => index === 0 ? { text: "", thoughtSignature: "signature" } : { text: "" },
    );
    const metadata = createGoogleProviderMetadata(atLimit);
    const googleMetadata = metadata?.google as Record<string, unknown>;
    assertEquals(
      (googleMetadata.rawAssistantParts as unknown[]).length,
      4_096,
    );
    assertEquals(
      buildGoogleAssistantReplay(atLimit, [{
        type: "text",
        text: "The raw projection is retained.",
      }]).contents.length,
      1,
    );

    const overLimit = [...atLimit, { text: "" }];
    assertThrows(
      () => createGoogleProviderMetadata(overLimit),
      TypeError,
      "Google raw assistant parts exceeded 4096 entries",
    );
    assertThrows(
      () =>
        buildGoogleAssistantReplay(overLimit, [{
          type: "text",
          text: "Do not replay too many raw parts.",
        }]),
      TypeError,
      "Google raw assistant parts exceeded 4096 entries",
    );
  });

  it("does not charge omitted ordinary parts against exact-replay budgets", () => {
    const ordinaryParts = Array.from(
      { length: 4_097 },
      (_, index) => ({
        text: index === 0 ? "x".repeat(8 * 1024 * 1024 + 1) : "",
      }),
    );
    assertEquals(createGoogleProviderMetadata(ordinaryParts), undefined);

    const groundingMetadata = { source: "google-search" };
    assertJsonEquals(
      createGoogleProviderMetadata(ordinaryParts, groundingMetadata),
      {
        google: { groundingMetadata },
      },
    );

    let textGetterReads = 0;
    const ordinaryAccessorPart = Object.defineProperty(
      {},
      "text",
      {
        enumerable: true,
        get() {
          textGetterReads += 1;
          return "not persisted";
        },
      },
    ) as Record<string, unknown>;
    assertEquals(
      createGoogleProviderMetadata([ordinaryAccessorPart]),
      undefined,
    );
    assertEquals(textGetterReads, 0);
  });

  it("enforces the exact 8 MiB Google provider-metadata boundary", () => {
    const maxBytes = 8 * 1024 * 1024;
    const skeleton = {
      google: {
        rawAssistantParts: [{
          text: "",
          thoughtSignature: "signature",
        }],
      },
    };
    const fixedBytes = new TextEncoder().encode(JSON.stringify(skeleton)).byteLength;
    const exactText = "a".repeat(maxBytes - fixedBytes);
    const exactMetadata = createGoogleProviderMetadata([{
      text: exactText,
      thoughtSignature: "signature",
    }]);
    assertEquals(
      new TextEncoder().encode(JSON.stringify(exactMetadata)).byteLength,
      maxBytes,
    );
    assertEquals(
      buildGoogleGenerateContentRequest(
        "google",
        {
          prompt: [{
            role: "assistant",
            content: [{ type: "text", text: "Compacted canonical output." }],
            providerMetadata: exactMetadata,
          }],
        },
        createWarningCollector(),
      ).contents.length,
      1,
    );

    assertThrows(
      () =>
        createGoogleProviderMetadata([{
          text: `${exactText}a`,
          thoughtSignature: "signature",
        }]),
      TypeError,
      "Provider JSON snapshot exceeded 8388608 UTF-8 bytes",
    );

    const rawPartsSkeleton = skeleton.google.rawAssistantParts;
    const rawPartsFixedBytes =
      new TextEncoder().encode(JSON.stringify(rawPartsSkeleton)).byteLength;
    const exactReplayText = "a".repeat(maxBytes - rawPartsFixedBytes);
    assertEquals(
      buildGoogleAssistantReplay([{
        text: exactReplayText,
        thoughtSignature: "signature",
      }], [{
        type: "text",
        text: "Replay the exact boundary.",
      }]).contents.length,
      1,
    );
    assertThrows(
      () =>
        buildGoogleGenerateContentRequest(
          "google",
          {
            prompt: [{
              role: "assistant",
              content: [{ type: "text", text: "Do not replay oversized metadata." }],
              providerMetadata: {
                google: {
                  rawAssistantParts: [{
                    text: `${exactReplayText}a`,
                    thoughtSignature: "signature",
                  }],
                },
              },
            }],
          },
          createWarningCollector(),
        ),
      TypeError,
      "Provider JSON snapshot exceeded 8388608 UTF-8 bytes",
    );
  });

  it("enforces the exact Google metadata depth and node boundaries", () => {
    const exactDepthParts = [{
      functionCall: {
        id: "call_1",
        name: "lookup",
        args: nestedGoogleArguments(58),
      },
      thoughtSignature: "signature",
    }];
    assertEquals(
      createGoogleProviderMetadata(exactDepthParts) !== undefined,
      true,
    );
    assertEquals(
      buildGoogleAssistantReplay(exactDepthParts, [{
        type: "text",
        text: "The canonical call was compacted.",
      }]).contents.length,
      1,
    );
    const overDepthParts = [{
      functionCall: {
        id: "call_1",
        name: "lookup",
        args: nestedGoogleArguments(59),
      },
      thoughtSignature: "signature",
    }];
    assertThrows(
      () => createGoogleProviderMetadata(overDepthParts),
      TypeError,
      "Provider JSON snapshot exceeded maximum depth 64",
    );
    const exactReplayDepthParts = [{
      functionCall: {
        id: "call_1",
        name: "lookup",
        args: nestedGoogleArguments(60),
      },
      thoughtSignature: "signature",
    }];
    assertEquals(
      buildGoogleAssistantReplay(exactReplayDepthParts, [{
        type: "text",
        text: "The canonical call was compacted.",
      }]).contents.length,
      1,
    );
    const overReplayDepthParts = [{
      functionCall: {
        id: "call_1",
        name: "lookup",
        args: nestedGoogleArguments(61),
      },
      thoughtSignature: "signature",
    }];
    assertThrows(
      () =>
        buildGoogleAssistantReplay(overReplayDepthParts, [{
          type: "text",
          text: "Do not replay excessively deep metadata.",
        }]),
      TypeError,
      "Provider JSON snapshot exceeded maximum depth 64",
    );

    const exactNodeValues = Array.from({ length: 65_526 }, () => true);
    const exactNodeParts = [{
      functionCall: {
        id: "call_1",
        name: "lookup",
        args: { values: exactNodeValues },
      },
      thoughtSignature: "signature",
    }];
    assertEquals(
      createGoogleProviderMetadata(exactNodeParts) !== undefined,
      true,
    );
    assertEquals(
      buildGoogleAssistantReplay(exactNodeParts, [{
        type: "text",
        text: "The canonical call was compacted.",
      }]).contents.length,
      1,
    );
    const overNodeParts = [{
      functionCall: {
        id: "call_1",
        name: "lookup",
        args: { values: [...exactNodeValues, true] },
      },
      thoughtSignature: "signature",
    }];
    assertThrows(
      () => createGoogleProviderMetadata(overNodeParts),
      TypeError,
      "Provider JSON snapshot exceeded 65536 nodes",
    );
    const exactReplayNodeValues = [...exactNodeValues, true, true];
    const exactReplayNodeParts = [{
      functionCall: {
        id: "call_1",
        name: "lookup",
        args: { values: exactReplayNodeValues },
      },
      thoughtSignature: "signature",
    }];
    assertEquals(
      buildGoogleAssistantReplay(exactReplayNodeParts, [{
        type: "text",
        text: "The canonical call was compacted.",
      }]).contents.length,
      1,
    );
    const overReplayNodeParts = [{
      functionCall: {
        id: "call_1",
        name: "lookup",
        args: { values: [...exactReplayNodeValues, true] },
      },
      thoughtSignature: "signature",
    }];
    assertThrows(
      () =>
        buildGoogleAssistantReplay(overReplayNodeParts, [{
          type: "text",
          text: "Do not replay excessive metadata nodes.",
        }]),
      TypeError,
      "Provider JSON snapshot exceeded 65536 nodes",
    );
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
    assertThrows(
      () =>
        buildGoogleGenerateContentRequest(
          "google",
          {
            prompt: [{
              role: "assistant",
              content: [{
                type: "tool-result",
                toolCallId: "code_1",
                toolName: "code_execution",
                result: { outcome: "OK" },
                providerExecuted: true,
              }],
            }],
          },
          createWarningCollector(),
        ),
      TypeError,
      "Google provider-executed assistant tool results require exact raw replay metadata",
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
