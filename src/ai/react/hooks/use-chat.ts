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
import type { Message } from "../../types/agent.ts";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";

/**
 * Tool call information for UI
 */
export interface ToolCallUI {
  /** Tool call ID */
  id: string;
  /** Tool name */
  toolName: string;
  /** Tool input (parsed JSON) */
  input?: unknown;
  /** Tool input as raw text (for streaming) */
  inputText?: string;
  /** Tool output/result */
  output?: unknown;
  /** Tool call status */
  status: "pending" | "streaming" | "executing" | "completed" | "error";
}

/**
 * Reasoning block for UI
 */
export interface ReasoningUI {
  /** Reasoning block ID */
  id: string;
  /** Accumulated reasoning text */
  text: string;
  /** Whether reasoning is complete */
  isComplete: boolean;
}

/**
 * Extended message with parts (v5 compatible)
 */
export interface MessageWithParts extends Message {
  /** Message parts for rich content */
  parts?: Array<
    | { type: "text"; text: string }
    | { type: "tool-call"; toolCallId: string; toolName: string; args: unknown }
    | { type: "tool-result"; toolCallId: string; result: unknown }
    | { type: "reasoning"; id: string; text: string }
  >;
}

export interface UseChatOptions {
  /** API endpoint for chat */
  api: string;

  /** Initial messages */
  initialMessages?: Message[];

  /** Additional data to send */
  body?: Record<string, unknown>;

  /** Custom headers */
  headers?: Record<string, string>;

  /** Credentials mode */
  credentials?: RequestCredentials;

  /** Callback when response received */
  onResponse?: (response: Response) => void;

  /** Callback when message finished */
  onFinish?: (message: MessageWithParts) => void;

  /** Callback when error occurs */
  onError?: (error: Error) => void;

  /** Callback when tool call starts */
  onToolCall?: (toolCall: ToolCallUI) => void;

  /** Callback when tool result received */
  onToolResult?: (toolCall: ToolCallUI) => void;
}

export interface UseChatResult {
  /** Message history */
  messages: Message[];

  /** Current input value */
  input: string;

  /** Loading state */
  isLoading: boolean;

  /** Error state */
  error: Error | null;

  /** Set input value */
  setInput: (input: string) => void;

  /** Add a message and get response */
  append: (message: Omit<Message, "id" | "timestamp">) => Promise<void>;

  /** Retry last message */
  reload: () => Promise<void>;

  /** Stop generation */
  stop: () => void;

  /** Manually set messages */
  setMessages: (messages: Message[]) => void;

  /** Additional data from server */
  data?: unknown;

  /** Handle input change */
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;

  /** Handle form submit */
  handleSubmit: (e: React.FormEvent) => Promise<void>;
}

/**
 * useChat hook for managing chat state
 */
export function useChat(options: UseChatOptions): UseChatResult {
  const [messages, setMessages] = useState<Message[]>(
    options.initialMessages || [],
  );
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<unknown>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Append a message and get AI response
   */
  const append = useCallback(
    async (message: Omit<Message, "id" | "timestamp">) => {
      const userMessage: Message = {
        ...message,
        id: `msg_${Date.now()}`,
        timestamp: Date.now(),
      };

      // Add user message
      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);
      setError(null);

      // Create abort controller
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        // Call API
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

        if (options.onResponse) {
          options.onResponse(response);
        }

        // Handle streaming response
        if (response.body) {
          const streamingMessageId = `msg_${Date.now()}`;
          let hasAddedStreamingMessage = false;

          await handleStreamingResponse(response.body, {
            onMessage: (assistantMessage) => {
              setMessages((prev) => {
                if (hasAddedStreamingMessage) {
                  return prev.map((m) => m.id === streamingMessageId ? assistantMessage : m);
                }
                return [...prev, assistantMessage];
              });
              options.onFinish?.(assistantMessage);
            },
            onData: (partialData) => setData(partialData),
            onUpdate: (partialContent, messageId) => {
              const id = messageId || streamingMessageId;
              if (!hasAddedStreamingMessage) {
                hasAddedStreamingMessage = true;
                setMessages((prev) => [...prev, {
                  id,
                  role: "assistant" as const,
                  content: partialContent,
                  timestamp: Date.now(),
                }]);
              } else {
                setMessages((prev) => prev.map((m) =>
                  m.id === id ? { ...m, content: partialContent } : m
                ));
              }
            },
            onToolCall: options.onToolCall,
            onToolResult: options.onToolResult,
          });
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          // Request was aborted, ignore
          return;
        }

        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);

        if (options.onError) {
          options.onError(error);
        }
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

    // Remove last assistant message and re-send user message
    const lastUserMessageIndex = messages.findLastIndex((m) => m.role === "user");

    if (lastUserMessageIndex === -1) return;

    const messagesToKeep = messages.slice(0, lastUserMessageIndex);
    const lastUserMessage = messages[lastUserMessageIndex];

    // Early return already handled undefined case above
    if (!lastUserMessage) return;

    setMessages(messagesToKeep);

    await append({
      role: lastUserMessage.role,
      content: lastUserMessage.content,
    });
  }, [messages, append]);

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

      const messageContent = input;
      setInput("");

      await append({
        role: "user",
        content: messageContent,
      });
    },
    [input, isLoading, append],
  );

  return {
    messages,
    input,
    isLoading,
    error,
    setInput,
    append,
    reload,
    stop,
    setMessages,
    data,
    handleInputChange,
    handleSubmit,
  };
}

/**
 * Streaming response callbacks
 */
interface StreamingCallbacks {
  onMessage: (message: MessageWithParts) => void;
  onData: (data: unknown) => void;
  onUpdate?: (partialContent: string, messageId: string) => void;
  onToolCall?: (toolCall: ToolCallUI) => void;
  onToolResult?: (toolCall: ToolCallUI) => void;
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
  const { onMessage, onData, onUpdate, onToolCall, onToolResult } = callbacks;
  const reader = body.getReader();
  const decoder = new TextDecoder();

  // Track text blocks by ID (v5 uses IDs to group text-start/delta/end)
  const textBlocks = new Map<string, string>();
  let currentTextId = "";
  let messageId = "";

  // Track tool calls by ID
  const toolCalls = new Map<string, ToolCallUI>();

  // Track reasoning blocks by ID
  const reasoningBlocks = new Map<string, ReasoningUI>();

  // Message parts for v5 structured messages
  const messageParts: MessageWithParts["parts"] = [];

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

        // Legacy [DONE] marker (v4 compatibility)
        if (data === "[DONE]") {
          const accumulatedText = getAccumulatedText(textBlocks);
          if (accumulatedText) {
            onMessage(createAssistantMessage(messageId, accumulatedText, messageParts));
          }
          continue;
        }

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
              textBlocks.set(currentTextId, "");
              break;

            // v5: Text delta (also handles v4 format)
            case "text-delta": {
              const textId = parsed.id || currentTextId || "default";
              const delta = parsed.delta || parsed.textDelta || "";

              // Initialize text block if needed
              if (!textBlocks.has(textId)) {
                textBlocks.set(textId, "");
                currentTextId = textId;
              }

              // Append delta to text block
              textBlocks.set(textId, (textBlocks.get(textId) || "") + delta);

              // Update UI with accumulated text
              if (onUpdate) {
                onUpdate(getAccumulatedText(textBlocks), messageId);
              }
              break;
            }

            // v5: Text block end
            case "text-end": {
              // Add text part to message parts
              const textId = parsed.id || currentTextId;
              const text = textBlocks.get(textId) || "";
              if (text) {
                messageParts.push({ type: "text", text });
              }
              break;
            }

            // v5: Tool input start
            case "tool-input-start": {
              const toolCallId = parsed.toolCallId || generateClientId("tool");
              const toolCall: ToolCallUI = {
                id: toolCallId,
                toolName: parsed.toolName || "unknown",
                inputText: "",
                status: "pending",
              };
              toolCalls.set(toolCallId, toolCall);
              onToolCall?.(toolCall);
              break;
            }

            // v5: Tool input delta (streaming tool arguments)
            case "tool-input-delta": {
              const toolCallId = parsed.toolCallId;
              const toolCall = toolCalls.get(toolCallId);
              if (toolCall) {
                toolCall.inputText = (toolCall.inputText || "") + (parsed.inputTextDelta || parsed.delta || "");
                toolCall.status = "streaming";
                onToolCall?.(toolCall);
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
                toolCall.status = "executing";
                onToolCall?.(toolCall);

                // Add tool-call part
                messageParts.push({
                  type: "tool-call",
                  toolCallId,
                  toolName: toolCall.toolName,
                  args: toolCall.input,
                });
              }
              break;
            }

            // v5: Tool output available (result)
            case "tool-output-available": {
              const toolCallId = parsed.toolCallId;
              const toolCall = toolCalls.get(toolCallId);
              if (toolCall) {
                toolCall.output = parsed.output;
                toolCall.status = "completed";
                onToolResult?.(toolCall);

                // Add tool-result part
                messageParts.push({
                  type: "tool-result",
                  toolCallId,
                  result: toolCall.output,
                });
              }
              break;
            }

            // Legacy tool-result event (alternative format)
            case "tool-result": {
              const toolCallId = parsed.toolCallId || parsed.id;
              const toolCall = toolCalls.get(toolCallId);
              if (toolCall) {
                toolCall.output = parsed.result || parsed.output;
                toolCall.status = "completed";
                onToolResult?.(toolCall);

                messageParts.push({
                  type: "tool-result",
                  toolCallId,
                  result: toolCall.output,
                });
              }
              break;
            }

            // v5: Reasoning start
            case "reasoning-start": {
              const reasoningId = parsed.id || generateClientId("reasoning");
              const reasoning: ReasoningUI = {
                id: reasoningId,
                text: "",
                isComplete: false,
              };
              reasoningBlocks.set(reasoningId, reasoning);
              break;
            }

            // v5: Reasoning delta
            case "reasoning-delta": {
              const reasoningId = parsed.id;
              const reasoning = reasoningBlocks.get(reasoningId);
              if (reasoning) {
                reasoning.text += parsed.delta || "";
              }
              break;
            }

            // v5: Reasoning end
            case "reasoning-end": {
              const reasoningId = parsed.id;
              const reasoning = reasoningBlocks.get(reasoningId);
              if (reasoning) {
                reasoning.isComplete = true;
                // Add reasoning part to message
                messageParts.push({
                  type: "reasoning",
                  id: reasoningId,
                  text: reasoning.text,
                });
              }
              break;
            }

            // v5: Stream finish
            case "finish": {
              const accumulatedText = getAccumulatedText(textBlocks);
              if (accumulatedText || messageParts.length > 0) {
                onMessage(createAssistantMessage(messageId, accumulatedText, messageParts));
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
 * Get accumulated text from all text blocks
 */
function getAccumulatedText(textBlocks: Map<string, string>): string {
  return Array.from(textBlocks.values()).join("");
}

/**
 * Create assistant message with optional parts
 */
function createAssistantMessage(
  messageId: string,
  content: string,
  parts?: MessageWithParts["parts"],
): MessageWithParts {
  const message: MessageWithParts = {
    id: messageId || generateClientId("msg"),
    role: "assistant",
    content,
    timestamp: Date.now(),
  };

  // Add parts if there are any (for v5 structured content)
  if (parts && parts.length > 0) {
    message.parts = parts;
  }

  return message;
}

/**
 * Generate client-side ID (fallback when server doesn't provide one)
 */
function generateClientId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
