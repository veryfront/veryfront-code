import { serverLogger as logger } from "#veryfront/utils";
import type { AgentStreamEvent } from "../streaming/index.ts";
import { AgentStreamEventSchema } from "../streaming/index.ts";
import { sendSSE } from "./sse-utils.ts";
import { isDynamicTool, parseToolArgs } from "./tool-helpers.ts";
import { MAX_STREAM_BUFFER_SIZE } from "./constants.ts";
import { setActiveSpanAttributes, withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

const log = logger.component("agent");

export interface StreamingToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface StreamState {
  accumulatedText: string;
  finishReason: string | null;
  toolCalls: Map<string, StreamingToolCall>;
}

export interface StreamCallbacks {
  onChunk?: (chunk: string) => void;
  onUsage?: (usage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  }) => void;
}

export function createStreamState(): StreamState {
  return {
    accumulatedText: "",
    finishReason: null,
    toolCalls: new Map(),
  };
}

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

      sendSSE(controller, encoder, {
        type: "text-delta",
        id: textPartId,
        delta: event.content,
      });

      callbacks?.onChunk?.(event.content);
      return;
    }

    case "tool_call_start": {
      const id = event.toolCall?.id;
      if (!id) return;

      state.toolCalls.set(id, {
        id,
        name: event.toolCall.name,
        arguments: "",
      });

      const dynamic = isDynamicTool(event.toolCall.name);
      sendSSE(controller, encoder, {
        type: "tool-input-start",
        toolCallId: id,
        toolName: event.toolCall.name,
        ...(dynamic ? { dynamic: true } : {}),
      });
      return;
    }

    case "tool_call_delta": {
      const id = event.id;
      if (!id) return;

      const tc = state.toolCalls.get(id);
      if (!tc) return;

      tc.arguments += event.arguments;

      sendSSE(controller, encoder, {
        type: "tool-input-delta",
        toolCallId: id,
        inputTextDelta: event.arguments,
      });
      return;
    }

    case "tool_call_complete": {
      const id = event.toolCall?.id;
      if (!id) return;

      state.toolCalls.set(id, {
        id,
        name: event.toolCall.name,
        arguments: event.toolCall.arguments,
      });

      const dynamic = isDynamicTool(event.toolCall.name);
      const { args } = parseToolArgs(event.toolCall.arguments);

      sendSSE(controller, encoder, {
        type: "tool-input-available",
        toolCallId: id,
        toolName: event.toolCall.name,
        input: args,
        ...(dynamic ? { dynamic: true } : {}),
      });
      return;
    }

    case "finish":
      state.finishReason = event.finishReason;
      return;

    case "usage":
      if (event.usage) callbacks?.onUsage?.(event.usage);
      return;
  }
}

export function processStreamData(
  stream: ReadableStream,
  state: StreamState,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  textPartId: string | undefined,
  callbacks?: StreamCallbacks,
): Promise<void> {
  return withSpan("agent.runtime.processStreamData", async () => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let partial = "";
    let eventCount = 0;

    function processLine(line: string): void {
      try {
        const rawEvent = JSON.parse(line);
        const parseResult = AgentStreamEventSchema.safeParse(rawEvent);

        if (!parseResult.success) {
          log.warn("Invalid stream event received:", parseResult.error);
          return;
        }

        eventCount++;
        handleStreamEvent(parseResult.data, state, controller, encoder, textPartId, callbacks);
      } catch (e) {
        log.warn("Failed to parse stream line:", e);
      }
    }

    function processPartialLine(line: string): void {
      try {
        const rawEvent = JSON.parse(line);
        const parseResult = AgentStreamEventSchema.safeParse(rawEvent);
        if (!parseResult.success) return;

        eventCount++;
        handleStreamEvent(parseResult.data, state, controller, encoder, textPartId, callbacks);
      } catch {
        // Ignore trailing partial
      }
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      partial += decoder.decode(value, { stream: true });

      if (partial.length > MAX_STREAM_BUFFER_SIZE) {
        log.warn("Stream buffer exceeded max size, truncating");
        partial = partial.slice(-MAX_STREAM_BUFFER_SIZE / 2);
      }

      const segments = partial.split("\n");
      partial = segments.pop() ?? "";

      for (const line of segments) {
        if (!line.trim()) continue;
        processLine(line);
      }
    }

    if (partial.trim()) processPartialLine(partial);

    setActiveSpanAttributes({
      "stream.event_count": eventCount,
      "stream.tool_calls": state.toolCalls.size,
      "stream.text_length": state.accumulatedText.length,
    });
  });
}
