/**
 * Streaming Response Handler
 *
 * Handles streaming responses from the server using AI SDK v5 UI Message Stream Protocol.
 *
 * v5 Event Types:
 * - start: Stream beginning
 * - start-step / finish-step: Step boundaries (for multi-step/tools)
 * - text-start / text-delta / text-end: Text block lifecycle
 * - tool-input-start / tool-input-delta / tool-input-available: Tool input streaming
 * - tool-output-available: Tool result
 * - reasoning-start / reasoning-delta / reasoning-end: Reasoning block lifecycle
 * - finish: Stream end
 * - data: Custom data
 *
 * @module ai/react/hooks/use-chat/streaming/handler
 */

import type { ToolUIPart, UIMessagePart } from "../types.ts";
import { createAssistantMessage, generateClientId } from "../utils.ts";
import { buildCurrentParts } from "./parts.ts";
import type {
  StreamingCallbacks,
  StreamingReasoning,
  StreamingTextBlock,
  StreamingToolCall,
} from "./types.ts";

/**
 * Handle streaming response from server.
 * Supports AI SDK v5 UI Message Stream Protocol.
 */
export async function handleStreamingResponse(
  body: ReadableStream,
  callbacks: StreamingCallbacks,
): Promise<void> {
  const { onMessage, onData, onUpdate, onToolCall } = callbacks;
  const reader = body.getReader();
  const decoder = new TextDecoder();

  // Track text blocks by ID (v5 uses IDs to group text-start/delta/end)
  const textBlocks = new Map<string, StreamingTextBlock>();
  let currentTextId = "";
  let messageId = "";

  // Track tool calls by ID (with order for proper sequencing)
  const toolCalls = new Map<string, StreamingToolCall>();

  // Track reasoning blocks by ID
  const reasoningBlocks = new Map<string, StreamingReasoning>();

  // Message parts for v5 structured messages
  const messageParts: UIMessagePart[] = [];

  // Global order counter to track sequence of parts
  let partOrderCounter = 0;

  // Helper to get current parts
  const getCurrentParts = (): UIMessagePart[] => {
    return buildCurrentParts(textBlocks, reasoningBlocks, toolCalls);
  };

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n").filter((line) => line.trim());

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);

        try {
          const parsed = JSON.parse(data);

          switch (parsed.type) {
            // v5: Stream start
            case "start":
              messageId = parsed.messageId || generateClientId("msg");
              textBlocks.clear();
              toolCalls.clear();
              reasoningBlocks.clear();
              messageParts.length = 0;
              break;

            // v5: Step boundaries (for multi-step tool calls)
            case "start-step":
            case "finish-step":
              // Step markers - could track step ID if needed
              break;

            // v5: Text block start
            case "text-start":
              currentTextId = parsed.id || generateClientId("text");
              textBlocks.set(currentTextId, { text: "", state: "streaming", order: null });
              break;

            // v5: Text delta
            case "text-delta": {
              const textId = parsed.id || currentTextId || "default";
              const delta = parsed.textDelta || parsed.delta || "";

              let block = textBlocks.get(textId);
              if (!block) {
                block = { text: "", state: "streaming", order: null };
                textBlocks.set(textId, block);
                currentTextId = textId;
              }

              block.text += delta;

              // Assign order on first content
              if (block.order === null) {
                block.order = partOrderCounter++;
              }

              onUpdate?.(getCurrentParts(), messageId);
              break;
            }

            // v5: Text block end
            case "text-end": {
              const textId = parsed.id || currentTextId;
              const block = textBlocks.get(textId);
              if (block) {
                block.state = "done";
                if (block.text) {
                  messageParts.push({ type: "text", text: block.text, state: "done" });
                }
              }
              break;
            }

            // v5: Tool input start
            case "tool-input-start": {
              const toolCallId = parsed.toolCallId || generateClientId("tool");
              const toolCall: StreamingToolCall = {
                toolCallId,
                toolName: parsed.toolName || "unknown",
                inputText: "",
                state: "input-streaming",
                dynamic: parsed.dynamic === true,
                order: partOrderCounter++,
              };
              toolCalls.set(toolCallId, toolCall);
              onUpdate?.(getCurrentParts(), messageId);
              break;
            }

            // v5: Tool input delta
            case "tool-input-delta": {
              const toolCallId = parsed.toolCallId;
              const toolCall = toolCalls.get(toolCallId);
              if (toolCall) {
                toolCall.inputText += parsed.inputTextDelta || parsed.delta || "";
                onUpdate?.(getCurrentParts(), messageId);
              }
              break;
            }

            // v5: Tool input available
            case "tool-input-available": {
              const toolCallId = parsed.toolCallId;
              const toolCall = toolCalls.get(toolCallId);
              if (toolCall) {
                toolCall.input = parsed.input;
                toolCall.toolName = parsed.toolName || toolCall.toolName;
                toolCall.state = "input-available";
                if (parsed.dynamic === true) {
                  toolCall.dynamic = true;
                }

                onToolCall?.({
                  toolCall: {
                    toolCallId,
                    toolName: toolCall.toolName,
                    input: toolCall.input,
                    dynamic: toolCall.dynamic,
                  },
                });

                messageParts.push(
                  toolCall.dynamic
                    ? {
                      type: "dynamic-tool",
                      toolCallId,
                      toolName: toolCall.toolName,
                      state: "input-available" as const,
                      input: toolCall.input,
                    }
                    : {
                      type: `tool-${toolCall.toolName}` as const,
                      toolCallId,
                      toolName: toolCall.toolName,
                      state: "input-available" as const,
                      input: toolCall.input,
                    } as ToolUIPart,
                );

                onUpdate?.(getCurrentParts(), messageId);
              }
              break;
            }

            // v5: Tool output available
            case "tool-output-available": {
              const toolCallId = parsed.toolCallId;
              const toolCall = toolCalls.get(toolCallId);
              if (toolCall) {
                toolCall.output = parsed.output;
                toolCall.state = "output-available";

                messageParts.push({
                  type: "tool-result",
                  toolCallId,
                  toolName: toolCall.toolName,
                  result: toolCall.output,
                });

                onUpdate?.(getCurrentParts(), messageId);
              }
              break;
            }

            // v5: Tool input error
            case "tool-input-error": {
              const toolCallId = parsed.toolCallId;
              const toolCall = toolCalls.get(toolCallId);
              if (toolCall) {
                toolCall.state = "output-error";
                toolCall.error = parsed.errorText;
                if (parsed.dynamic === true) {
                  toolCall.dynamic = true;
                }
                onUpdate?.(getCurrentParts(), messageId);
              }
              break;
            }

            // v5: Tool output error
            case "tool-output-error": {
              const toolCallId = parsed.toolCallId;
              const toolCall = toolCalls.get(toolCallId);
              if (toolCall) {
                toolCall.state = "output-error";
                toolCall.error = parsed.errorText;
                if (parsed.dynamic === true) {
                  toolCall.dynamic = true;
                }
                onUpdate?.(getCurrentParts(), messageId);
              }
              break;
            }

            // v5: Reasoning start
            case "reasoning-start": {
              const reasoningId = parsed.id || generateClientId("reasoning");
              const reasoning: StreamingReasoning = {
                id: reasoningId,
                text: "",
                isComplete: false,
                order: partOrderCounter++,
              };
              reasoningBlocks.set(reasoningId, reasoning);
              onUpdate?.(getCurrentParts(), messageId);
              break;
            }

            // v5: Reasoning delta
            case "reasoning-delta": {
              const reasoningId = parsed.id;
              const reasoning = reasoningBlocks.get(reasoningId);
              if (reasoning) {
                reasoning.text += parsed.delta || "";
                onUpdate?.(getCurrentParts(), messageId);
              }
              break;
            }

            // v5: Reasoning end
            case "reasoning-end": {
              const reasoningId = parsed.id;
              const reasoning = reasoningBlocks.get(reasoningId);
              if (reasoning) {
                reasoning.isComplete = true;
                messageParts.push({
                  type: "reasoning",
                  text: reasoning.text,
                  state: "done",
                });
                onUpdate?.(getCurrentParts(), messageId);
              }
              break;
            }

            // v5: Stream finish
            case "finish": {
              const finalParts = getCurrentParts();
              if (finalParts.length > 0) {
                onMessage(createAssistantMessage(messageId, finalParts));
              }
              break;
            }

            // Custom data events
            case "data":
              onData(parsed.data || parsed.value);
              break;
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }
  }
}
