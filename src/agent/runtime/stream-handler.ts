/**
 * Stream Handler
 *
 * Handles streaming protocol parsing and event emission.
 *
 * @module ai/agent/runtime/stream-handler
 */

import { serverLogger as logger } from "#veryfront/utils";
import type { AgentStreamEvent } from "../streaming/index.ts";
import { AgentStreamEventSchema } from "../streaming/index.ts";
import { sendSSE } from "./sse-utils.ts";
import { isDynamicTool, parseToolArgs } from "./tool-helpers.ts";
import { MAX_STREAM_BUFFER_SIZE } from "./constants.ts";

/**
 * Tool call state during streaming.
 */
export interface StreamingToolCall {
  id: string;
  name: string;
  arguments: string;
}

/**
 * Streaming state for a single step.
 */
export interface StreamState {
  accumulatedText: string;
  finishReason: string | null;
  toolCalls: Map<string, StreamingToolCall>;
}

/**
 * Callbacks for streaming events.
 */
export interface StreamCallbacks {
  onChunk?: (chunk: string) => void;
  onUsage?: (
    usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number },
  ) => void;
}

/**
 * Create initial stream state.
 */
export function createStreamState(): StreamState {
  return {
    accumulatedText: "",
    finishReason: null,
    toolCalls: new Map(),
  };
}

/**
 * Handle a single stream event and update state.
 * Also sends SSE events to the controller.
 */
export function handleStreamEvent(
  event: AgentStreamEvent,
  state: StreamState,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  textPartId: string | undefined,
  callbacks?: StreamCallbacks,
): void {
  switch (event.type) {
    case "content": {
      state.accumulatedText += event.content;

      // Use Vercel AI SDK UI Message Stream Protocol v5 format
      sendSSE(controller, encoder, {
        type: "text-delta",
        id: textPartId,
        delta: event.content,
      });

      if (callbacks?.onChunk) {
        callbacks.onChunk(event.content);
      }
      break;
    }

    case "tool_call_start":
      if (event.toolCall?.id) {
        state.toolCalls.set(event.toolCall.id, {
          id: event.toolCall.id,
          name: event.toolCall.name,
          arguments: "",
        });

        // Send tool-input-start event (AI SDK v5 UI Message Stream Protocol)
        const dynamic = isDynamicTool(event.toolCall.name);
        sendSSE(controller, encoder, {
          type: "tool-input-start",
          toolCallId: event.toolCall.id,
          toolName: event.toolCall.name,
          ...(dynamic && { dynamic: true }),
        });
      }
      break;

    case "tool_call_delta":
      if (event.id && state.toolCalls.has(event.id)) {
        const tc = state.toolCalls.get(event.id)!;
        tc.arguments += event.arguments;

        // Send tool-input-delta event (AI SDK v5 UI Message Stream Protocol)
        sendSSE(controller, encoder, {
          type: "tool-input-delta",
          toolCallId: event.id,
          inputTextDelta: event.arguments,
        });
      }
      break;

    case "tool_call_complete":
      if (event.toolCall?.id) {
        state.toolCalls.set(event.toolCall.id, {
          id: event.toolCall.id,
          name: event.toolCall.name,
          arguments: event.toolCall.arguments,
        });

        // Send tool-input-available event (AI SDK v5 UI Message Stream Protocol)
        const dynamic = isDynamicTool(event.toolCall.name);
        const { args } = parseToolArgs(event.toolCall.arguments);
        sendSSE(controller, encoder, {
          type: "tool-input-available",
          toolCallId: event.toolCall.id,
          toolName: event.toolCall.name,
          input: args,
          ...(dynamic && { dynamic: true }),
        });
      }
      break;

    case "finish":
      state.finishReason = event.finishReason;
      break;

    case "usage":
      if (event.usage && callbacks?.onUsage) {
        callbacks.onUsage(event.usage);
      }
      break;
  }
}

/**
 * Parse streaming data and process events.
 * Handles buffering and parsing of newline-delimited JSON.
 */
export async function processStreamData(
  stream: ReadableStream,
  state: StreamState,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  textPartId: string | undefined,
  callbacks?: StreamCallbacks,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let partial = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) break;

    partial += decoder.decode(value, { stream: true });

    // Prevent unbounded buffer growth
    if (partial.length > MAX_STREAM_BUFFER_SIZE) {
      logger.warn("[AGENT] Stream buffer exceeded max size, truncating");
      partial = partial.slice(-MAX_STREAM_BUFFER_SIZE / 2);
    }

    const segments = partial.split("\n");
    partial = segments.pop() ?? "";
    const lines = segments.filter((line) => line.trim());

    for (const line of lines) {
      try {
        const rawEvent = JSON.parse(line);
        const parseResult = AgentStreamEventSchema.safeParse(rawEvent);

        if (parseResult.success) {
          handleStreamEvent(
            parseResult.data,
            state,
            controller,
            encoder,
            textPartId,
            callbacks,
          );
        } else {
          logger.warn("[AGENT] Invalid stream event received:", parseResult.error);
        }
      } catch (e) {
        logger.warn("[AGENT] Failed to parse stream line:", e);
        continue;
      }
    }
  }

  // Process any remaining partial data
  if (partial.trim()) {
    try {
      const rawEvent = JSON.parse(partial);
      const parseResult = AgentStreamEventSchema.safeParse(rawEvent);
      if (parseResult.success) {
        handleStreamEvent(
          parseResult.data,
          state,
          controller,
          encoder,
          textPartId,
          callbacks,
        );
      }
    } catch {
      // Ignore trailing partial
    }
  }
}
