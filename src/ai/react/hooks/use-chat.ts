/**
 * useChat Hook - Layer 1 (Headless)
 *
 * Complete chat state management with zero UI.
 * Build any interface you want.
 *
 * NOTE: In production, this could leverage Vercel AI SDK's useChat
 * for battle-tested implementation. This is a simplified reference implementation.
 */

import { useCallback, useRef, useState } from "react";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";

/**
 * Text part - AI SDK v5 compatible
 */
export interface TextUIPart {
  type: "text";
  text: string;
  state?: "streaming" | "done";
}

/**
 * Reasoning part - AI SDK v5 compatible
 */
export interface ReasoningUIPart {
  type: "reasoning";
  text: string;
  state?: "streaming" | "done";
}

/**
 * Tool call state - AI SDK v5 compatible
 */
export type ToolState =
  | "input-streaming"
  | "input-available"
  | "output-streaming"
  | "output-available"
  | "output-error";

/**
 * Tool UI part - AI SDK v5 compatible
 * Uses `tool-${toolName}` type pattern for static tools (e.g., "tool-weather")
 * Generic type allows typed tool inputs/outputs
 */
export interface ToolUIPart<NAME extends string = string, INPUT = unknown, OUTPUT = unknown> {
  type: `tool-${NAME}`;
  toolCallId: string;
  toolName: NAME;
  state: ToolState;
  input?: INPUT;
  output?: OUTPUT;
  errorText?: string;
}

/**
 * Tool result part - AI SDK v5 compatible
 */
export interface ToolResultUIPart<RESULT = unknown> {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  result: RESULT;
  isError?: boolean;
}

/**
 * Dynamic tool UI part - AI SDK v5 compatible
 * Used for MCP tools, user-defined functions, and runtime-loaded tools
 * where input/output types are unknown at compile time
 */
export interface DynamicToolUIPart {
  type: "dynamic-tool";
  toolCallId: string;
  toolName: string;
  state: ToolState;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

/**
 * All possible UI message parts - AI SDK v5 compatible
 */
export type UIMessagePart =
  | TextUIPart
  | ReasoningUIPart
  | ToolUIPart
  | ToolResultUIPart
  | DynamicToolUIPart;

/**
 * UI Message - AI SDK v5 compatible
 * Uses parts array as primary content structure
 */
export interface UIMessage {
  id: string;
  role: "system" | "user" | "assistant";
  parts: UIMessagePart[];
  metadata?: Record<string, unknown>;
  /** Message creation timestamp (optional) */
  createdAt?: Date | string;
}

/**
 * Tool output for addToolOutput - AI SDK v5 compatible
 */
export interface ToolOutput {
  tool: string;
  toolCallId: string;
  output?: unknown;
  state?: "output-available" | "output-error";
  errorText?: string;
}

/**
 * Tool call argument for onToolCall callback - AI SDK v5 compatible
 */
export interface OnToolCallArg {
  toolCall: {
    toolCallId: string;
    toolName: string;
    input: unknown;
    /** Whether this is a dynamic tool (MCP, user-defined, etc.) */
    dynamic?: boolean;
  };
}

export interface UseChatOptions {
  /** API endpoint for chat */
  api: string;

  /** Initial messages */
  initialMessages?: UIMessage[];

  /** Additional data to send */
  body?: Record<string, unknown>;

  /** Custom headers */
  headers?: Record<string, string>;

  /** Credentials mode */
  credentials?: RequestCredentials;

  /** Callback when response received */
  onResponse?: (response: Response) => void;

  /** Callback when message finished */
  onFinish?: (message: UIMessage) => void;

  /** Callback when error occurs */
  onError?: (error: Error) => void;

  /**
   * Callback when tool call is available - AI SDK v5 compatible
   * Use addToolOutput to provide results (don't await inside callback)
   */
  onToolCall?: (arg: OnToolCallArg) => void | Promise<void>;
}

export interface UseChatResult {
  /** Message history - AI SDK v5 UIMessage format */
  messages: UIMessage[];

  /** Current input value */
  input: string;

  /** Loading state */
  isLoading: boolean;

  /** Error state */
  error: Error | null;

  /** Set input value */
  setInput: (input: string) => void;

  /** Send a message - AI SDK v5 compatible */
  sendMessage: (message: { text: string }) => Promise<void>;

  /** Retry last message */
  reload: () => Promise<void>;

  /** Stop generation */
  stop: () => void;

  /** Manually set messages */
  setMessages: (messages: UIMessage[]) => void;

  /**
   * Add tool output - AI SDK v5 compatible
   * Call this from onToolCall to provide tool results
   */
  addToolOutput: (output: ToolOutput) => void;

  /** Additional data from server */
  data?: unknown;

  /** Handle input change */
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;

  /** Handle form submit */
  handleSubmit: (e: React.FormEvent) => Promise<void>;
}

/**
 * useChat hook for managing chat state - AI SDK v5 compatible
 */
export function useChat(options: UseChatOptions): UseChatResult {
  const [messages, setMessages] = useState<UIMessage[]>(
    options.initialMessages || [],
  );
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<unknown>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Track pending tool outputs for addToolOutput
  const pendingToolOutputsRef = useRef<Map<string, ToolOutput>>(new Map());

  /**
   * Add tool output - AI SDK v5 compatible
   * Call from onToolCall to provide results (don't await)
   */
  const addToolOutput = useCallback((output: ToolOutput) => {
    pendingToolOutputsRef.current.set(output.toolCallId, output);

    // Update the tool part state in messages
    // Match tool-${toolName} pattern (AI SDK v5) or dynamic-tool
    setMessages((prev) =>
      prev.map((msg) => ({
        ...msg,
        parts: msg.parts.map((part) => {
          const isToolPart = part.type.startsWith("tool-") || part.type === "dynamic-tool";
          if (isToolPart && "toolCallId" in part && part.toolCallId === output.toolCallId) {
            return {
              ...part,
              state: output.state || "output-available",
              output: output.output,
              errorText: output.errorText,
            };
          }
          return part;
        }),
      }))
    );
  }, []);

  /**
   * Send a message - AI SDK v5 compatible
   */
  const sendMessage = useCallback(
    async (message: { text: string }) => {
      const userMessage: UIMessage = {
        id: generateClientId("msg"),
        role: "user",
        parts: [{ type: "text", text: message.text }],
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);
      setError(null);

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        const response = await fetch(options.api, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...options.headers,
          },
          credentials: options.credentials,
          body: JSON.stringify({
            messages: [...messages, userMessage],
            ...options.body,
          }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw toError(createError({
            type: "agent",
            message: `API error: ${response.status}`,
          }));
        }

        options.onResponse?.(response);

        if (response.body) {
          const streamingMessageId = generateClientId("msg");
          let hasAddedStreamingMessage = false;
          // Track the actual message ID used (server ID takes precedence once received)
          let currentMessageId = streamingMessageId;

          await handleStreamingResponse(response.body, {
            onMessage: (assistantMessage) => {
              setMessages((prev) => {
                if (hasAddedStreamingMessage) {
                  // Use currentMessageId which may have been updated to server's ID
                  return prev.map((m) => m.id === currentMessageId ? assistantMessage : m);
                }
                return [...prev, assistantMessage];
              });
              options.onFinish?.(assistantMessage);
            },
            onData: setData,
            onUpdate: (parts, messageId) => {
              const id = messageId || streamingMessageId;
              // Update currentMessageId when server provides one
              if (messageId && messageId !== currentMessageId) {
                const oldId = currentMessageId;
                currentMessageId = messageId;
                // Update existing message to use new ID if already added
                if (hasAddedStreamingMessage) {
                  setMessages((prev) => prev.map((m) => m.id === oldId ? { ...m, id, parts } : m));
                  return;
                }
              }
              if (!hasAddedStreamingMessage) {
                hasAddedStreamingMessage = true;
                setMessages((prev) => [...prev, {
                  id,
                  role: "assistant",
                  parts,
                }]);
              } else {
                setMessages((prev) =>
                  prev.map((m) => m.id === currentMessageId ? { ...m, parts } : m)
                );
              }
            },
            onToolCall: options.onToolCall,
          });
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;

        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        options.onError?.(error);
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [messages, options],
  );

  /**
   * Reload last message
   */
  const reload = useCallback(async () => {
    if (messages.length === 0) return;

    const lastUserIndex = messages.findLastIndex((m) => m.role === "user");
    if (lastUserIndex === -1) return;

    const lastUserMessage = messages[lastUserIndex];
    if (!lastUserMessage) return;

    // Get text from parts
    const textPart = lastUserMessage.parts.find((p) => p.type === "text") as TextUIPart | undefined;
    if (!textPart) return;

    setMessages(messages.slice(0, lastUserIndex));
    await sendMessage({ text: textPart.text });
  }, [messages, sendMessage]);

  /**
   * Stop generation
   */
  const stop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
  }, []);

  /**
   * Handle input change
   */
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setInput(e.target.value);
    },
    [],
  );

  /**
   * Handle form submit
   */
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim() || isLoading) return;

      const text = input;
      setInput("");
      await sendMessage({ text });
    },
    [input, isLoading, sendMessage],
  );

  return {
    messages,
    input,
    isLoading,
    error,
    setInput,
    sendMessage,
    reload,
    stop,
    setMessages,
    addToolOutput,
    data,
    handleInputChange,
    handleSubmit,
  };
}

/**
 * Streaming response callbacks - AI SDK v5 compatible
 */
interface StreamingCallbacks {
  onMessage: (message: UIMessage) => void;
  onData: (data: unknown) => void;
  onUpdate?: (parts: UIMessagePart[], messageId: string) => void;
  onToolCall?: (arg: OnToolCallArg) => void;
}

/**
 * Internal tool tracking during streaming
 */
interface StreamingToolCall {
  toolCallId: string;
  toolName: string;
  inputText: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  state: ToolState;
  /** Whether this is a dynamic tool (MCP, user-defined, etc.) */
  dynamic?: boolean;
}

/**
 * Internal reasoning tracking during streaming
 */
interface StreamingReasoning {
  id: string;
  text: string;
  isComplete: boolean;
}

/**
 * Handle streaming response from server
 * Supports AI SDK v5 UI Message Stream Protocol
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
 */
async function handleStreamingResponse(
  body: ReadableStream,
  callbacks: StreamingCallbacks,
): Promise<void> {
  const { onMessage, onData, onUpdate, onToolCall } = callbacks;
  const reader = body.getReader();
  const decoder = new TextDecoder();

  // Track text blocks by ID (v5 uses IDs to group text-start/delta/end)
  const textBlocks = new Map<string, { text: string; state: "streaming" | "done" }>();
  let currentTextId = "";
  let messageId = "";

  // Track tool calls by ID
  const toolCalls = new Map<string, StreamingToolCall>();

  // Track reasoning blocks by ID
  const reasoningBlocks = new Map<string, StreamingReasoning>();

  // Message parts for v5 structured messages
  const messageParts: UIMessagePart[] = [];

  // Helper to build current parts for onUpdate
  const buildCurrentParts = (): UIMessagePart[] => {
    const parts: UIMessagePart[] = [];

    // Add text parts
    for (const [, block] of textBlocks) {
      if (block.text) {
        parts.push({ type: "text", text: block.text, state: block.state });
      }
    }

    // Add reasoning parts
    for (const [, reasoning] of reasoningBlocks) {
      parts.push({
        type: "reasoning",
        text: reasoning.text,
        state: reasoning.isComplete ? "done" : "streaming",
      });
    }

    // Add tool parts - use "dynamic-tool" type for dynamic tools
    for (const [, tool] of toolCalls) {
      if (tool.dynamic) {
        // Dynamic tools use "dynamic-tool" part type (AI SDK v5)
        parts.push({
          type: "dynamic-tool",
          toolCallId: tool.toolCallId,
          toolName: tool.toolName,
          state: tool.state,
          input: tool.input,
          output: tool.output,
          errorText: tool.error,
        });
      } else {
        // Static tools use "tool-${toolName}" part type (AI SDK v5)
        parts.push({
          type: `tool-${tool.toolName}` as const,
          toolCallId: tool.toolCallId,
          toolName: tool.toolName,
          state: tool.state,
          input: tool.input,
          output: tool.output,
          errorText: tool.error,
        } as ToolUIPart);
      }
    }

    return parts;
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
              // Step started - could track step ID if needed
              break;
            case "finish-step":
              // Step finished - finalize any pending tool calls for this step
              break;

            // v5: Text block start
            case "text-start":
              currentTextId = parsed.id || generateClientId("text");
              textBlocks.set(currentTextId, { text: "", state: "streaming" });
              break;

            // v5: Text delta
            case "text-delta": {
              const textId = parsed.id || currentTextId || "default";
              const delta = parsed.textDelta || parsed.delta || "";

              // Initialize text block if needed
              if (!textBlocks.has(textId)) {
                textBlocks.set(textId, { text: "", state: "streaming" });
                currentTextId = textId;
              }

              // Append delta to text block
              const block = textBlocks.get(textId)!;
              block.text += delta;

              // Update UI with current parts
              onUpdate?.(buildCurrentParts(), messageId);
              break;
            }

            // v5: Text block end
            case "text-end": {
              const textId = parsed.id || currentTextId;
              const block = textBlocks.get(textId);
              if (block) {
                block.state = "done";
                // Add text part to final message parts
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
              };
              toolCalls.set(toolCallId, toolCall);
              onUpdate?.(buildCurrentParts(), messageId);
              break;
            }

            // v5: Tool input delta (streaming tool arguments)
            case "tool-input-delta": {
              const toolCallId = parsed.toolCallId;
              const toolCall = toolCalls.get(toolCallId);
              if (toolCall) {
                toolCall.inputText += parsed.inputTextDelta || parsed.delta || "";
                onUpdate?.(buildCurrentParts(), messageId);
              }
              break;
            }

            // v5: Tool input available (complete input ready)
            case "tool-input-available": {
              const toolCallId = parsed.toolCallId;
              const toolCall = toolCalls.get(toolCallId);
              if (toolCall) {
                toolCall.input = parsed.input;
                toolCall.toolName = parsed.toolName || toolCall.toolName;
                toolCall.state = "input-available";
                // Update dynamic flag if provided (may not have been set during start)
                if (parsed.dynamic === true) {
                  toolCall.dynamic = true;
                }

                // Notify via onToolCall - AI SDK v5 pattern
                onToolCall?.({
                  toolCall: {
                    toolCallId,
                    toolName: toolCall.toolName,
                    input: toolCall.input,
                    dynamic: toolCall.dynamic,
                  },
                });

                // Add tool-${toolName} or dynamic-tool part based on tool type (AI SDK v5)
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

                onUpdate?.(buildCurrentParts(), messageId);
              }
              break;
            }

            // v5: Tool output available (result)
            case "tool-output-available": {
              const toolCallId = parsed.toolCallId;
              const toolCall = toolCalls.get(toolCallId);
              if (toolCall) {
                toolCall.output = parsed.output;
                toolCall.state = "output-available";

                // Add tool-result part
                messageParts.push({
                  type: "tool-result",
                  toolCallId,
                  toolName: toolCall.toolName,
                  result: toolCall.output,
                });

                onUpdate?.(buildCurrentParts(), messageId);
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
                onUpdate?.(buildCurrentParts(), messageId);
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
                onUpdate?.(buildCurrentParts(), messageId);
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
              };
              reasoningBlocks.set(reasoningId, reasoning);
              onUpdate?.(buildCurrentParts(), messageId);
              break;
            }

            // v5: Reasoning delta
            case "reasoning-delta": {
              const reasoningId = parsed.id;
              const reasoning = reasoningBlocks.get(reasoningId);
              if (reasoning) {
                reasoning.text += parsed.delta || "";
                onUpdate?.(buildCurrentParts(), messageId);
              }
              break;
            }

            // v5: Reasoning end
            case "reasoning-end": {
              const reasoningId = parsed.id;
              const reasoning = reasoningBlocks.get(reasoningId);
              if (reasoning) {
                reasoning.isComplete = true;
                // Add reasoning part to final message
                messageParts.push({
                  type: "reasoning",
                  text: reasoning.text,
                  state: "done",
                });
                onUpdate?.(buildCurrentParts(), messageId);
              }
              break;
            }

            // v5: Stream finish
            case "finish": {
              if (messageParts.length > 0 || textBlocks.size > 0) {
                onMessage(createAssistantMessage(messageId, messageParts));
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

/**
 * Create assistant message from parts - AI SDK v5 compatible
 */
function createAssistantMessage(
  messageId: string,
  parts: UIMessagePart[],
): UIMessage {
  return {
    id: messageId || generateClientId("msg"),
    role: "assistant",
    parts,
  };
}

/**
 * Generate client-side ID (fallback when server doesn't provide one)
 */
function generateClientId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
