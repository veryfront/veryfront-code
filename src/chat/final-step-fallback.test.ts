import { assertEquals } from "#std/assert";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  appendMissingFallbackTextPart,
  buildFallbackUiMessageChunks,
  buildFallbackUiMessageParts,
  buildMissingFallbackTextChunks,
  buildMissingFallbackToolChunks,
  buildMissingFallbackToolChunksFromParts,
  extractFinalStepFinishReason,
  extractFinalStepTerminalError,
  extractFinalStepText,
  extractFinalStepToolCalls,
  extractFinalStepToolResults,
} from "./final-step-fallback.ts";

const formToolCall = {
  toolName: "form_input",
  toolCallId: "tool-1",
  input: { title: "Continue?" },
};
const formToolResult = {
  toolName: "form_input",
  toolCallId: "tool-1",
  output: { submitted: true },
};

describe("chat/final-step-fallback", () => {
  it("extracts finish reason, text, tool calls, and tool results", () => {
    const step = {
      finishReason: "stop",
      text: "ROOT OK",
      toolCalls: [formToolCall],
      toolResults: [formToolResult],
    };

    assertEquals(extractFinalStepFinishReason(step), "stop");
    assertEquals(extractFinalStepFinishReason({ finishReason: 123 }), null);
    assertEquals(extractFinalStepText(step), "ROOT OK");
    assertEquals(extractFinalStepToolCalls(step), [formToolCall]);
    assertEquals(extractFinalStepToolResults(step), [{
      ...formToolCall,
      output: { submitted: true },
    }]);
  });

  it("recovers assistant text from provider response messages", () => {
    assertEquals(
      extractFinalStepText({
        text: "",
        response: {
          messages: [
            {
              role: "assistant",
              content: [
                { type: "text", text: "Recovered from response message." },
                { type: "tool-call", toolCallId: "tool-1", toolName: "form_input", input: {} },
              ],
            },
          ],
        },
      }),
      "Recovered from response message.",
    );
  });

  it("preserves ordered text and tool parts from response message content", () => {
    const step = {
      response: {
        messages: [
          {
            role: "assistant",
            content: [
              { type: "text", text: "First text" },
              {
                type: "tool-call",
                toolCallId: "tool-form",
                toolName: "form_input",
                input: { title: "Topic" },
              },
              {
                type: "tool-result",
                toolCallId: "tool-form",
                toolName: "form_input",
                output: { submitted: true },
              },
              { type: "text", text: "Final text" },
            ],
          },
        ],
      },
    };

    assertEquals(buildFallbackUiMessageParts(step), [
      { type: "text", text: "First text" },
      {
        type: "dynamic-tool",
        toolName: "form_input",
        toolCallId: "tool-form",
        input: { title: "Topic" },
        state: "output-available",
        output: { submitted: true },
      },
      { type: "text", text: "Final text" },
    ]);
  });

  it("preserves ordered text and tool parts from UI response messages", () => {
    const step = {
      response: {
        messages: [
          { role: "assistant", parts: [{ type: "text", text: "First text" }] },
          {
            role: "assistant",
            parts: [{
              type: "tool-form_input",
              toolCallId: "tool-form",
              toolName: "form_input",
              args: { title: "Topic" },
            }],
          },
          {
            role: "tool",
            parts: [{ type: "tool-result", toolCallId: "tool-form", result: { submitted: true } }],
          },
          { role: "assistant", parts: [{ type: "text", text: "Final text" }] },
        ],
      },
    };

    assertEquals(buildFallbackUiMessageParts(step), [
      { type: "text", text: "First text" },
      {
        type: "dynamic-tool",
        toolName: "form_input",
        toolCallId: "tool-form",
        input: { title: "Topic" },
        state: "output-available",
        output: { submitted: true },
      },
      { type: "text", text: "Final text" },
    ]);
  });

  it("builds text and tool chunks for durable fallback mirroring", () => {
    assertEquals(
      buildFallbackUiMessageChunks({
        toolCalls: [formToolCall],
        toolResults: [formToolResult],
        text: "OK",
      }, "assistant-1"),
      [
        { type: "tool-input-start", toolCallId: "tool-1", toolName: "form_input" },
        {
          type: "tool-input-available",
          toolCallId: "tool-1",
          toolName: "form_input",
          input: { title: "Continue?" },
        },
        { type: "tool-output-available", toolCallId: "tool-1", output: { submitted: true } },
        { type: "text-start", id: "assistant-1" },
        { type: "text-delta", id: "assistant-1", delta: "OK" },
        { type: "text-end", id: "assistant-1" },
      ],
    );
  });

  it("appends only missing final-step text suffixes", () => {
    const existingParts = [
      { type: "text" as const, text: "Let me re-read the skill." },
      { type: "text" as const, text: "Now I have the skill content." },
    ];

    const finalStep = {
      text: "Let me re-read the skill.\nNow I have the skill content.\nHere are 3 options.",
    };

    assertEquals(appendMissingFallbackTextPart(existingParts, finalStep), [
      ...existingParts,
      { type: "text", text: "Here are 3 options." },
    ]);
    assertEquals(buildMissingFallbackTextChunks(existingParts, finalStep, "assistant-1"), [
      { type: "text-start", id: "assistant-1" },
      { type: "text-delta", id: "assistant-1", delta: "Here are 3 options." },
      { type: "text-end", id: "assistant-1" },
    ]);
  });

  it("builds only missing tool chunks from steps and finalized parts", () => {
    const state = {
      startedToolCallIds: new Set(["tool-1"]),
      inputAvailableToolCallIds: new Set<string>(),
      outputAvailableToolCallIds: new Set<string>(),
    };

    assertEquals(
      buildMissingFallbackToolChunks(
        { toolCalls: [formToolCall], toolResults: [formToolResult] },
        state,
      ),
      [
        {
          type: "tool-input-available",
          toolCallId: "tool-1",
          toolName: "form_input",
          input: { title: "Continue?" },
        },
        { type: "tool-output-available", toolCallId: "tool-1", output: { submitted: true } },
      ],
    );

    assertEquals(
      buildMissingFallbackToolChunksFromParts([
        {
          type: "dynamic-tool",
          toolName: "form_input",
          toolCallId: "tool-1",
          input: { title: "Continue?" },
          state: "output-available",
          output: { submitted: true },
        },
      ], state),
      [
        {
          type: "tool-input-available",
          toolCallId: "tool-1",
          toolName: "form_input",
          input: { title: "Continue?" },
        },
        { type: "tool-output-available", toolCallId: "tool-1", output: { submitted: true } },
      ],
    );
  });

  it("extracts known terminal errors from final-step response bodies", () => {
    assertEquals(
      extractFinalStepTerminalError({
        response: {
          body: JSON.stringify({
            slug: "resource-limit-exceeded",
            suggestion: "Reduce request size and try again.",
          }),
        },
      }),
      { code: "RESOURCE_LIMIT_EXCEEDED", message: "Reduce request size and try again." },
    );
  });
});
