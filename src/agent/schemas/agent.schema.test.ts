import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  AgentContextSchema,
  AgentResponseSchema,
  agentStatusSchema,
  EdgeConfigSchema,
  MemoryConfigSchema,
  MessagePartSchema,
  MessageSchema,
  modelProviderSchema,
  StreamToolCallSchema,
  ToolCallPartSchema,
  ToolCallSchema,
  ToolResultPartSchema,
} from "./agent.schema.ts";

describe("agent/schema", () => {
  describe("modelProviderSchema", () => {
    it("should accept all valid providers", () => {
      const providers = ["openai", "anthropic", "google", "local"];

      for (const provider of providers) {
        const result = modelProviderSchema.safeParse(provider);
        assertEquals(result.success, true, `${provider} should be valid`);
      }
    });

    it("should reject invalid provider", () => {
      const result = modelProviderSchema.safeParse("invalid");
      assertEquals(result.success, false);
    });
  });

  describe("agentStatusSchema", () => {
    it("should accept all valid statuses", () => {
      const statuses = [
        "idle",
        "thinking",
        "tool_execution",
        "streaming",
        "completed",
        "error",
      ];

      for (const status of statuses) {
        const result = agentStatusSchema.safeParse(status);
        assertEquals(result.success, true, `${status} should be valid`);
      }
    });

    it("should reject invalid status", () => {
      const result = agentStatusSchema.safeParse("processing");
      assertEquals(result.success, false);
    });
  });

  describe("MemoryConfigSchema", () => {
    it("should accept valid memory config", () => {
      const result = MemoryConfigSchema.safeParse({
        type: "conversation",
        maxTokens: 4096,
        maxMessages: 100,
      });
      assertEquals(result.success, true);
    });

    it("should accept all memory types", () => {
      const types = ["conversation", "buffer", "summary", "redis"];

      for (const type of types) {
        const result = MemoryConfigSchema.safeParse({ type });
        assertEquals(result.success, true, `${type} should be valid`);
      }
    });

    it("should accept config with only type", () => {
      const result = MemoryConfigSchema.safeParse({
        type: "buffer",
      });
      assertEquals(result.success, true);
    });

    it("should reject negative maxTokens", () => {
      const result = MemoryConfigSchema.safeParse({
        type: "conversation",
        maxTokens: -100,
      });
      assertEquals(result.success, false);
    });

    it("should reject negative maxMessages", () => {
      const result = MemoryConfigSchema.safeParse({
        type: "conversation",
        maxMessages: -10,
      });
      assertEquals(result.success, false);
    });
  });

  describe("EdgeConfigSchema", () => {
    it("should accept valid edge config", () => {
      const result = EdgeConfigSchema.safeParse({
        enabled: true,
        maxSteps: 10,
        timeoutMs: 30000,
        streaming: false,
      });
      assertEquals(result.success, true);
    });

    it("should accept minimal config", () => {
      const result = EdgeConfigSchema.safeParse({
        enabled: false,
      });
      assertEquals(result.success, true);
    });

    it("should reject negative maxSteps", () => {
      const result = EdgeConfigSchema.safeParse({
        enabled: true,
        maxSteps: -5,
      });
      assertEquals(result.success, false);
    });

    it("should reject negative timeoutMs", () => {
      const result = EdgeConfigSchema.safeParse({
        enabled: true,
        timeoutMs: -1000,
      });
      assertEquals(result.success, false);
    });
  });

  describe("MessagePartSchema - nested union types", () => {
    it("should accept text part", () => {
      const result = MessagePartSchema.safeParse({
        type: "text",
        text: "Hello, world!",
      });
      assertEquals(result.success, true);
    });

    it("should accept tool call part with args", () => {
      const result = MessagePartSchema.safeParse({
        type: "tool-call-123",
        toolCallId: "call-456",
        toolName: "calculator",
        args: { operation: "add", x: 1, y: 2 },
      });
      assertEquals(result.success, true);
    });

    it("should accept tool call part with input", () => {
      const result = MessagePartSchema.safeParse({
        type: "tool-execute",
        toolCallId: "call-789",
        toolName: "search",
        input: { query: "test query" },
      });
      assertEquals(result.success, true);
    });

    it("should accept tool-call literal type", () => {
      const result = MessagePartSchema.safeParse({
        type: "tool-call",
        toolCallId: "call-abc",
        toolName: "fetch",
        args: { url: "https://api.example.com" },
      });
      assertEquals(result.success, true);
    });

    it("should accept tool result part", () => {
      const result = MessagePartSchema.safeParse({
        type: "tool-result",
        toolCallId: "call-123",
        toolName: "calculator",
        result: { answer: 42 },
      });
      assertEquals(result.success, true);
    });

    it("should reject invalid part type", () => {
      const result = MessagePartSchema.safeParse({
        type: "unknown",
        data: "test",
      });
      assertEquals(result.success, false);
    });
  });

  describe("ToolCallPartSchema", () => {
    it("should accept tool call with args", () => {
      const result = ToolCallPartSchema.safeParse({
        type: "tool-search",
        toolCallId: "call-1",
        toolName: "search",
        args: { query: "test" },
      });
      assertEquals(result.success, true);
    });

    it("should accept tool call with input", () => {
      const result = ToolCallPartSchema.safeParse({
        type: "tool-fetch",
        toolCallId: "call-2",
        toolName: "fetch",
        input: { url: "https://example.com" },
      });
      assertEquals(result.success, true);
    });

    it("should validate tool- prefix in type", () => {
      const result = ToolCallPartSchema.safeParse({
        type: "tool-custom",
        toolCallId: "call-3",
        toolName: "custom",
        args: {},
      });
      assertEquals(result.success, true);
    });

    it("should reject type without tool- prefix", () => {
      const result = ToolCallPartSchema.safeParse({
        type: "invalid",
        toolCallId: "call-4",
        toolName: "test",
        args: {},
      });
      assertEquals(result.success, false);
    });
  });

  describe("ToolResultPartSchema", () => {
    it("should accept tool result with any result type", () => {
      const results = [
        { result: "string result" },
        { result: 42 },
        { result: { key: "value" } },
        { result: [1, 2, 3] },
        { result: null },
      ];

      for (const data of results) {
        const result = ToolResultPartSchema.safeParse({
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "test",
          ...data,
        });
        assertEquals(result.success, true);
      }
    });
  });

  describe("MessageSchema - nested structure", () => {
    it("should accept valid message with text parts", () => {
      const result = MessageSchema.safeParse({
        id: "msg-123",
        role: "user",
        parts: [
          { type: "text", text: "Hello" },
          { type: "text", text: "World" },
        ],
      });
      assertEquals(result.success, true);
    });

    it("should accept all valid roles", () => {
      const roles = ["user", "assistant", "system", "tool"];

      for (const role of roles) {
        const result = MessageSchema.safeParse({
          id: "msg-1",
          role,
          parts: [{ type: "text", text: "test" }],
        });
        assertEquals(result.success, true, `${role} should be valid`);
      }
    });

    it("should accept message with mixed parts", () => {
      const result = MessageSchema.safeParse({
        id: "msg-456",
        role: "assistant",
        parts: [
          { type: "text", text: "I'll help you with that." },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "calculator",
            args: { x: 5, y: 3 },
          },
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "calculator",
            result: 8,
          },
          { type: "text", text: "The answer is 8." },
        ],
      });
      assertEquals(result.success, true);
    });

    it("should accept message with timestamp", () => {
      const result = MessageSchema.safeParse({
        id: "msg-789",
        role: "user",
        parts: [{ type: "text", text: "test" }],
        timestamp: Date.now(),
      });
      assertEquals(result.success, true);
    });

    it("should accept message with metadata", () => {
      const result = MessageSchema.safeParse({
        id: "msg-abc",
        role: "assistant",
        parts: [{ type: "text", text: "test" }],
        metadata: { source: "api", version: "1.0" },
      });
      assertEquals(result.success, true);
    });

    it("should reject negative timestamp", () => {
      const result = MessageSchema.safeParse({
        id: "msg-999",
        role: "user",
        parts: [{ type: "text", text: "test" }],
        timestamp: -100,
      });
      assertEquals(result.success, false);
    });

    it("should reject invalid role", () => {
      const result = MessageSchema.safeParse({
        id: "msg-999",
        role: "moderator",
        parts: [{ type: "text", text: "test" }],
      });
      assertEquals(result.success, false);
    });
  });

  describe("StreamToolCallSchema", () => {
    it("should accept valid stream tool call", () => {
      const result = StreamToolCallSchema.safeParse({
        id: "stream-1",
        name: "search",
        arguments: { query: "test", limit: 10 },
      });
      assertEquals(result.success, true);
    });

    it("should accept empty arguments", () => {
      const result = StreamToolCallSchema.safeParse({
        id: "stream-2",
        name: "ping",
        arguments: {},
      });
      assertEquals(result.success, true);
    });
  });

  describe("ToolCallSchema", () => {
    it("should accept all valid statuses", () => {
      const statuses = ["pending", "executing", "completed", "error"];

      for (const status of statuses) {
        const result = ToolCallSchema.safeParse({
          id: "tool-1",
          name: "test",
          args: {},
          status,
        });
        assertEquals(result.success, true, `${status} should be valid`);
      }
    });

    it("should accept tool call with result", () => {
      const result = ToolCallSchema.safeParse({
        id: "tool-2",
        name: "calculator",
        args: { x: 5, y: 3 },
        status: "completed",
        result: 8,
      });
      assertEquals(result.success, true);
    });

    it("should accept tool call with error", () => {
      const result = ToolCallSchema.safeParse({
        id: "tool-3",
        name: "fetch",
        args: { url: "invalid" },
        status: "error",
        error: "Invalid URL",
      });
      assertEquals(result.success, true);
    });

    it("should accept tool call with execution time", () => {
      const result = ToolCallSchema.safeParse({
        id: "tool-4",
        name: "search",
        args: { query: "test" },
        status: "completed",
        executionTime: 1250.5,
      });
      assertEquals(result.success, true);
    });

    it("should reject negative execution time", () => {
      const result = ToolCallSchema.safeParse({
        id: "tool-5",
        name: "test",
        args: {},
        status: "completed",
        executionTime: -100,
      });
      assertEquals(result.success, false);
    });
  });

  describe("AgentResponseSchema - complex nested structure", () => {
    it("should accept valid agent response", () => {
      const result = AgentResponseSchema.safeParse({
        text: "Here's the answer to your question.",
        messages: [
          {
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "What is 2+2?" }],
          },
          {
            id: "msg-2",
            role: "assistant",
            parts: [{ type: "text", text: "The answer is 4." }],
          },
        ],
        toolCalls: [],
        status: "completed",
      });
      assertEquals(result.success, true);
    });

    it("should accept response with tool calls", () => {
      const result = AgentResponseSchema.safeParse({
        text: "I've calculated the result.",
        messages: [
          {
            id: "msg-1",
            role: "assistant",
            parts: [
              { type: "text", text: "Let me calculate that." },
              {
                type: "tool-call",
                toolCallId: "call-1",
                toolName: "calculator",
                args: { x: 10, y: 5 },
              },
            ],
          },
        ],
        toolCalls: [
          {
            id: "call-1",
            name: "calculator",
            args: { x: 10, y: 5 },
            status: "completed",
            result: 15,
            executionTime: 50,
          },
        ],
        status: "completed",
      });
      assertEquals(result.success, true);
    });

    it("should accept response with thinking", () => {
      const result = AgentResponseSchema.safeParse({
        text: "After analyzing the problem...",
        messages: [],
        toolCalls: [],
        status: "thinking",
        thinking: "Let me break down the problem into steps...",
      });
      assertEquals(result.success, true);
    });

    it("should accept response with usage statistics", () => {
      const result = AgentResponseSchema.safeParse({
        text: "Response",
        messages: [],
        toolCalls: [],
        status: "completed",
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
      });
      assertEquals(result.success, true);
    });

    it("should accept response with metadata", () => {
      const result = AgentResponseSchema.safeParse({
        text: "Response",
        messages: [],
        toolCalls: [],
        status: "completed",
        metadata: {
          model: "gpt-4",
          temperature: 0.7,
          requestId: "req-123",
        },
      });
      assertEquals(result.success, true);
    });

    it("should reject negative token counts", () => {
      const result = AgentResponseSchema.safeParse({
        text: "Response",
        messages: [],
        toolCalls: [],
        status: "completed",
        usage: {
          promptTokens: -10,
          completionTokens: 50,
          totalTokens: 40,
        },
      });
      assertEquals(result.success, false);
    });
  });

  describe("AgentContextSchema", () => {
    it("should accept context with string input", () => {
      const result = AgentContextSchema.safeParse({
        agentId: "agent-123",
        input: "What is the weather?",
        platform: {}, // Platform is z.any()
      });
      assertEquals(result.success, true);
    });

    it("should accept context with message array input", () => {
      const result = AgentContextSchema.safeParse({
        agentId: "agent-456",
        input: [
          {
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "Hello" }],
          },
        ],
        platform: {},
      });
      assertEquals(result.success, true);
    });

    it("should accept context with optional fields", () => {
      const result = AgentContextSchema.safeParse({
        agentId: "agent-789",
        model: "gpt-4",
        input: "test",
        data: { key: "value" },
        platform: {},
        metadata: { source: "api" },
      });
      assertEquals(result.success, true);
    });

    it("should accept platform as any type", () => {
      const platforms = [
        {},
        { type: "deno" },
        { runtime: "node" },
        "string-platform",
        123,
      ];

      for (const platform of platforms) {
        const result = AgentContextSchema.safeParse({
          agentId: "agent-1",
          input: "test",
          platform,
        });
        assertEquals(result.success, true);
      }
    });
  });
});
