import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntimePromptMessage, RuntimePromptMessage } from "veryfront/provider/shared";
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
  it("requests reasoning summaries by default for Veryfront Cloud GPT-5.5 Responses models", () => {
    const warnings = createWarningCollector();

    const body = buildOpenAIResponsesRequest(
      "gpt-5.5",
      "veryfront-cloud",
      {
        prompt: [{ role: "user", content: [{ type: "text", text: "Think carefully." }] }],
        temperature: 0.2,
      },
      true,
      warnings,
    );

    assertEquals(body.reasoning, { effort: "medium", summary: "auto" });
    assertEquals(body.store, false);
    assertEquals(body.temperature, undefined);
    assertEquals(warnings.drain().map((warning) => warning.setting), ["temperature"]);
  });

  it("omits reasoning summaries for direct OpenAI default reasoning requests", () => {
    const warnings = createWarningCollector();

    const body = buildOpenAIResponsesRequest(
      "gpt-5.5",
      "openai",
      {
        prompt: [{ role: "user", content: [{ type: "text", text: "Think carefully." }] }],
      },
      true,
      warnings,
    );

    assertEquals(body.reasoning, { effort: "medium" });
    assertEquals(body.store, false);
  });

  it("merges the legacy openai-compatible provider options bucket below openai keys", () => {
    const warnings = createWarningCollector();

    const body = buildOpenAIResponsesRequest(
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

  it("drops unsupported background mode instead of returning a nonterminal response", () => {
    const warnings = createWarningCollector();

    const body = buildOpenAIResponsesRequest(
      "gpt-5.5",
      "openai",
      {
        prompt: [{ role: "user", content: [{ type: "text", text: "Think carefully." }] }],
        providerOptions: {
          openai: { background: true },
        },
      },
      false,
      warnings,
    );

    assertEquals(Object.hasOwn(body, "background"), false);
    assertEquals(warnings.drain(), [{
      type: "unsupported-setting",
      provider: "openai",
      setting: "background",
      details:
        "Background Responses are asynchronous and cannot satisfy the runtime's immediate result contract; the value was dropped.",
    }]);
  });

  it("protects Responses transport, prompt, model, and statelessness fields", () => {
    const providerBucket: Record<string, unknown> = {
      model: "attacker-model",
      input: [{ role: "user", content: "replaced" }],
      instructions: "replaced",
      store: true,
      stream: false,
      custom_option: true,
    };
    Object.defineProperty(providerBucket, "__proto__", {
      value: { polluted: true },
      enumerable: true,
    });
    const prompt: RuntimePromptMessage[] = [
      { role: "system", content: "Original instructions" },
      { role: "user", content: [{ type: "text", text: "Original input" }] },
    ];

    const streamed = buildOpenAIResponsesRequest(
      "gpt-5.5",
      "openai",
      { prompt, providerOptions: { openai: providerBucket } },
      true,
      createWarningCollector(),
    );
    assertEquals(streamed.model, "gpt-5.5");
    assertEquals(streamed.input, [{
      role: "user",
      content: [{ type: "input_text", text: "Original input" }],
    }]);
    assertEquals(streamed.instructions, "Original instructions");
    assertEquals(streamed.store, false);
    assertEquals(streamed.stream, true);
    assertEquals(streamed.custom_option, true);
    assertEquals(Object.getPrototypeOf(streamed), Object.prototype);
    assertEquals((streamed as Record<string, unknown>).polluted, undefined);

    const generated = buildOpenAIResponsesRequest(
      "gpt-5.5",
      "openai",
      {
        prompt: [{ role: "user", content: [{ type: "text", text: "Original" }] }],
        providerOptions: { openai: { stream: true } },
      },
      false,
      createWarningCollector(),
    );
    assertEquals(Object.hasOwn(generated, "stream"), false);
  });

  it("preserves Responses function argument text and serializes structured inputs", () => {
    const body = buildOpenAIResponsesRequest(
      "gpt-5.5",
      "openai",
      {
        prompt: [{
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-text",
              toolName: "lookup",
              input: '{"id":"text"}',
            },
            {
              type: "tool-call",
              toolCallId: "call-object",
              toolName: "lookup",
              input: { id: "object" },
            },
          ],
        }],
      },
      false,
      createWarningCollector(),
    );

    assertEquals(body.input, [
      {
        type: "function_call",
        call_id: "call-text",
        name: "lookup",
        arguments: '{"id":"text"}',
      },
      {
        type: "function_call",
        call_id: "call-object",
        name: "lookup",
        arguments: '{"id":"object"}',
      },
    ]);
  });

  it("replays exact validated response output items before the next user turn", () => {
    const rawOutputItems = [
      {
        id: "rs_1",
        type: "reasoning",
        status: "completed",
        summary: [{ type: "summary_text", text: "Summary" }],
        content: [{ type: "reasoning_text", text: "Reasoning" }],
        encrypted_content: "encrypted_1",
      },
      {
        id: "fc_1",
        type: "function_call",
        status: "completed",
        call_id: "call_1",
        name: "lookup",
        arguments: '{"id":"one"}',
      },
      {
        id: "msg_1",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "Answer" }],
      },
    ];
    const prompt: RuntimePromptMessage[] = [
      { role: "user", content: [{ type: "text", text: "Question" }] },
      {
        role: "assistant",
        content: [{ type: "text", text: "A lossy projection" }],
        providerMetadata: {
          openai: { rawResponseOutputItems: rawOutputItems },
        },
      },
      { role: "user", content: [{ type: "text", text: "Continue" }] },
    ];

    const body = buildOpenAIResponsesRequest(
      "gpt-5.5",
      "openai",
      { prompt },
      false,
      createWarningCollector(),
    );

    assertEquals(body.input, [
      {
        role: "user",
        content: [{ type: "input_text", text: "Question" }],
      },
      ...rawOutputItems,
      {
        role: "user",
        content: [{ type: "input_text", text: "Continue" }],
      },
    ]);
  });

  it("keeps Responses function-call arguments object-encoded and string outputs unquoted", () => {
    const body = buildOpenAIResponsesRequest(
      "gpt-4o-mini",
      "openai",
      {
        prompt: [{
          role: "assistant",
          content: [{
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "lookup",
            input: { id: "one" },
          }],
        }, {
          role: "tool",
          content: [{
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "lookup",
            output: { type: "json", value: "plain output" },
          }],
        }],
      },
      false,
      createWarningCollector(),
    );

    assertEquals(body.input, [{
      type: "function_call",
      call_id: "call_1",
      name: "lookup",
      arguments: '{"id":"one"}',
    }, {
      type: "function_call_output",
      call_id: "call_1",
      output: "plain output",
    }]);
  });

  it("keeps explicit reasoning summaries for direct OpenAI requests", () => {
    const warnings = createWarningCollector();

    const body = buildOpenAIResponsesRequest(
      "gpt-5.5",
      "openai",
      {
        prompt: [{ role: "user", content: [{ type: "text", text: "Think carefully." }] }],
        reasoning: { enabled: true, effort: "high" },
      },
      true,
      warnings,
    );

    assertEquals(body.reasoning, { effort: "high", summary: "auto" });
  });

  it("does not set default reasoning for OpenAI-compatible providers but still drops rejected sampling params", () => {
    const warnings = createWarningCollector();

    const body = buildOpenAIResponsesRequest(
      "gpt-5.5",
      "azure",
      {
        prompt: [{ role: "user", content: [{ type: "text", text: "Think carefully." }] }],
        temperature: 0.2,
      },
      true,
      warnings,
    );

    assertEquals(body.reasoning, undefined);
    assertEquals(body.temperature, undefined);
    assertEquals(warnings.drain().map((warning) => warning.setting), ["temperature"]);
  });

  it("drops rejected sampling params when explicit reasoning is disabled", () => {
    const warnings = createWarningCollector();

    const body = buildOpenAIResponsesRequest(
      "o3-mini",
      "openai",
      {
        prompt: [{ role: "user", content: [{ type: "text", text: "Think carefully." }] }],
        reasoning: { enabled: false },
        temperature: 0.2,
      },
      true,
      warnings,
    );

    assertEquals(body.reasoning, undefined);
    assertEquals(body.temperature, undefined);
    assertEquals(warnings.drain().map((warning) => warning.setting), ["temperature"]);
  });

  it("keeps runtime function tools explicitly non-strict in Responses requests", () => {
    const warnings = createWarningCollector();

    const body = buildOpenAIResponsesRequest(
      "gpt-5.4-nano",
      "veryfront-cloud",
      {
        prompt: [{ role: "user", content: [{ type: "text", text: "Search knowledge." }] }],
        tools: [{
          type: "function",
          name: "search_knowledge",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
              cursor: { type: "string" },
            },
            required: ["query"],
          },
        }],
      },
      true,
      warnings,
    );

    assertEquals(body.tools, [{
      type: "function",
      name: "search_knowledge",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          cursor: { type: "string" },
        },
        required: ["query"],
      },
    }]);
  });

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
      store: false,
      include: [
        "reasoning.encrypted_content",
        "web_search_call.action.sources",
      ],
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
          strict: false,
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

  it("rejects raw hosted-search replay that disagrees with canonical provider content", () => {
    const rawWebSearch = {
      type: "web_search_call",
      id: "ws_1",
      status: "completed",
      action: { type: "search", query: "Veryfront" },
    };
    const tools = [{
      type: "provider" as const,
      name: "research",
      id: "openai.web_search" as const,
      args: {},
    }];

    const build = (
      canonical: {
        id?: string;
        name?: string;
        resultName?: string;
        input?: unknown;
        result?: unknown;
      },
      rawOutputItems: Array<Record<string, unknown>> = [rawWebSearch],
    ) =>
      buildOpenAIResponsesRequest(
        "gpt-5.4-nano",
        "openai",
        {
          prompt: [{
            role: "assistant",
            content: [{
              type: "tool-call",
              toolCallId: canonical.id ?? "ws_1",
              toolName: canonical.name ?? "research",
              input: canonical.input ?? {
                type: "search",
                query: "Veryfront",
              },
              providerExecuted: true,
            }, {
              type: "tool-result",
              toolCallId: canonical.id ?? "ws_1",
              toolName: canonical.resultName ?? canonical.name ?? "research",
              result: canonical.result ?? { status: "completed" },
              providerExecuted: true,
            }],
            providerMetadata: {
              openai: { rawResponseOutputItems: rawOutputItems },
            },
          }],
          tools,
        },
        false,
        createWarningCollector(),
      );

    assertEquals(build({}).input, [rawWebSearch]);
    assertEquals(
      build({ name: "historical-search", resultName: "historical-search" }).input,
      [rawWebSearch],
    );
    for (
      const canonical of [
        { id: "different-id" },
        { resultName: "different-name" },
        { input: { type: "search", query: "different query" } },
        { result: { status: "failed" } },
      ]
    ) {
      assertThrows(
        () => build(canonical),
        TypeError,
        "OpenAI raw response metadata did not match canonical provider tool history",
      );
    }
    assertThrows(
      () =>
        build({}, [{
          id: "msg_1",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "No hosted search here" }],
        }]),
      TypeError,
      "OpenAI raw response metadata did not match canonical provider tool history",
    );
  });

  it("correlates ordinary raw function calls with surviving canonical content", () => {
    const rawFunctionCall = {
      id: "fc_item_1",
      type: "function_call",
      status: "completed",
      call_id: "call_1",
      name: "lookup",
      arguments: '{"id":"one","options":{"fresh":true}}',
    };
    const build = (
      canonical: { id?: string; name?: string; input?: unknown },
    ) =>
      buildOpenAIResponsesRequest(
        "gpt-5.4-nano",
        "openai",
        {
          prompt: [{
            role: "assistant",
            content: [{
              type: "tool-call",
              toolCallId: canonical.id ?? "call_1",
              toolName: canonical.name ?? "lookup",
              input: canonical.input ?? {
                options: { fresh: true },
                id: "one",
              },
            }],
            providerMetadata: {
              openai: { rawResponseOutputItems: [rawFunctionCall] },
            },
          }],
        },
        false,
        createWarningCollector(),
      );

    assertEquals(build({}).input, [rawFunctionCall]);
    for (
      const canonical of [
        { id: "different-id" },
        { name: "different-name" },
        { input: { id: "different" } },
      ]
    ) {
      assertThrows(
        () => build(canonical),
        TypeError,
        "OpenAI raw response metadata did not match canonical provider tool history",
      );
    }
  });

  it("keeps validated raw function calls when canonical content was compacted", () => {
    const rawFunctionCall = {
      id: "fc_item_1",
      type: "function_call",
      status: "completed",
      call_id: "call_1",
      name: "lookup",
      arguments: '{"id":"one"}',
    };

    const body = buildOpenAIResponsesRequest(
      "gpt-5.4-nano",
      "openai",
      {
        prompt: [{
          role: "assistant",
          content: [{ type: "text", text: "Compacted function-call projection" }],
          providerMetadata: {
            openai: { rawResponseOutputItems: [rawFunctionCall] },
          },
        }],
      },
      false,
      createWarningCollector(),
    );

    assertEquals(body.input, [rawFunctionCall]);
  });

  it("rejects reordered hosted-search projections", () => {
    const rawWebSearches = [
      {
        type: "web_search_call",
        id: "ws_1",
        status: "completed",
        action: { type: "search", query: "one" },
      },
      {
        type: "web_search_call",
        id: "ws_2",
        status: "completed",
        action: { type: "search", query: "two" },
      },
    ];

    assertThrows(
      () =>
        buildOpenAIResponsesRequest(
          "gpt-5.4-nano",
          "openai",
          {
            prompt: [{
              role: "assistant",
              content: [
                {
                  type: "tool-call",
                  toolCallId: "ws_2",
                  toolName: "research",
                  input: { type: "search", query: "two" },
                  providerExecuted: true,
                },
                {
                  type: "tool-result",
                  toolCallId: "ws_2",
                  toolName: "research",
                  result: { status: "completed" },
                  providerExecuted: true,
                },
                {
                  type: "tool-call",
                  toolCallId: "ws_1",
                  toolName: "research",
                  input: { type: "search", query: "one" },
                  providerExecuted: true,
                },
                {
                  type: "tool-result",
                  toolCallId: "ws_1",
                  toolName: "research",
                  result: { status: "completed" },
                  providerExecuted: true,
                },
              ],
              providerMetadata: {
                openai: { rawResponseOutputItems: rawWebSearches },
              },
            }],
          },
          false,
          createWarningCollector(),
        ),
      TypeError,
      "OpenAI raw response metadata did not match canonical provider tool history",
    );
  });

  it("rejects duplicate hosted-search occurrences within either canonical source", () => {
    const rawWebSearch = {
      type: "web_search_call",
      id: "ws_1",
      status: "completed",
      action: { type: "search", query: "Veryfront" },
    };
    const duplicateCall = {
      toolCallId: "ws_1",
      toolName: "research",
      input: { type: "search", query: "Veryfront" },
    };
    const build = (
      providerToolCalls: Array<typeof duplicateCall> | undefined,
      content: Extract<
        ModelRuntimePromptMessage,
        { readonly role: "assistant" }
      >["content"],
    ) =>
      buildOpenAIResponsesRequest(
        "gpt-5.4-nano",
        "openai",
        {
          prompt: [{
            role: "assistant",
            content,
            ...(providerToolCalls ? { providerToolCalls } : {}),
            providerMetadata: {
              openai: { rawResponseOutputItems: [rawWebSearch] },
            },
          }],
        },
        false,
        createWarningCollector(),
      );

    const providerContent = {
      type: "tool-call" as const,
      ...duplicateCall,
      providerExecuted: true as const,
    };
    assertEquals(
      build([duplicateCall], [providerContent]).input,
      [rawWebSearch],
    );
    assertThrows(
      () => build([duplicateCall, duplicateCall], []),
      TypeError,
      "OpenAI raw response metadata did not match canonical provider tool history",
    );
    assertThrows(
      () => build(undefined, [providerContent, providerContent]),
      TypeError,
      "OpenAI raw response metadata did not match canonical provider tool history",
    );
  });

  it("replays historical hosted-search names without the current descriptor", () => {
    const rawWebSearch = {
      type: "web_search_call",
      id: "ws_1",
      status: "completed",
      action: { type: "search", query: "Veryfront" },
    };
    const prompt: ModelRuntimePromptMessage[] = [{
      role: "assistant",
      content: [{
        type: "tool-call",
        toolCallId: "ws_1",
        toolName: "historical-search",
        input: { type: "search", query: "Veryfront" },
        providerExecuted: true,
      }, {
        type: "tool-result",
        toolCallId: "ws_1",
        toolName: "historical-search",
        result: { status: "completed" },
        providerExecuted: true,
      }],
      providerMetadata: {
        openai: { rawResponseOutputItems: [rawWebSearch] },
      },
    }];

    const withoutDescriptor = buildOpenAIResponsesRequest(
      "gpt-5.4-nano",
      "openai",
      { prompt },
      false,
      createWarningCollector(),
    );
    const withRenamedDescriptor = buildOpenAIResponsesRequest(
      "gpt-5.4-nano",
      "openai",
      {
        prompt,
        tools: [{
          type: "provider",
          name: "current-search-name",
          id: "openai.web_search",
          args: {},
        }],
      },
      false,
      createWarningCollector(),
    );

    assertEquals(withoutDescriptor.input, [rawWebSearch]);
    assertEquals(withRenamedDescriptor.input, [rawWebSearch]);
  });

  it("correlates raw hosted-search replay with legacy providerToolCalls metadata", () => {
    const rawWebSearch = {
      type: "web_search_call",
      id: "ws_1",
      status: "completed",
      action: { type: "search", query: "Veryfront" },
    };

    assertThrows(
      () =>
        buildOpenAIResponsesRequest(
          "gpt-5.4-nano",
          "openai",
          {
            prompt: [{
              role: "assistant",
              content: [{ type: "text", text: "Search complete" }],
              providerToolCalls: [{
                toolCallId: "different-id",
                toolName: "research",
                input: { type: "search", query: "Veryfront" },
              }],
              providerMetadata: {
                openai: { rawResponseOutputItems: [rawWebSearch] },
              },
            }],
            tools: [{
              type: "provider",
              name: "research",
              id: "openai.web_search",
              args: {},
            }],
          },
          false,
          createWarningCollector(),
        ),
      TypeError,
      "OpenAI raw response metadata did not match canonical provider tool history",
    );
  });

  it("requires raw metadata to replay provider-executed assistant results", () => {
    assertThrows(
      () =>
        buildOpenAIResponsesRequest(
          "gpt-5.4-nano",
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
        ),
      TypeError,
      "OpenAI provider-executed assistant tool calls require exact raw replay metadata",
    );
    assertThrows(
      () =>
        buildOpenAIResponsesRequest(
          "gpt-5.4-nano",
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
        ),
      TypeError,
      "OpenAI provider-executed assistant tool results require exact raw replay metadata",
    );
  });
});
