import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "@std/assert";
import { createMirroredToolChunkState } from "../streaming/mirrored-tool-chunk-state.ts";
import {
  buildDetachedFallbackChunks,
  buildDetachedFallbackMessageState,
  buildFinalizedMessageFallbackChunks,
  buildFinalizedMessageState,
} from "./finalized-message.ts";

Deno.test("buildFinalizedMessageState builds fallback parts for an empty finalized assistant message", () => {
  const result = buildFinalizedMessageState({
    responseMessage: {
      id: "assistant-1",
      role: "assistant",
      parts: [],
    },
    isAborted: false,
    finalStep: { text: "Done" },
    incompleteToolCallsPartErrorText: "tool error",
  });

  assertEquals(result.persistedMessage.parts, []);
  assertEquals(result.sanitizedFinalizedMessage.parts, [{ type: "text", text: "Done" }]);
  assertEquals(result.hasIncompleteFinalizedToolParts, false);
});

Deno.test("buildFinalizedMessageState preserves tool-before-text fallback ordering after runtime metadata", () => {
  const result = buildFinalizedMessageState({
    responseMessage: {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "data-veryfront.runtime_context", data: { currentDateUtc: "2026-10-07" } }],
    },
    isAborted: false,
    finalStep: {
      text: "Done",
      toolCalls: [{ toolCallId: "call-1", toolName: "form_input", input: { title: "Continue?" } }],
      toolResults: [{ toolCallId: "call-1", toolName: "form_input", output: { submitted: true } }],
    },
    incompleteToolCallsPartErrorText: "tool error",
  });

  assertEquals(result.sanitizedFinalizedMessage.parts.map((part) => part.type), [
    "data-veryfront.runtime_context",
    "dynamic-tool",
    "text",
  ]);
  assertEquals(result.hasIncompleteFinalizedToolParts, false);
});

Deno.test("buildFinalizedMessageState matches persisted reasoning fallbacks one at a time", () => {
  const result = buildFinalizedMessageState({
    responseMessage: {
      id: "assistant-1",
      role: "assistant",
      parts: [
        { type: "data-veryfront.runtime_context", data: { currentDateUtc: "2026-10-07" } },
        {
          type: "reasoning",
          text: "Checking the retained state.",
          signature: "sig_123",
        },
      ],
    },
    isAborted: false,
    finalStep: {
      response: {
        messages: [{
          role: "assistant",
          content: [
            {
              type: "reasoning",
              text: "Checking the retained state.",
              signature: "sig_123",
            },
            {
              type: "reasoning",
              text: "Checking the retained state.",
              signature: "sig_123",
            },
          ],
        }],
      },
    },
    incompleteToolCallsPartErrorText: "tool error",
  });

  assertEquals(result.sanitizedFinalizedMessage.parts, [
    { type: "data-veryfront.runtime_context", data: { currentDateUtc: "2026-10-07" } },
    {
      type: "reasoning",
      text: "Checking the retained state.",
      signature: "sig_123",
    },
    {
      type: "reasoning",
      text: "Checking the retained state.",
      signature: "sig_123",
    },
  ]);
  assertEquals(result.hasIncompleteFinalizedToolParts, false);
});

Deno.test("buildFinalizedMessageState preserves text-before-tool fallback ordering after runtime metadata", () => {
  const result = buildFinalizedMessageState({
    responseMessage: {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "data-veryfront.runtime_context", data: { currentDateUtc: "2026-10-07" } }],
    },
    isAborted: false,
    finalStep: {
      response: {
        messages: [{
          role: "assistant",
          content: [
            { type: "text", text: "Checking now." },
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "form_input",
              input: { title: "Continue?" },
            },
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "form_input",
              output: { submitted: true },
            },
          ],
        }],
      },
    },
    incompleteToolCallsPartErrorText: "tool error",
  });

  assertEquals(result.sanitizedFinalizedMessage.parts.map((part) => part.type), [
    "data-veryfront.runtime_context",
    "text",
    "dynamic-tool",
  ]);
  assertEquals(result.hasIncompleteFinalizedToolParts, false);
});

Deno.test("buildFinalizedMessageState does not fail provider-owned input-available tools", () => {
  const result = buildFinalizedMessageState({
    responseMessage: {
      id: "assistant-1",
      role: "assistant",
      parts: [
        { type: "text", text: "Done" },
        {
          type: "tool-web_fetch",
          toolCallId: "srvtoolu-fetch",
          input: { url: "https://example.com/docs" },
          state: "input-available",
          providerExecuted: true,
        },
      ],
    },
    isAborted: false,
    finalStep: { text: "Done" },
    incompleteToolCallsPartErrorText: "tool error",
  });

  assertEquals(result.hasIncompleteFinalizedToolParts, false);
  assertEquals(result.sanitizedFinalizedMessage.parts, [
    { type: "text", text: "Done" },
    {
      type: "tool-web_fetch",
      toolCallId: "srvtoolu-fetch",
      input: { url: "https://example.com/docs" },
      state: "input-available",
      providerExecuted: true,
    },
  ]);
});

Deno.test("buildFinalizedMessageState fails local web_fetch input-available tools without providerExecuted", () => {
  const result = buildFinalizedMessageState({
    responseMessage: {
      id: "assistant-1",
      role: "assistant",
      parts: [
        { type: "text", text: "Done" },
        {
          type: "tool-web_fetch",
          toolCallId: "srvtoolu-fetch",
          input: { url: "https://veryfront.com/docs/agent/create-agent" },
          state: "input-available",
        },
      ],
    },
    isAborted: false,
    finalStep: { text: "Done" },
    incompleteToolCallsPartErrorText: "tool error",
  });

  assertEquals(result.hasIncompleteFinalizedToolParts, true);
  assertEquals(result.sanitizedFinalizedMessage.parts, [
    { type: "text", text: "Done" },
    {
      type: "tool-web_fetch",
      toolCallId: "srvtoolu-fetch",
      input: { url: "https://veryfront.com/docs/agent/create-agent" },
      state: "output-error",
      errorText: "tool error",
    },
  ]);
});

Deno.test("buildFinalizedMessageState marks incomplete tool parts as stopped instead of errored when aborted", () => {
  const result = buildFinalizedMessageState({
    responseMessage: {
      id: "assistant-1",
      role: "assistant",
      parts: [
        {
          type: "tool-bash",
          toolCallId: "call-1",
          input: { command: "ls" },
          state: "input-available",
        },
      ],
    },
    isAborted: true,
    finalStep: { text: "" },
    incompleteToolCallsPartErrorText: "tool error",
  });

  assertEquals(
    result.hasIncompleteFinalizedToolParts,
    false,
    "aborted runs must not be flagged as incomplete tool failures",
  );
  assertEquals(
    result.persistedMessage.parts,
    [
      {
        type: "tool-bash",
        toolCallId: "call-1",
        input: { command: "ls" },
        state: "output-error",
        errorText: "Stopped by user",
      },
    ],
    "aborted persisted message must carry the stopped tool part",
  );
  assertEquals(
    result.sanitizedFinalizedMessage.parts,
    result.persistedMessage.parts,
    "aborted runs must not convert tool parts to the tool error text",
  );
});

Deno.test("buildDetachedFallbackMessageState leaves unfinished tool calls untouched when aborted", () => {
  const result = buildDetachedFallbackMessageState({
    capturedMessageId: "captured-1",
    finalStep: {
      text: "",
      toolCalls: [{ toolCallId: "call-1", toolName: "bash", input: { command: "ls" } }],
    },
    isAborted: true,
    incompleteToolCallsPartErrorText: "tool error",
  });

  assertEquals(
    result.hasIncompleteFallbackToolParts,
    false,
    "aborted detached runs must not be flagged as incomplete tool failures",
  );
  assertEquals(
    result.finalizedFallbackMessage.parts.some((part) =>
      "state" in part && part.state === "output-error"
    ),
    false,
    "aborted detached runs must not convert tool parts to output-error",
  );
  assertEquals(
    result.finalizedFallbackMessage.parts.some((part) =>
      part.type === "dynamic-tool" && part.toolName === "bash" && part.state === "input-available"
    ),
    true,
    "the unfinished tool call must still be present in the fallback message",
  );
});

Deno.test("buildDetachedFallbackMessageState uses the captured message id for detached fallback messages", () => {
  const result = buildDetachedFallbackMessageState({
    capturedMessageId: "captured-1",
    finalStep: { text: "Detached done" },
    isAborted: false,
    incompleteToolCallsPartErrorText: "tool error",
  });

  assertEquals(result.finalizedFallbackMessage, {
    id: "captured-1",
    role: "assistant",
    parts: [{ type: "text", text: "Detached done" }],
  });
  assertEquals(result.hasIncompleteFallbackToolParts, false);
});

Deno.test("buildFinalizedMessageFallbackChunks builds finalized fallback text chunks for empty persisted messages", () => {
  const result = buildFinalizedMessageFallbackChunks({
    persistedMessage: {
      id: "assistant-1",
      role: "assistant",
      parts: [],
    },
    sanitizedFinalizedMessage: {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "text", text: "Done" }],
    },
    finalStep: { text: "Done" },
    mirroredToolChunkState: createMirroredToolChunkState(),
    capturedMessageId: null,
    hasIncompleteFinalizedToolParts: false,
  });

  assertEquals(result, [
    { type: "text-start", id: "assistant-1" },
    { type: "text-delta", id: "assistant-1", delta: "Done" },
    { type: "text-end", id: "assistant-1" },
  ]);
});

Deno.test("buildFinalizedMessageFallbackChunks preserves ordered text without duplicating mirrored tools", () => {
  const mirroredToolChunkState = createMirroredToolChunkState();
  mirroredToolChunkState.startedToolCallIds.add("call-1");
  mirroredToolChunkState.inputAvailableToolCallIds.add("call-1");
  mirroredToolChunkState.outputAvailableToolCallIds.add("call-1");

  const finalStep = {
    response: {
      messages: [{
        role: "assistant",
        content: [
          { type: "text", text: "Checking now." },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "form_input",
            input: { title: "Continue?" },
          },
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "form_input",
            output: { submitted: true },
          },
        ],
      }],
    },
  };

  const result = buildFinalizedMessageFallbackChunks({
    persistedMessage: {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "data-veryfront.runtime_context", data: {} }],
    },
    sanitizedFinalizedMessage: {
      id: "assistant-1",
      role: "assistant",
      parts: [
        { type: "data-veryfront.runtime_context", data: {} },
        { type: "text", text: "Checking now." },
        {
          type: "dynamic-tool",
          toolName: "form_input",
          toolCallId: "call-1",
          input: { title: "Continue?" },
          state: "output-available",
          output: { submitted: true },
        },
      ],
    },
    finalStep,
    mirroredToolChunkState,
    capturedMessageId: null,
    hasIncompleteFinalizedToolParts: false,
  });

  assertEquals(result, [
    { type: "text-start", id: "assistant-1" },
    { type: "text-delta", id: "assistant-1", delta: "Checking now." },
    { type: "text-end", id: "assistant-1" },
  ]);
});

Deno.test("buildDetachedFallbackChunks omits detached fallback text chunks when durable output is already mirrored", () => {
  const result = buildDetachedFallbackChunks({
    fallbackParts: [{ type: "text", text: "Done" }],
    finalStep: { text: "Done" },
    mirroredToolChunkState: createMirroredToolChunkState(),
    mirroredDurableOutput: true,
    capturedMessageId: "captured-1",
    hasIncompleteFallbackToolParts: false,
  });

  assertEquals(result, []);
});
