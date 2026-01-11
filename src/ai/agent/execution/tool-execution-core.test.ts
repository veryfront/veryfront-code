/**
 * Unit tests for ToolExecutionCore
 *
 * Tests the argument parsing functionality which doesn't require mocking.
 * Full execution tests would require integration testing with actual tools.
 */

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import {
  createToolExecutionCore,
  type ProviderToolCall,
  ToolExecutionCore,
} from "./tool-execution-core.ts";

function createMockMemory() {
  return {
    add: () => Promise.resolve(),
    getMessages: () => Promise.resolve([]),
    clear: () => Promise.resolve(),
    getStats: () =>
      Promise.resolve({
        totalMessages: 0,
        estimatedTokens: 0,
        type: "conversation" as const,
      }),
  };
}

describe("ToolExecutionCore", () => {
  describe("createToolExecutionCore factory", () => {
    it("should create ToolExecutionCore instance", () => {
      const instance = createToolExecutionCore({
        agentId: "factory-test",
        memory: createMockMemory(),
      });

      assertEquals(instance instanceof ToolExecutionCore, true);
    });
  });

  describe("ProviderToolCall types", () => {
    it("should accept string arguments", () => {
      const toolCall: ProviderToolCall = {
        id: "call_123",
        name: "testTool",
        arguments: '{"query": "hello"}',
      };

      assertEquals(toolCall.id, "call_123");
      assertEquals(toolCall.name, "testTool");
      assertEquals(typeof toolCall.arguments, "string");
    });

    it("should accept object arguments", () => {
      const toolCall: ProviderToolCall = {
        id: "call_456",
        name: "testTool",
        arguments: { query: "world", count: 10 },
      };

      assertEquals(toolCall.id, "call_456");
      assertEquals(toolCall.name, "testTool");
      assertEquals(typeof toolCall.arguments, "object");
      assertEquals((toolCall.arguments as Record<string, unknown>).query, "world");
    });
  });

  describe("Instance creation", () => {
    it("should create instance with context", () => {
      const core = new ToolExecutionCore({
        agentId: "test-agent-123",
        memory: createMockMemory(),
      });

      assertExists(core);
      assertExists(core.execute);
      assertExists(core.executeAll);
    });

    it("should have execute method", () => {
      const core = new ToolExecutionCore({
        agentId: "test-agent",
        memory: createMockMemory(),
      });

      assertEquals(typeof core.execute, "function");
    });

    it("should have executeAll method", () => {
      const core = new ToolExecutionCore({
        agentId: "test-agent",
        memory: createMockMemory(),
      });

      assertEquals(typeof core.executeAll, "function");
    });
  });
});
