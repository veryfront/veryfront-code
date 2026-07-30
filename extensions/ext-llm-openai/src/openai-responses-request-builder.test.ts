import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimePromptMessage } from "veryfront/provider/shared";
import {
  buildOpenAIResponsesRequest,
  supportsOpenAINativeToolSearch,
} from "./openai-responses-request-builder.ts";

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
  it("gates native tool search to documented OpenAI model IDs and snapshots", () => {
    for (
      const modelId of [
        "gpt-5.4",
        "gpt-5.4-mini",
        "gpt-5.4-pro",
        "gpt-5.5",
        "gpt-5.6",
        "gpt-5.6-sol",
        "gpt-5.6-terra",
        "gpt-5.6-luna",
      ]
    ) {
      assertEquals(supportsOpenAINativeToolSearch(modelId), true);
      assertEquals(supportsOpenAINativeToolSearch(`${modelId}-2026-07-30`), true);
    }

    for (
      const modelId of [
        "gpt-5.3",
        "gpt-5.4-nano",
        "gpt-5.5-pro",
        "gpt-5.6-codex",
        "gpt-5.6-arbitrary",
        "gpt-5.6-sol-codex",
        "gpt-5.6-sol-2026-07",
        "gpt-5.6-sol-2026-07-30-extra",
      ]
    ) {
      assertEquals(supportsOpenAINativeToolSearch(modelId), false);
    }

    assertEquals(supportsOpenAINativeToolSearch("gpt-5.4", "veryfront-cloud"), true);
    assertEquals(supportsOpenAINativeToolSearch("gpt-5.4", "azure"), false);
  });

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

  it("serializes native tool search only for supported Responses models", () => {
    const options = {
      prompt: [{ role: "user", content: [{ type: "text", text: "Find a release tool" }] }],
      tools: [
        {
          type: "function",
          name: "tool_search",
          description: "Search authorized tools",
          inputSchema: { type: "object", properties: { query: { type: "string" } } },
          nativeToolSearch: { mode: "hosted" },
        },
        {
          type: "function",
          name: "get_release",
          inputSchema: { type: "object" },
          deferLoading: true,
        },
      ],
    };

    const supported = buildOpenAIResponsesRequest(
      "gpt-5.4",
      "openai",
      options as never,
      false,
      createWarningCollector(),
    );
    assertEquals(supported.tools, [
      { type: "tool_search" },
      {
        type: "function",
        name: "get_release",
        strict: false,
        defer_loading: true,
        parameters: { type: "object" },
      },
    ]);

    for (const modelId of ["gpt-5.3", "gpt-5.4-nano", "gpt-5.5-pro"]) {
      const unsupported = buildOpenAIResponsesRequest(
        modelId,
        "openai",
        options as never,
        false,
        createWarningCollector(),
      );
      assertEquals(unsupported.tools, [
        {
          type: "function",
          name: "tool_search",
          description: "Search authorized tools",
          strict: false,
          parameters: { type: "object", properties: { query: { type: "string" } } },
        },
      ]);
    }

    const clientControlled = buildOpenAIResponsesRequest(
      "gpt-5.4",
      "openai",
      {
        ...options,
        tools: options.tools.map((tool) =>
          tool.name === "tool_search" ? { ...tool, nativeToolSearch: { mode: "client" } } : tool
        ),
      } as never,
      false,
      createWarningCollector(),
    );
    assertEquals(clientControlled.tools, [
      {
        type: "tool_search",
        execution: "client",
        description: "Search authorized tools",
        parameters: { type: "object", properties: { query: { type: "string" } } },
      },
      {
        type: "function",
        name: "get_release",
        strict: false,
        defer_loading: true,
        parameters: { type: "object" },
      },
    ]);

    const providerOptionBypass = buildOpenAIResponsesRequest(
      "gpt-5.4",
      "openai",
      {
        ...options,
        tools: options.tools.map((tool) =>
          tool.name === "tool_search" ? { ...tool, nativeToolSearch: undefined } : tool
        ),
        providerOptions: { openai: { toolSearch: { mode: "hosted" } } },
      } as never,
      false,
      createWarningCollector(),
    );
    assertEquals(providerOptionBypass.tools, [{
      type: "function",
      name: "tool_search",
      description: "Search authorized tools",
      strict: false,
      parameters: { type: "object", properties: { query: { type: "string" } } },
    }]);
  });

  it("replays OpenAI tool-search call/output items in original order", () => {
    const body = buildOpenAIResponsesRequest(
      "gpt-5.4",
      "openai",
      {
        prompt: [
          { role: "user", content: [{ type: "text", text: "Find a tool" }] },
          {
            role: "assistant",
            content: [
              {
                type: "provider-block",
                provider: "openai-responses",
                block: {
                  type: "tool_search_call",
                  execution: "server",
                  call_id: null,
                  status: "completed",
                  arguments: { goal: "Find release tools" },
                  provider_trace: { shard: "a" },
                },
              },
              {
                type: "provider-block",
                provider: "openai-responses",
                block: {
                  type: "tool_search_output",
                  execution: "server",
                  call_id: null,
                  status: "completed",
                  tools: [{
                    type: "function",
                    name: "get_release",
                    defer_loading: true,
                    parameters: { type: "object" },
                  }],
                  provider_trace: { shard: "b" },
                },
              },
              {
                type: "provider-block",
                provider: "anthropic",
                block: {
                  type: "server_tool_use",
                  id: "srvtoolu_ignored",
                  name: "tool_search_tool_regex",
                  input: { query: "ignored" },
                },
              },
            ],
          },
        ],
      } as never,
      false,
      createWarningCollector(),
    );

    assertEquals(body.input, [
      { role: "user", content: [{ type: "input_text", text: "Find a tool" }] },
      {
        type: "tool_search_call",
        execution: "server",
        call_id: null,
        status: "completed",
        arguments: { goal: "Find release tools" },
        provider_trace: { shard: "a" },
      },
      {
        type: "tool_search_output",
        execution: "server",
        call_id: null,
        status: "completed",
        tools: [{
          type: "function",
          name: "get_release",
          defer_loading: true,
          parameters: { type: "object" },
        }],
        provider_trace: { shard: "b" },
      },
    ]);
  });

  it("defers namespace members only on a native-capable OpenAI Responses route", () => {
    const options = {
      prompt: [{ role: "user", content: [{ type: "text", text: "Find CRM tools" }] }],
      tools: [
        {
          type: "function",
          name: "tool_search",
          inputSchema: { type: "object" },
          nativeToolSearch: { mode: "hosted" },
        },
        {
          type: "provider",
          name: "crm",
          id: "openai.namespace",
          args: {
            name: "crm",
            tools: [
              {
                type: "function",
                name: "get_customer",
                parameters: { type: "object" },
              },
              {
                type: "function",
                name: "list_orders",
                deferLoading: true,
                parameters: { type: "object" },
              },
            ],
          },
        },
      ],
    };

    const supported = buildOpenAIResponsesRequest(
      "gpt-5.4",
      "openai",
      options as never,
      false,
      createWarningCollector(),
    );
    assertEquals(supported.tools, [
      { type: "tool_search" },
      {
        type: "namespace",
        name: "crm",
        tools: [
          { type: "function", name: "get_customer", parameters: { type: "object" } },
          {
            type: "function",
            name: "list_orders",
            defer_loading: true,
            parameters: { type: "object" },
          },
        ],
      },
    ]);

    const unsupportedRoute = buildOpenAIResponsesRequest(
      "gpt-5.4",
      "azure",
      options as never,
      false,
      createWarningCollector(),
    );
    assertEquals(unsupportedRoute.tools, [
      {
        type: "function",
        name: "tool_search",
        strict: false,
        parameters: { type: "object" },
      },
      {
        type: "namespace",
        name: "crm",
        tools: [
          { type: "function", name: "get_customer", parameters: { type: "object" } },
        ],
      },
    ]);
  });

  it("normalizes only top-level provider-tool args and preserves nested camelCase", () => {
    const body = buildOpenAIResponsesRequest(
      "gpt-5.4",
      "openai",
      {
        prompt: [{ role: "user", content: [{ type: "text", text: "Find a tool" }] }],
        tools: [{
          type: "provider",
          id: "openai.custom_tool",
          args: {
            topLevelKey: "normalized",
            nestedConfig: {
              camelCaseKey: "preserved",
              deferLoading: true,
            },
            opaqueItems: [{
              deferLoading: true,
              nestedCamelCase: { staysOpaque: true },
            }],
          },
        }],
      } as never,
      false,
      createWarningCollector(),
    );

    assertEquals(body.tools, [{
      type: "custom_tool",
      top_level_key: "normalized",
      nested_config: {
        camelCaseKey: "preserved",
        deferLoading: true,
      },
      opaque_items: [{
        deferLoading: true,
        nestedCamelCase: { staysOpaque: true },
      }],
    }]);
  });
});
