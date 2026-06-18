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

Deno.test("buildFinalizedMessageState does not fail provider-native web tools when providerExecuted is omitted", () => {
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

  assertEquals(result.hasIncompleteFinalizedToolParts, false);
  assertEquals(result.sanitizedFinalizedMessage.parts, [
    { type: "text", text: "Done" },
    {
      type: "tool-web_fetch",
      toolCallId: "srvtoolu-fetch",
      input: { url: "https://veryfront.com/docs/agent/create-agent" },
      state: "input-available",
    },
  ]);
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
