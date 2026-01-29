import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { AnthropicProvider } from "./anthropic.ts";

// We test the provider's helper methods by creating an instance
// and calling the protected methods via a test subclass.
class TestableAnthropicProvider extends AnthropicProvider {
  public testGetHeaders() {
    return this.getHeaders();
  }
  public testGetEndpoint(path: string) {
    return this.getEndpoint(path);
  }
  public testTransformRequest(request: Parameters<AnthropicProvider["transformRequest"]>[0]) {
    return this.transformRequest(request);
  }
  public testTransformResponse(response: Parameters<AnthropicProvider["transformResponse"]>[0]) {
    return this.transformResponse(response);
  }
}

function createProvider(overrides?: { baseURL?: string }) {
  return new TestableAnthropicProvider({
    apiKey: "test-api-key",
    baseURL: overrides?.baseURL,
  });
}

describe("AnthropicProvider", () => {
  describe("getHeaders", () => {
    it("returns correct API key and version headers", () => {
      const provider = createProvider();
      const headers = provider.testGetHeaders();
      assertEquals(headers["x-api-key"], "test-api-key");
      assertEquals(headers["anthropic-version"], "2023-06-01");
    });
  });

  describe("getEndpoint", () => {
    it("returns default Anthropic messages endpoint", () => {
      const provider = createProvider();
      assertEquals(provider.testGetEndpoint("/chat"), "https://api.anthropic.com/v1/messages");
    });

    it("uses custom baseURL", () => {
      const provider = createProvider({ baseURL: "https://custom.api.com" });
      assertEquals(provider.testGetEndpoint("/chat"), "https://custom.api.com/v1/messages");
    });
  });

  describe("transformRequest", () => {
    it("transforms basic user message", () => {
      const provider = createProvider();
      const result = provider.testTransformRequest({
        model: "claude-3-sonnet",
        messages: [{ role: "user", content: "Hello" }],
      });

      assertEquals(result.model, "claude-3-sonnet");
      assertEquals(result.stream, false);
      assertEquals(result.max_tokens, 4096);
      assertEquals(
        (result.messages as Array<{ role: string; content: string }>)[0].role,
        "user",
      );
      assertEquals(
        (result.messages as Array<{ role: string; content: string }>)[0].content,
        "Hello",
      );
    });

    it("includes system prompt when provided", () => {
      const provider = createProvider();
      const result = provider.testTransformRequest({
        model: "claude-3-sonnet",
        messages: [{ role: "user", content: "Hi" }],
        system: "You are helpful",
      });

      assertEquals(result.system, "You are helpful");
    });

    it("transforms tool result messages to user role", () => {
      const provider = createProvider();
      const result = provider.testTransformRequest({
        model: "claude-3-sonnet",
        messages: [
          {
            role: "tool",
            content: '{"result": "42"}',
            tool_call_id: "tc_123",
          },
        ],
      });

      const msg = (result.messages as Array<{ role: string; content: unknown[] }>)[0];
      assertEquals(msg.role, "user");
      assertEquals(Array.isArray(msg.content), true);
      assertEquals((msg.content[0] as { type: string }).type, "tool_result");
      assertEquals((msg.content[0] as { tool_use_id: string }).tool_use_id, "tc_123");
    });

    it("transforms assistant messages with tool calls", () => {
      const provider = createProvider();
      const result = provider.testTransformRequest({
        model: "claude-3-sonnet",
        messages: [
          {
            role: "assistant",
            content: "Let me search",
            tool_calls: [
              {
                id: "tc_1",
                function: { name: "search", arguments: '{"q":"test"}' },
              },
            ],
          },
        ],
      });

      const msg = (result.messages as Array<{ role: string; content: unknown[] }>)[0];
      assertEquals(msg.role, "assistant");
      assertEquals(Array.isArray(msg.content), true);
      assertEquals((msg.content[0] as { type: string }).type, "text");
      assertEquals((msg.content[0] as { text: string }).text, "Let me search");
      assertEquals((msg.content[1] as { type: string }).type, "tool_use");
      assertEquals((msg.content[1] as { name: string }).name, "search");
    });

    it("sets temperature and topP when provided", () => {
      const provider = createProvider();
      const result = provider.testTransformRequest({
        model: "claude-3-sonnet",
        messages: [{ role: "user", content: "Hi" }],
        temperature: 0.5,
        topP: 0.9,
      });

      assertEquals(result.temperature, 0.5);
      assertEquals(result.top_p, 0.9);
    });

    it("transforms tools to Anthropic format", () => {
      const provider = createProvider();
      const result = provider.testTransformRequest({
        model: "claude-3-sonnet",
        messages: [{ role: "user", content: "Hi" }],
        tools: [
          {
            name: "search",
            description: "Search the web",
            parameters: { type: "object", properties: { q: { type: "string" } } },
          },
        ],
      });

      const tools = result.tools as Array<{ name: string; input_schema: unknown }>;
      assertEquals(tools.length, 1);
      assertEquals(tools[0].name, "search");
      assertEquals(tools[0].input_schema, {
        type: "object",
        properties: { q: { type: "string" } },
      });
    });

    it("sets custom maxTokens", () => {
      const provider = createProvider();
      const result = provider.testTransformRequest({
        model: "claude-3-sonnet",
        messages: [{ role: "user", content: "Hi" }],
        maxTokens: 8192,
      });

      assertEquals(result.max_tokens, 8192);
    });
  });

  describe("transformResponse", () => {
    it("extracts text from text content blocks", () => {
      const provider = createProvider();
      const result = provider.testTransformResponse({
        content: [
          { type: "text", text: "Hello " },
          { type: "text", text: "world" },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: "end_turn",
      });

      assertEquals(result.text, "Hello world");
      assertEquals(result.usage.promptTokens, 10);
      assertEquals(result.usage.completionTokens, 5);
      assertEquals(result.usage.totalTokens, 15);
      assertEquals(result.finishReason, "stop");
    });

    it("extracts tool calls from tool_use blocks", () => {
      const provider = createProvider();
      const result = provider.testTransformResponse({
        content: [
          { type: "tool_use", id: "tc1", name: "search", input: { q: "test" } },
        ],
        usage: { input_tokens: 5, output_tokens: 3 },
        stop_reason: "tool_use",
      });

      assertEquals(result.toolCalls!.length, 1);
      assertEquals(result.toolCalls![0].id, "tc1");
      assertEquals(result.toolCalls![0].name, "search");
      assertEquals(result.toolCalls![0].arguments, { q: "test" });
      assertEquals(result.finishReason, "tool_calls");
    });

    it("returns undefined toolCalls when no tool_use blocks", () => {
      const provider = createProvider();
      const result = provider.testTransformResponse({
        content: [{ type: "text", text: "Just text" }],
        usage: {},
        stop_reason: "end_turn",
      });

      assertEquals(result.toolCalls, undefined);
    });

    it("maps stop reasons correctly", () => {
      const provider = createProvider();
      const endTurn = provider.testTransformResponse({
        content: [{ type: "text", text: "" }],
        stop_reason: "end_turn",
        usage: {},
      });
      assertEquals(endTurn.finishReason, "stop");

      const maxTokens = provider.testTransformResponse({
        content: [{ type: "text", text: "" }],
        stop_reason: "max_tokens",
        usage: {},
      });
      assertEquals(maxTokens.finishReason, "length");

      const toolUse = provider.testTransformResponse({
        content: [{ type: "text", text: "" }],
        stop_reason: "tool_use",
        usage: {},
      });
      assertEquals(toolUse.finishReason, "tool_calls");

      const stopSeq = provider.testTransformResponse({
        content: [{ type: "text", text: "" }],
        stop_reason: "stop_sequence",
        usage: {},
      });
      assertEquals(stopSeq.finishReason, "stop");

      const unknown = provider.testTransformResponse({
        content: [{ type: "text", text: "" }],
        stop_reason: "unknown_reason",
        usage: {},
      });
      assertEquals(unknown.finishReason, "stop");
    });

    it("handles missing usage fields gracefully", () => {
      const provider = createProvider();
      const result = provider.testTransformResponse({
        content: [{ type: "text", text: "Hi" }],
        stop_reason: "end_turn",
      });

      assertEquals(result.usage.promptTokens, 0);
      assertEquals(result.usage.completionTokens, 0);
      assertEquals(result.usage.totalTokens, 0);
    });
  });
});
