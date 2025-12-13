/**
 * Agent Runtime Stream Protocol Tests
 *
 * Tests for AI SDK v5 UI Message Stream Protocol compliance.
 * @see https://ai-sdk.dev/docs/advanced/stream-protocol
 */

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "https://deno.land/std@0.220.0/assert/mod.ts";
import { describe, it } from "@std/testing/bdd.ts";

/**
 * Helper to parse SSE events from a string
 */
function parseSSEEvents(text: string): Array<{ type: string; [key: string]: unknown }> {
  const events: Array<{ type: string; [key: string]: unknown }> = [];

  // Split by SSE event delimiter (data: ...\n\n)
  const eventStrings = text.split("\n\n").filter((s) => s.trim());

  for (const eventStr of eventStrings) {
    if (eventStr.startsWith("data: ")) {
      try {
        const json = JSON.parse(eventStr.slice(6));
        events.push(json);
      } catch {
        // Skip invalid JSON
      }
    }
  }

  return events;
}

/**
 * Helper to format SSE event
 */
function formatSSE(event: Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

describe("AI SDK v5 Stream Protocol - Event Format", () => {
  describe("SSE Format Compliance", () => {
    it("should format events as 'data: {...}\\n\\n'", () => {
      const event = { type: "start", messageId: "msg-123" };
      const formatted = formatSSE(event);

      assertStringIncludes(formatted, "data: ");
      assertStringIncludes(formatted, "\n\n");
      assertEquals(formatted, 'data: {"type":"start","messageId":"msg-123"}\n\n');
    });

    it("should parse SSE events correctly", () => {
      const sseText = [
        'data: {"type":"start","messageId":"msg-123"}',
        "",
        'data: {"type":"text-delta","id":"text-1","delta":"Hello"}',
        "",
        'data: {"type":"finish"}',
        "",
      ].join("\n");

      const events = parseSSEEvents(sseText);

      assertEquals(events.length, 3);
      assertEquals(events[0]?.type, "start");
      assertEquals(events[1]?.type, "text-delta");
      assertEquals(events[2]?.type, "finish");
    });

    it("should skip invalid JSON in SSE parsing", () => {
      const sseText = [
        'data: {"type":"start"}',
        "",
        "data: invalid-json",
        "",
        'data: {"type":"finish"}',
        "",
      ].join("\n");

      const events = parseSSEEvents(sseText);

      assertEquals(events.length, 2);
      assertEquals(events[0]?.type, "start");
      assertEquals(events[1]?.type, "finish");
    });
  });

  describe("Required Event Types", () => {
    it("should recognize all v5 stream event types", () => {
      const v5EventTypes = [
        "start",
        "text-start",
        "text-delta",
        "text-end",
        "reasoning-start",
        "reasoning-delta",
        "reasoning-end",
        "tool-input-start",
        "tool-input-delta",
        "tool-input-available",
        "tool-output-available",
        "start-step",
        "finish-step",
        "finish",
        "error",
      ];

      for (const eventType of v5EventTypes) {
        const event = { type: eventType };
        const formatted = formatSSE(event);
        const parsed = parseSSEEvents(formatted);

        assertEquals(parsed.length, 1);
        assertEquals(parsed[0]?.type, eventType);
      }
    });
  });
});

describe("AI SDK v5 Stream Protocol - Event Structure", () => {
  describe("start Event", () => {
    it("should have required messageId field", () => {
      const event = { type: "start", messageId: "msg-abc123" };

      assertExists(event.messageId);
      assertEquals(typeof event.messageId, "string");
    });
  });

  describe("text-* Events", () => {
    it("text-start should have id field", () => {
      const event = { type: "text-start", id: "text-part-1" };

      assertExists(event.id);
      assertEquals(typeof event.id, "string");
    });

    it("text-delta should have id and delta fields", () => {
      const event = { type: "text-delta", id: "text-part-1", delta: "Hello" };

      assertExists(event.id);
      assertExists(event.delta);
      assertEquals(typeof event.delta, "string");
    });

    it("text-end should have id field", () => {
      const event = { type: "text-end", id: "text-part-1" };

      assertExists(event.id);
    });

    it("all text events should share the same id", () => {
      const textPartId = "text-part-xyz";
      const events = [
        { type: "text-start", id: textPartId },
        { type: "text-delta", id: textPartId, delta: "Hello" },
        { type: "text-delta", id: textPartId, delta: " World" },
        { type: "text-end", id: textPartId },
      ];

      const ids = events.map((e) => e.id);
      const uniqueIds = [...new Set(ids)];

      assertEquals(uniqueIds.length, 1);
      assertEquals(uniqueIds[0], textPartId);
    });
  });

  describe("reasoning-* Events", () => {
    it("reasoning-start should have id field", () => {
      const event = { type: "reasoning-start", id: "reasoning-part-1" };

      assertExists(event.id);
      assertEquals(typeof event.id, "string");
    });

    it("reasoning-delta should have id and delta fields", () => {
      const event = { type: "reasoning-delta", id: "reasoning-part-1", delta: "Thinking..." };

      assertExists(event.id);
      assertExists(event.delta);
      assertEquals(typeof event.delta, "string");
    });

    it("reasoning-end should have id field", () => {
      const event = { type: "reasoning-end", id: "reasoning-part-1" };

      assertExists(event.id);
    });

    it("all reasoning events should share the same id", () => {
      const reasoningPartId = "reasoning-xyz";
      const events = [
        { type: "reasoning-start", id: reasoningPartId },
        { type: "reasoning-delta", id: reasoningPartId, delta: "Let me think" },
        { type: "reasoning-delta", id: reasoningPartId, delta: " about this" },
        { type: "reasoning-end", id: reasoningPartId },
      ];

      const ids = events.map((e) => e.id);
      const uniqueIds = [...new Set(ids)];

      assertEquals(uniqueIds.length, 1);
      assertEquals(uniqueIds[0], reasoningPartId);
    });
  });

  describe("tool-* Events", () => {
    it("tool-input-start should have toolCallId and toolName", () => {
      const event = {
        type: "tool-input-start",
        toolCallId: "call_123",
        toolName: "get_weather",
      };

      assertExists(event.toolCallId);
      assertExists(event.toolName);
    });

    it("tool-input-delta should have toolCallId and inputTextDelta", () => {
      const event = {
        type: "tool-input-delta",
        toolCallId: "call_123",
        inputTextDelta: '{"city":',
      };

      assertExists(event.toolCallId);
      assertExists(event.inputTextDelta);
    });

    it("tool-input-available should have toolCallId, toolName, and input", () => {
      const event = {
        type: "tool-input-available",
        toolCallId: "call_123",
        toolName: "get_weather",
        input: { city: "Tokyo" },
      };

      assertExists(event.toolCallId);
      assertExists(event.toolName);
      assertExists(event.input);
    });

    it("tool-output-available should have toolCallId and output", () => {
      const event = {
        type: "tool-output-available",
        toolCallId: "call_123",
        output: { temperature: 20, condition: "sunny" },
      };

      assertExists(event.toolCallId);
      assertExists(event.output);
    });

    it("dynamic tools should include dynamic: true flag", () => {
      const event = {
        type: "tool-input-start",
        toolCallId: "call_456",
        toolName: "mcp_tool",
        dynamic: true,
      };

      assertEquals(event.dynamic, true);
    });
  });

  describe("step Events", () => {
    it("start-step should have type field", () => {
      const event = { type: "start-step" };

      assertEquals(event.type, "start-step");
    });

    it("finish-step should have type field", () => {
      const event = { type: "finish-step" };

      assertEquals(event.type, "finish-step");
    });
  });

  describe("finish Event", () => {
    it("should have type field", () => {
      const event = { type: "finish" };

      assertEquals(event.type, "finish");
    });
  });

  describe("error Event", () => {
    it("should have error field with message", () => {
      const event = {
        type: "error",
        error: "Something went wrong",
      };

      assertExists(event.error);
      assertEquals(typeof event.error, "string");
    });
  });
});

describe("AI SDK v5 Stream Protocol - Event Ordering", () => {
  it("should have start as first event", () => {
    const events = [
      { type: "start", messageId: "msg-1" },
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "Hello" },
      { type: "text-end", id: "text-1" },
      { type: "finish" },
    ];

    assertEquals(events[0]?.type, "start");
  });

  it("should have finish as last event", () => {
    const events = [
      { type: "start", messageId: "msg-1" },
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "Hello" },
      { type: "text-end", id: "text-1" },
      { type: "finish" },
    ];

    assertEquals(events[events.length - 1]?.type, "finish");
  });

  it("text-start should come before text-delta", () => {
    const events = [
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "Hello" },
      { type: "text-end", id: "text-1" },
    ];

    const startIdx = events.findIndex((e) => e.type === "text-start");
    const deltaIdx = events.findIndex((e) => e.type === "text-delta");

    assertEquals(startIdx < deltaIdx, true);
  });

  it("text-delta should come before text-end", () => {
    const events = [
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "Hello" },
      { type: "text-end", id: "text-1" },
    ];

    const deltaIdx = events.findIndex((e) => e.type === "text-delta");
    const endIdx = events.findIndex((e) => e.type === "text-end");

    assertEquals(deltaIdx < endIdx, true);
  });

  it("reasoning events should come in correct order", () => {
    const events = [
      { type: "reasoning-start", id: "r-1" },
      { type: "reasoning-delta", id: "r-1", delta: "Thinking" },
      { type: "reasoning-end", id: "r-1" },
    ];

    const startIdx = events.findIndex((e) => e.type === "reasoning-start");
    const deltaIdx = events.findIndex((e) => e.type === "reasoning-delta");
    const endIdx = events.findIndex((e) => e.type === "reasoning-end");

    assertEquals(startIdx < deltaIdx, true);
    assertEquals(deltaIdx < endIdx, true);
  });

  it("tool events should follow input->output order", () => {
    const events = [
      { type: "tool-input-start", toolCallId: "c-1", toolName: "test" },
      { type: "tool-input-delta", toolCallId: "c-1", inputTextDelta: "{}" },
      { type: "tool-input-available", toolCallId: "c-1", toolName: "test", input: {} },
      { type: "tool-output-available", toolCallId: "c-1", output: "result" },
    ];

    const inputStartIdx = events.findIndex((e) => e.type === "tool-input-start");
    const inputDeltaIdx = events.findIndex((e) => e.type === "tool-input-delta");
    const inputAvailIdx = events.findIndex((e) => e.type === "tool-input-available");
    const outputIdx = events.findIndex((e) => e.type === "tool-output-available");

    assertEquals(inputStartIdx < inputDeltaIdx, true);
    assertEquals(inputDeltaIdx < inputAvailIdx, true);
    assertEquals(inputAvailIdx < outputIdx, true);
  });
});

describe("AI SDK v5 Stream Protocol - Full Stream Example", () => {
  it("should validate a complete text-only stream", () => {
    const sseText = [
      'data: {"type":"start","messageId":"msg-123"}',
      "",
      'data: {"type":"start-step"}',
      "",
      'data: {"type":"text-start","id":"text-1"}',
      "",
      'data: {"type":"text-delta","id":"text-1","delta":"Hello"}',
      "",
      'data: {"type":"text-delta","id":"text-1","delta":" World"}',
      "",
      'data: {"type":"text-end","id":"text-1"}',
      "",
      'data: {"type":"finish-step"}',
      "",
      'data: {"type":"finish"}',
      "",
    ].join("\n");

    const events = parseSSEEvents(sseText);

    // Validate structure
    assertEquals(events[0]?.type, "start");
    assertEquals(events[events.length - 1]?.type, "finish");

    // Validate text events exist
    const textStart = events.find((e) => e.type === "text-start");
    const textDeltas = events.filter((e) => e.type === "text-delta");
    const textEnd = events.find((e) => e.type === "text-end");

    assertExists(textStart);
    assertEquals(textDeltas.length, 2);
    assertExists(textEnd);

    // Validate text content
    const fullText = textDeltas.map((e) => e.delta).join("");
    assertEquals(fullText, "Hello World");
  });

  it("should validate a stream with reasoning", () => {
    const sseText = [
      'data: {"type":"start","messageId":"msg-456"}',
      "",
      'data: {"type":"start-step"}',
      "",
      'data: {"type":"text-start","id":"text-1"}',
      "",
      'data: {"type":"reasoning-start","id":"r-1"}',
      "",
      'data: {"type":"reasoning-delta","id":"r-1","delta":"Let me think..."}',
      "",
      'data: {"type":"reasoning-end","id":"r-1"}',
      "",
      'data: {"type":"text-delta","id":"text-1","delta":"The answer is 4"}',
      "",
      'data: {"type":"text-end","id":"text-1"}',
      "",
      'data: {"type":"finish-step"}',
      "",
      'data: {"type":"finish"}',
      "",
    ].join("\n");

    const events = parseSSEEvents(sseText);

    // Validate reasoning events
    const reasoningStart = events.find((e) => e.type === "reasoning-start");
    const reasoningDelta = events.find((e) => e.type === "reasoning-delta");
    const reasoningEnd = events.find((e) => e.type === "reasoning-end");

    assertExists(reasoningStart);
    assertExists(reasoningDelta);
    assertExists(reasoningEnd);

    // Validate reasoning content
    assertEquals(reasoningDelta.delta, "Let me think...");

    // Validate reasoning comes before text-end
    const reasoningEndIdx = events.findIndex((e) => e.type === "reasoning-end");
    const textEndIdx = events.findIndex((e) => e.type === "text-end");
    assertEquals(reasoningEndIdx < textEndIdx, true);
  });

  it("should validate a stream with tool calls", () => {
    const sseText = [
      'data: {"type":"start","messageId":"msg-789"}',
      "",
      'data: {"type":"start-step"}',
      "",
      'data: {"type":"text-start","id":"text-1"}',
      "",
      'data: {"type":"tool-input-start","toolCallId":"call-1","toolName":"get_weather"}',
      "",
      'data: {"type":"tool-input-delta","toolCallId":"call-1","inputTextDelta":"{\\"city\\":"}',
      "",
      'data: {"type":"tool-input-delta","toolCallId":"call-1","inputTextDelta":"\\"Tokyo\\"}"}',
      "",
      'data: {"type":"tool-input-available","toolCallId":"call-1","toolName":"get_weather","input":{"city":"Tokyo"}}',
      "",
      'data: {"type":"tool-output-available","toolCallId":"call-1","output":{"temp":20}}',
      "",
      'data: {"type":"finish-step"}',
      "",
      'data: {"type":"start-step"}',
      "",
      'data: {"type":"text-delta","id":"text-1","delta":"The temperature in Tokyo is 20°C"}',
      "",
      'data: {"type":"text-end","id":"text-1"}',
      "",
      'data: {"type":"finish-step"}',
      "",
      'data: {"type":"finish"}',
      "",
    ].join("\n");

    const events = parseSSEEvents(sseText);

    // Validate tool events
    const toolStart = events.find((e) => e.type === "tool-input-start");
    const toolDeltas = events.filter((e) => e.type === "tool-input-delta");
    const toolAvailable = events.find((e) => e.type === "tool-input-available");
    const toolOutput = events.find((e) => e.type === "tool-output-available");

    assertExists(toolStart);
    assertEquals(toolDeltas.length, 2);
    assertExists(toolAvailable);
    assertExists(toolOutput);

    // Validate tool call ID consistency
    assertEquals(toolStart.toolCallId, "call-1");
    assertEquals(toolDeltas[0]?.toolCallId, "call-1");
    assertEquals(toolAvailable.toolCallId, "call-1");
    assertEquals(toolOutput.toolCallId, "call-1");

    // Validate tool input
    assertEquals((toolAvailable.input as { city: string }).city, "Tokyo");

    // Validate tool output
    assertEquals((toolOutput.output as { temp: number }).temp, 20);

    // Validate step events for multi-step
    const stepStarts = events.filter((e) => e.type === "start-step");
    const stepFinishes = events.filter((e) => e.type === "finish-step");

    assertEquals(stepStarts.length, 2); // One for tool call, one for response
    assertEquals(stepFinishes.length, 2);
  });
});
