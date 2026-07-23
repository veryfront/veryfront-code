import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#std/assert";
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
  getStreamSteps,
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
  it("propagates rejected step promises instead of converting failures into empty history", async () => {
    await assertRejects(
      () => getStreamSteps({ steps: Promise.reject(new Error("step collection failed")) }),
      Error,
      "step collection failed",
    );
  });

  it("rejects invalid finalization timeout configuration", async () => {
    await assertRejects(
      () => getStreamSteps({ steps: Promise.resolve([]) }, 0),
      RangeError,
      "timeoutMs must be a positive safe timer duration",
    );
  });

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

  it("preserves provider error-text tool results as terminal errors", () => {
    const step = {
      response: {
        messages: [
          {
            role: "assistant",
            content: [{
              type: "tool-call",
              toolCallId: "tool-failed",
              toolName: "search",
              input: { query: "status" },
            }],
          },
          {
            role: "tool",
            content: [{
              type: "tool-result",
              toolCallId: "tool-failed",
              toolName: "search",
              output: { type: "error-text", value: "Search failed" },
            }],
          },
        ],
      },
    };

    assertEquals(buildFallbackUiMessageParts(step), [{
      type: "dynamic-tool",
      toolName: "search",
      toolCallId: "tool-failed",
      input: { query: "status" },
      state: "output-error",
      errorText: "Search failed",
    }]);
  });

  it("preserves reasoning parts from response message content", () => {
    const step = {
      response: {
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "reasoning",
                text: "Checking the available tool.",
                signature: "sig_123",
              },
              { type: "text", text: "Use the saved draft." },
            ],
          },
        ],
      },
    };

    assertEquals(buildFallbackUiMessageParts(step), [
      {
        type: "reasoning",
        text: "Checking the available tool.",
        signature: "sig_123",
      },
      { type: "text", text: "Use the saved draft." },
    ]);
  });

  it("keeps final step text when ordered response messages contain only tools", () => {
    const step = {
      text: "The final answer is ready.",
      response: {
        messages: [{
          role: "assistant",
          content: [{
            type: "tool-call",
            toolCallId: "tool-check",
            toolName: "check",
            input: {},
          }],
        }],
      },
    };

    assertEquals(buildFallbackUiMessageParts(step), [
      {
        type: "dynamic-tool",
        toolName: "check",
        toolCallId: "tool-check",
        input: {},
        state: "input-available",
      },
      { type: "text", text: "The final answer is ready." },
    ]);
  });

  it("builds fallback chunks from response message reasoning, tool calls, tool results, and text", () => {
    const step = {
      response: {
        messages: [
          {
            role: "assistant",
            content: [
              { type: "reasoning", text: "Need the draft status." },
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
              { type: "text", text: "Draft is ready." },
            ],
          },
        ],
      },
    };

    assertEquals(buildFallbackUiMessageChunks(step, "assistant-1"), [
      { type: "reasoning-start", id: "assistant-1:reasoning" },
      {
        type: "reasoning-delta",
        id: "assistant-1:reasoning",
        delta: "Need the draft status.",
      },
      { type: "reasoning-end", id: "assistant-1:reasoning" },
      { type: "tool-input-start", toolCallId: "tool-form", toolName: "form_input" },
      {
        type: "tool-input-available",
        toolCallId: "tool-form",
        toolName: "form_input",
        input: { title: "Topic" },
      },
      { type: "tool-output-available", toolCallId: "tool-form", output: { submitted: true } },
      { type: "text-start", id: "assistant-1" },
      { type: "text-delta", id: "assistant-1", delta: "Draft is ready." },
      { type: "text-end", id: "assistant-1" },
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

  it("preserves terminal canonical UI tool states", () => {
    const step = {
      response: {
        messages: [{
          role: "assistant",
          parts: [
            {
              type: "dynamic-tool",
              toolCallId: "tool-ok",
              toolName: "search",
              input: { query: "status" },
              state: "output-available",
              output: { found: true },
            },
            {
              type: "dynamic-tool",
              toolCallId: "tool-error",
              toolName: "write",
              input: { path: "notes.txt" },
              state: "output-error",
              errorText: "Write failed",
            },
          ],
        }],
      },
    };

    assertEquals(buildFallbackUiMessageParts(step), [
      {
        type: "dynamic-tool",
        toolCallId: "tool-ok",
        toolName: "search",
        input: { query: "status" },
        state: "output-available",
        output: { found: true },
      },
      {
        type: "dynamic-tool",
        toolCallId: "tool-error",
        toolName: "write",
        input: { path: "notes.txt" },
        state: "output-error",
        errorText: "Write failed",
      },
    ]);
  });

  it("preserves legacy UI tool result errors", () => {
    assertEquals(
      buildFallbackUiMessageParts({
        response: {
          messages: [
            {
              role: "assistant",
              parts: [{
                type: "tool_call",
                toolCallId: "tool-1",
                toolName: "search",
                input: { query: "status" },
              }],
            },
            {
              role: "tool",
              parts: [{
                type: "tool_result",
                tool_call_id: "tool-1",
                is_error: true,
                output: "Search failed",
              }],
            },
          ],
        },
      }),
      [{
        type: "dynamic-tool",
        toolCallId: "tool-1",
        toolName: "search",
        input: { query: "status" },
        state: "output-error",
        errorText: "Search failed",
      }],
    );
  });

  it("does not attach fallback tool results across a later user turn", () => {
    const step = {
      response: {
        messages: [
          {
            role: "assistant",
            parts: [{
              type: "dynamic-tool",
              toolCallId: "tool-old",
              toolName: "search",
              input: { query: "old" },
              state: "input-available",
            }],
          },
          { role: "user", parts: [{ type: "text", text: "Start over." }] },
          {
            role: "tool",
            parts: [{
              type: "tool_result",
              tool_call_id: "tool-old",
              output: { stale: true },
            }],
          },
          { role: "assistant", parts: [{ type: "text", text: "Fresh answer." }] },
        ],
      },
    };

    assertEquals(buildFallbackUiMessageParts(step), [
      { type: "text", text: "Fresh answer." },
    ]);
  });

  it("emits each fallback tool lifecycle transition at most once", () => {
    assertEquals(
      buildMissingFallbackToolChunks({
        toolCalls: [formToolCall, formToolCall],
        toolResults: [formToolResult, formToolResult],
      }),
      [
        { type: "tool-input-start", toolCallId: "tool-1", toolName: "form_input" },
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

  it("does not execute tool input accessors while building fallback parts", () => {
    let getterCalls = 0;
    const input: Record<string, unknown> = {};
    Object.defineProperty(input, "secret", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "hidden";
      },
    });

    assertEquals(
      buildFallbackUiMessageParts({
        toolCalls: [{ toolCallId: "tool-1", toolName: "inspect", input }],
      }),
      [{
        type: "dynamic-tool",
        toolCallId: "tool-1",
        toolName: "inspect",
        input: {},
        state: "input-available",
      }],
    );
    assertEquals(getterCalls, 0);
  });

  it("keeps the global fallback entry budget across nested tool-input arrays", () => {
    let descriptorReads = 0;
    const trackDescriptors = (target: unknown[]) =>
      new Proxy(target, {
        getOwnPropertyDescriptor(target, key) {
          if (typeof key === "string" && /^\d+$/u.test(key)) descriptorReads += 1;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      });
    const inner = trackDescriptors(new Array(10_000).fill(null));
    const outerValues = new Array(10_000).fill(null);
    outerValues[0] = inner;
    const outer = trackDescriptors(outerValues);

    buildFallbackUiMessageParts({
      toolCalls: [{
        toolCallId: "tool-budget",
        toolName: "inspect",
        input: { nested: outer },
      }],
    });

    assertEquals(descriptorReads <= 10_000, true);
  });

  it("retains output-streaming tools as incomplete fallback calls", () => {
    assertEquals(
      buildMissingFallbackToolChunksFromParts([{
        type: "dynamic-tool",
        toolName: "inspect",
        toolCallId: "tool-streaming-output",
        input: { path: "README.md" },
        state: "output-streaming",
      }]),
      [
        {
          type: "tool-input-start",
          toolCallId: "tool-streaming-output",
          toolName: "inspect",
        },
        {
          type: "tool-input-available",
          toolCallId: "tool-streaming-output",
          toolName: "inspect",
          input: { path: "README.md" },
        },
      ],
    );
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
    assertEquals(
      extractFinalStepTerminalError({
        response: {
          body: `${" ".repeat(1_048_576)}${
            JSON.stringify({
              slug: "resource-limit-exceeded",
              suggestion: "This oversized body must not be parsed.",
            })
          }`,
        },
      }),
      null,
    );
  });
});
