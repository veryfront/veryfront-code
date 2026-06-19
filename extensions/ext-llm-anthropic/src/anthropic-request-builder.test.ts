import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimePromptMessage } from "veryfront/provider/shared";
import { buildAnthropicMessagesRequest } from "./anthropic-request-builder.ts";

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

describe("ext-llm-anthropic/anthropic-request-builder", () => {
  it("preserves Messages request shaping, provider option merge order, and warnings", () => {
    const prompt: RuntimePromptMessage[] = [
      { role: "system", content: "You are careful." },
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
          {
            type: "reasoning",
            text: "Thinking trace",
            signature: "sig_123",
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

    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-5-20250929",
      "bedrock",
      {
        prompt,
        maxOutputTokens: 20_000,
        temperature: 0.4,
        topP: 0.9,
        topK: 10,
        stopSequences: ["one", "two", "three", "four", "five"],
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
            id: "anthropic.web_search",
            args: { maxUses: 2 },
          },
        ],
        toolChoice: "auto",
        seed: 7,
        presencePenalty: 0.1,
        frequencyPenalty: 0.2,
        cacheControl: { system: true, tools: "1h" },
        reasoning: { enabled: true, effort: "high" },
        responseFormat: { type: "json" },
        userId: "user_123",
        mcpServers: [{
          type: "url",
          url: "https://example.test/mcp",
          authorizationToken: "token_123",
          toolConfiguration: {
            allowedTools: ["read_file"],
          },
        }],
        anthropicContainer: { id: "ctr_1" },
        providerOptions: {
          anthropic: {
            custom_anthropic: true,
            max_tokens: 222,
          },
          bedrock: {
            custom_bedrock: true,
            temperature: 0.1,
          },
        },
      },
      true,
      warnings,
    );

    assertEquals(body, {
      model: "claude-sonnet-4-5-20250929",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Inspect this." },
            {
              type: "image",
              source: {
                type: "url",
                url: "https://example.test/image.png",
              },
            },
          ],
        },
        {
          role: "assistant",
          content: [
            { type: "text", text: "I will check." },
            {
              type: "tool_use",
              id: "tool_1",
              name: "lookup",
              input: { id: "abc" },
            },
            {
              type: "thinking",
              thinking: "Thinking trace",
              signature: "sig_123",
            },
          ],
        },
        {
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: "tool_1",
            content: '{"ok":true}',
          }],
        },
      ],
      max_tokens: 222,
      stream: true,
      system: [{
        type: "text",
        text: "You are careful.",
        cache_control: { type: "ephemeral" },
      }],
      stop_sequences: ["one", "two", "three", "four"],
      tools: [
        {
          name: "lookup",
          description: "Look up a value",
          input_schema: { type: "object", properties: { id: { type: "string" } } },
        },
        {
          type: "web_search_20250305",
          name: "web",
          max_uses: 2,
          cache_control: { type: "ephemeral", ttl: "1h" },
        },
      ],
      tool_choice: { type: "auto" },
      thinking: { type: "enabled", budget_tokens: 16_384 },
      metadata: { user_id: "user_123" },
      mcp_servers: [{
        type: "url",
        url: "https://example.test/mcp",
        authorization_token: "token_123",
        tool_configuration: {
          allowed_tools: ["read_file"],
        },
      }],
      container: { id: "ctr_1" },
      custom_anthropic: true,
      custom_bedrock: true,
      temperature: 0.1,
    });
    assertEquals(warnings.drain().map((warning) => warning.setting), [
      "presencePenalty",
      "frequencyPenalty",
      "seed",
      "topK",
      "stopSequences",
      "temperature",
      "topP",
      "responseFormat",
    ]);
  });

  it("treats provider-option thinking as enabled while shaping sampling settings", () => {
    const prompt: RuntimePromptMessage[] = [
      { role: "user", content: [{ type: "text", text: "Think carefully." }] },
    ];
    const warnings = createWarningCollector();

    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-6",
      "anthropic",
      {
        prompt,
        maxOutputTokens: 4096,
        temperature: 0.2,
        topP: 0.9,
        providerOptions: {
          anthropic: {
            thinking: { type: "enabled", budget_tokens: 2048 },
          },
        },
      },
      false,
      warnings,
    );

    assertEquals(body.temperature, undefined);
    assertEquals(body.top_p, undefined);
    assertEquals(body.thinking, { type: "enabled", budget_tokens: 2048 });
    assertEquals(body.max_tokens, 6144);
    assertEquals(warnings.drain().map((warning) => warning.setting), [
      "temperature",
      "topP",
    ]);
  });

  it("compacts completed historical tool rounds before replaying later user turns", () => {
    const prompt: RuntimePromptMessage[] = [
      { role: "user", content: [{ type: "text", text: "Build a briefing." }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I'll fetch both sources." },
          {
            type: "tool-call",
            toolCallId: "toolu_calendar",
            toolName: "calendar__list_events",
            input: {},
          },
          {
            type: "tool-call",
            toolCallId: "toolu_gmail",
            toolName: "gmail__search_emails",
            input: {},
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "toolu_calendar",
            toolName: "calendar__list_events",
            output: { type: "json", value: { events: 1 } },
          },
          {
            type: "tool-result",
            toolCallId: "toolu_gmail",
            toolName: "gmail__search_emails",
            output: { type: "json", value: { messages: 20 } },
          },
        ],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I have the briefing." },
          {
            type: "tool-call",
            toolCallId: "toolu_email_1",
            toolName: "gmail__get_email",
            input: {},
          },
          {
            type: "tool-call",
            toolCallId: "toolu_email_2",
            toolName: "gmail__get_email",
            input: {},
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "toolu_email_1",
            toolName: "gmail__get_email",
            output: { type: "json", value: { id: "email-1" } },
          },
          {
            type: "tool-result",
            toolCallId: "toolu_email_2",
            toolName: "gmail__get_email",
            output: { type: "json", value: { id: "email-2" } },
          },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "Agenda, inbox, and follow-ups." }] },
      { role: "user", content: [{ type: "text", text: "retry" }] },
    ];
    const warnings = createWarningCollector();

    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-6",
      "anthropic",
      { prompt },
      false,
      warnings,
    );

    assertEquals(body.messages, [
      { role: "user", content: [{ type: "text", text: "Build a briefing." }] },
      { role: "assistant", content: [{ type: "text", text: "I'll fetch both sources." }] },
      { role: "assistant", content: [{ type: "text", text: "I have the briefing." }] },
      { role: "assistant", content: [{ type: "text", text: "Agenda, inbox, and follow-ups." }] },
      { role: "user", content: [{ type: "text", text: "retry" }] },
    ]);
  });

  it("keeps same-turn tool results when later assistant steps continue without a user turn", () => {
    const prompt: RuntimePromptMessage[] = [
      { role: "user", content: [{ type: "text", text: "Create an integration agent." }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will load the platform skill." },
          {
            type: "tool-call",
            toolCallId: "toolu_load_skill",
            toolName: "load_skill",
            input: { skillId: "veryfront" },
          },
        ],
      },
      {
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: "toolu_load_skill",
          toolName: "load_skill",
          output: {
            type: "json",
            value: {
              skillId: "veryfront",
              instructions: "Create agents with create_agent after gathering context.",
            },
          },
        }],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Now I will inspect the integration." },
          {
            type: "tool-call",
            toolCallId: "toolu_get_integration",
            toolName: "get_integration",
            input: { integration: "harvest" },
          },
        ],
      },
      {
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: "toolu_get_integration",
          toolName: "get_integration",
          output: {
            type: "json",
            value: { slug: "harvest", name: "Harvest" },
          },
        }],
      },
    ];
    const warnings = createWarningCollector();

    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-6",
      "anthropic",
      { prompt },
      false,
      warnings,
    );

    assertEquals(body.messages, [
      { role: "user", content: [{ type: "text", text: "Create an integration agent." }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will load the platform skill." },
          {
            type: "tool_use",
            id: "toolu_load_skill",
            name: "load_skill",
            input: { skillId: "veryfront" },
          },
        ],
      },
      {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: "toolu_load_skill",
          content:
            '{"skillId":"veryfront","instructions":"Create agents with create_agent after gathering context."}',
        }],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Now I will inspect the integration." },
          {
            type: "tool_use",
            id: "toolu_get_integration",
            name: "get_integration",
            input: { integration: "harvest" },
          },
        ],
      },
      {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: "toolu_get_integration",
          content: '{"slug":"harvest","name":"Harvest"}',
        }],
      },
    ]);
  });

  it("keeps historical tool-only rounds when active same-turn assistant text follows the latest user", () => {
    const prompt: RuntimePromptMessage[] = [
      { role: "user", content: [{ type: "text", text: "Start with account context." }] },
      {
        role: "assistant",
        content: [{
          type: "tool-call",
          toolCallId: "toolu_account",
          toolName: "account__lookup",
          input: { id: "acct-1" },
        }],
      },
      {
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: "toolu_account",
          toolName: "account__lookup",
          output: { type: "json", value: { plan: "pro" } },
        }],
      },
      { role: "user", content: [{ type: "text", text: "retry with more detail" }] },
      {
        role: "assistant",
        content: [{ type: "text", text: "I will continue from the account context." }],
      },
    ];
    const warnings = createWarningCollector();

    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-6",
      "anthropic",
      { prompt },
      false,
      warnings,
    );

    assertEquals(body.messages, [
      { role: "user", content: [{ type: "text", text: "Start with account context." }] },
      {
        role: "assistant",
        content: [{
          type: "tool_use",
          id: "toolu_account",
          name: "account__lookup",
          input: { id: "acct-1" },
        }],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_account",
            content: '{"plan":"pro"}',
          },
          { type: "text", text: "retry with more detail" },
        ],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "I will continue from the account context." }],
      },
    ]);
  });

  it("drops orphaned tool results when their tool use was not emitted", () => {
    const prompt: RuntimePromptMessage[] = [
      {
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: "srvtoolu_search_1",
          toolName: "web_search",
          output: { type: "json", value: { results: [] } },
        }],
      },
      { role: "user", content: [{ type: "text", text: "Continue the conversation." }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will use the current tools." },
          {
            type: "tool-call",
            toolCallId: "toolu_lookup_1",
            toolName: "lookup",
            input: { query: "current" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "srvtoolu_search_1",
            toolName: "web_search",
            output: { type: "json", value: { stale: true } },
          },
          {
            type: "tool-result",
            toolCallId: "toolu_lookup_1",
            toolName: "lookup",
            output: { type: "json", value: { ok: true } },
          },
        ],
      },
    ];
    const warnings = createWarningCollector();

    const body = buildAnthropicMessagesRequest(
      "claude-sonnet-4-6",
      "anthropic",
      { prompt },
      false,
      warnings,
    );

    assertEquals(body.messages, [
      { role: "user", content: [{ type: "text", text: "Continue the conversation." }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will use the current tools." },
          {
            type: "tool_use",
            id: "toolu_lookup_1",
            name: "lookup",
            input: { query: "current" },
          },
        ],
      },
      {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: "toolu_lookup_1",
          content: '{"ok":true}',
        }],
      },
    ]);
  });
});
