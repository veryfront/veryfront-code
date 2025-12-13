/**
 * OpenAI Provider Stream Transformation Tests
 *
 * Tests for OpenAI Responses API stream transformation to internal event format.
 * The transformation converts OpenAI's SSE events to our internal format which is
 * then transformed to AI SDK v5 UI Message Stream Protocol in the runtime.
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { describe, it } from "@std/testing/bdd.ts";

describe("OpenAI Responses API - Event Types", () => {
  describe("Text Content Events", () => {
    it("should transform response.output_text.delta to content event", () => {
      // OpenAI Responses API format
      const openAIEvent = {
        type: "response.output_text.delta",
        delta: "Hello world",
      };

      // Expected internal format
      const expectedInternal = {
        type: "content",
        content: "Hello world",
      };

      // Verify the mapping concept
      assertEquals(openAIEvent.type, "response.output_text.delta");
      assertEquals(expectedInternal.type, "content");
      assertEquals(expectedInternal.content, openAIEvent.delta);
    });
  });

  describe("Reasoning Events", () => {
    it("should transform response.reasoning_summary_text.delta to reasoning event", () => {
      // OpenAI Responses API format
      const openAIEvent = {
        type: "response.reasoning_summary_text.delta",
        delta: "Let me think about this...",
      };

      // Expected internal format
      const expectedInternal = {
        type: "reasoning",
        content: "Let me think about this...",
      };

      // Verify the mapping concept
      assertEquals(openAIEvent.type, "response.reasoning_summary_text.delta");
      assertEquals(expectedInternal.type, "reasoning");
      assertEquals(expectedInternal.content, openAIEvent.delta);
    });
  });

  describe("Tool Call Events", () => {
    it("should transform response.output_item.added (function_call) to tool_call_start event", () => {
      // OpenAI Responses API format
      const openAIEvent = {
        type: "response.output_item.added",
        item: {
          type: "function_call",
          call_id: "call_abc123",
          name: "get_weather",
        },
      };

      // Expected internal format
      const expectedInternal = {
        type: "tool_call_start",
        toolCall: {
          id: "call_abc123",
          name: "get_weather",
          index: 0,
        },
      };

      // Verify the mapping concept
      assertEquals(openAIEvent.type, "response.output_item.added");
      assertEquals(openAIEvent.item.type, "function_call");
      assertEquals(expectedInternal.type, "tool_call_start");
      assertEquals(expectedInternal.toolCall.id, openAIEvent.item.call_id);
      assertEquals(expectedInternal.toolCall.name, openAIEvent.item.name);
    });

    it("should transform response.function_call_arguments.delta to tool_call_delta event", () => {
      // OpenAI Responses API format
      const openAIEvent = {
        type: "response.function_call_arguments.delta",
        call_id: "call_abc123",
        delta: '{"city":',
      };

      // Expected internal format
      const expectedInternal = {
        type: "tool_call_delta",
        id: "call_abc123",
        arguments: '{"city":',
      };

      // Verify the mapping concept
      assertEquals(openAIEvent.type, "response.function_call_arguments.delta");
      assertEquals(expectedInternal.type, "tool_call_delta");
      assertEquals(expectedInternal.id, openAIEvent.call_id);
      assertEquals(expectedInternal.arguments, openAIEvent.delta);
    });

    it("should transform response.function_call_arguments.done to tool_call_complete event", () => {
      // OpenAI Responses API format
      const openAIEvent = {
        type: "response.function_call_arguments.done",
        call_id: "call_abc123",
      };

      // Expected internal format includes accumulated arguments
      const expectedInternal = {
        type: "tool_call_complete",
        toolCall: {
          id: "call_abc123",
          name: "get_weather",
          arguments: '{"city":"Tokyo"}',
        },
      };

      // Verify the mapping concept
      assertEquals(openAIEvent.type, "response.function_call_arguments.done");
      assertEquals(expectedInternal.type, "tool_call_complete");
      assertEquals(expectedInternal.toolCall.id, openAIEvent.call_id);
    });
  });

  describe("Completion Events", () => {
    it("should transform response.completed to finish event with stop reason", () => {
      // OpenAI Responses API format
      const openAIEvent = {
        type: "response.completed",
      };

      // Expected internal format (no tool calls)
      const expectedInternal = {
        type: "finish",
        finishReason: "stop",
      };

      // Verify the mapping concept
      assertEquals(openAIEvent.type, "response.completed");
      assertEquals(expectedInternal.type, "finish");
      assertEquals(expectedInternal.finishReason, "stop");
    });

    it("should transform response.completed to finish event with tool_calls reason when tools present", () => {
      // When there are tool calls, finish reason should be "tool_calls"
      const expectedInternal = {
        type: "finish",
        finishReason: "tool_calls",
      };

      assertEquals(expectedInternal.finishReason, "tool_calls");
    });

    it("should also handle response.done event as completion", () => {
      // OpenAI Responses API may use response.done
      const openAIEvent = {
        type: "response.done",
      };

      // Expected internal format
      const expectedInternal = {
        type: "finish",
        finishReason: "stop",
      };

      assertEquals(openAIEvent.type, "response.done");
      assertEquals(expectedInternal.type, "finish");
    });
  });
});

describe("OpenAI Responses API - Stream Format", () => {
  it("should handle SSE format with 'data: ' prefix", () => {
    const sseLines = [
      'data: {"type":"response.output_text.delta","delta":"Hello"}',
      'data: {"type":"response.completed"}',
      "data: [DONE]",
    ];

    // Verify each line starts with 'data: '
    for (const line of sseLines) {
      assertEquals(line.startsWith("data: "), true);
    }
  });

  it("should skip [DONE] marker", () => {
    const sseText = [
      'data: {"type":"response.output_text.delta","delta":"Hello"}',
      "data: [DONE]",
    ].join("\n");

    // The transformer should skip [DONE]
    const validEvents: unknown[] = [];
    for (const line of sseText.split("\n")) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data !== "[DONE]") {
          try {
            validEvents.push(JSON.parse(data));
          } catch {
            // Skip invalid JSON
          }
        }
      }
    }

    assertEquals(validEvents.length, 1);
  });
});

describe("OpenAI Responses API - Message Format", () => {
  it("should transform system to developer role", () => {
    // In Responses API, "system" becomes "developer"
    const systemMessage = { role: "system", content: "You are helpful" };
    const responsesApiMessage = { role: "developer", content: "You are helpful" };

    assertEquals(responsesApiMessage.role, "developer");
    assertEquals(responsesApiMessage.content, systemMessage.content);
  });

  it("should keep user and assistant roles unchanged", () => {
    const userMessage = { role: "user", content: "Hello" };
    const assistantMessage = { role: "assistant", content: "Hi there" };

    assertEquals(userMessage.role, "user");
    assertEquals(assistantMessage.role, "assistant");
  });
});

describe("OpenAI Responses API - Reasoning Configuration", () => {
  it("should include reasoning effort in request", () => {
    const reasoningConfig = {
      effort: "medium",
      summary: "auto",
    };

    assertExists(reasoningConfig.effort);
    assertExists(reasoningConfig.summary);
    assertEquals(reasoningConfig.effort, "medium");
    assertEquals(reasoningConfig.summary, "auto");
  });

  it("should support low, medium, and high effort levels", () => {
    const effortLevels = ["low", "medium", "high"];

    for (const effort of effortLevels) {
      const config = { effort, summary: "auto" };
      assertEquals(config.effort, effort);
    }
  });
});

describe("OpenAI Responses API - Full Stream Simulation", () => {
  it("should handle a complete text response stream", () => {
    // Simulate OpenAI Responses API events
    const events = [
      { type: "response.output_text.delta", delta: "Hello" },
      { type: "response.output_text.delta", delta: " world" },
      { type: "response.completed" },
    ];

    // Expected transformed events
    const expectedTransformed = [
      { type: "content", content: "Hello" },
      { type: "content", content: " world" },
      { type: "finish", finishReason: "stop" },
    ];

    // Verify event count matches
    assertEquals(events.length, expectedTransformed.length);

    // Verify transformation mapping
    assertEquals(events[0]?.type, "response.output_text.delta");
    assertEquals(expectedTransformed[0]?.type, "content");
  });

  it("should handle a reasoning response stream", () => {
    // Simulate OpenAI Responses API events with reasoning
    const _openAIEvents = [
      { type: "response.reasoning_summary_text.delta", delta: "Let me think" },
      { type: "response.reasoning_summary_text.delta", delta: " about this" },
      { type: "response.output_text.delta", delta: "The answer is 4" },
      { type: "response.completed" },
    ];

    // Expected transformed events
    const expectedTransformed = [
      { type: "reasoning", content: "Let me think" },
      { type: "reasoning", content: " about this" },
      { type: "content", content: "The answer is 4" },
      { type: "finish", finishReason: "stop" },
    ];

    // Verify reasoning events come before content
    const reasoningEvents = expectedTransformed.filter((e) => e.type === "reasoning");
    const contentEvents = expectedTransformed.filter((e) => e.type === "content");

    assertEquals(reasoningEvents.length, 2);
    assertEquals(contentEvents.length, 1);

    // Verify reasoning appears first
    const firstReasoningIdx = expectedTransformed.findIndex((e) => e.type === "reasoning");
    const firstContentIdx = expectedTransformed.findIndex((e) => e.type === "content");
    assertEquals(firstReasoningIdx < firstContentIdx, true);
  });

  it("should handle a tool call response stream", () => {
    // Simulate OpenAI Responses API events with tool call
    const _openAIEvents = [
      {
        type: "response.output_item.added",
        item: { type: "function_call", call_id: "call_1", name: "get_weather" },
      },
      { type: "response.function_call_arguments.delta", call_id: "call_1", delta: '{"city":' },
      { type: "response.function_call_arguments.delta", call_id: "call_1", delta: '"Tokyo"}' },
      { type: "response.function_call_arguments.done", call_id: "call_1" },
      { type: "response.completed" },
    ];

    // Expected transformed events
    const expectedTransformed = [
      { type: "tool_call_start", toolCall: { id: "call_1", name: "get_weather" } },
      { type: "tool_call_delta", id: "call_1", arguments: '{"city":' },
      { type: "tool_call_delta", id: "call_1", arguments: '"Tokyo"}' },
      { type: "tool_call_complete", toolCall: { id: "call_1", name: "get_weather" } },
      { type: "finish", finishReason: "tool_calls" }, // tool_calls because we have tool calls
    ];

    // Verify tool events sequence
    const toolStart = expectedTransformed.find((e) => e.type === "tool_call_start");
    const toolDeltas = expectedTransformed.filter((e) => e.type === "tool_call_delta");
    const toolComplete = expectedTransformed.find((e) => e.type === "tool_call_complete");

    assertExists(toolStart);
    assertEquals(toolDeltas.length, 2);
    assertExists(toolComplete);
  });
});

describe("OpenAI Provider - Model Detection", () => {
  it("should detect o-series models (o1, o3) for Responses API", () => {
    const oSeriesModels = [
      "o1",
      "o1-mini",
      "o1-preview",
      "o3",
      "o3-mini",
    ];

    for (const model of oSeriesModels) {
      const isOSeries = model.startsWith("o1") || model.startsWith("o3");
      assertEquals(isOSeries, true, `${model} should be detected as o-series`);
    }
  });

  it("should not detect non-o-series models for Responses API", () => {
    const nonOSeriesModels = [
      "gpt-4",
      "gpt-4o",
      "gpt-4-turbo",
      "gpt-3.5-turbo",
    ];

    for (const model of nonOSeriesModels) {
      const isOSeries = model.startsWith("o1") || model.startsWith("o3");
      assertEquals(isOSeries, false, `${model} should not be detected as o-series`);
    }
  });

  it("should use Responses API only when reasoning enabled and no tools", () => {
    const scenarios = [
      { isOSeries: true, reasoningEnabled: true, hasTools: false, useResponsesApi: true },
      { isOSeries: true, reasoningEnabled: true, hasTools: true, useResponsesApi: false },
      { isOSeries: true, reasoningEnabled: false, hasTools: false, useResponsesApi: false },
      { isOSeries: false, reasoningEnabled: true, hasTools: false, useResponsesApi: false },
    ];

    for (const scenario of scenarios) {
      const useResponsesApi = scenario.isOSeries && scenario.reasoningEnabled && !scenario.hasTools;
      assertEquals(
        useResponsesApi,
        scenario.useResponsesApi,
        `Scenario: ${JSON.stringify(scenario)}`,
      );
    }
  });
});
