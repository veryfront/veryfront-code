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
  onFinish?: (message: Message) => void;

  /** Callback when error occurs */
  onError?: (error: Error) => void;
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
          // Create a placeholder message ID for streaming
          const streamingMessageId = `msg_${Date.now()}`;
          let hasAddedStreamingMessage = false;

          await handleStreamingResponse(
            response.body,
            // onMessage - when streaming is complete
            (assistantMessage) => {
              // Replace the streaming message with the final message
              setMessages((prev) => {
                // If we had a streaming message, replace it
                if (hasAddedStreamingMessage) {
                  return prev.map((m) => m.id === streamingMessageId ? assistantMessage : m);
                }
                // Otherwise just add it
                return [...prev, assistantMessage];
              });

              if (options.onFinish) {
                options.onFinish(assistantMessage);
              }
            },
            // onData - for data events
            (partialData) => {
              setData(partialData);
            },
            // onUpdate - for real-time streaming updates
            (partialContent, messageId) => {
              if (!hasAddedStreamingMessage) {
                // Add the streaming message for the first time
                hasAddedStreamingMessage = true;
                setMessages((prev) => [
                  ...prev,
                  {
                    id: messageId || streamingMessageId,
                    role: "assistant" as const,
                    content: partialContent,
                    timestamp: Date.now(),
                  },
                ]);
              } else {
                // Update the streaming message content
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === (messageId || streamingMessageId)
                      ? { ...m, content: partialContent }
                      : m
                  )
                );
              }
            },
          );
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
 * Handle streaming response from server
 * Supports AI SDK v5 UI Message Stream Protocol
 *
 * v5 Event Types:
 * - start: Stream beginning
 * - start-step / finish-step: Step boundaries (for multi-step/tools)
 * - text-start / text-delta / text-end: Text block lifecycle
 * - finish: Stream end
 * - data: Custom data
 */
async function handleStreamingResponse(
  body: ReadableStream,
  onMessage: (message: Message) => void,
  onData: (data: unknown) => void,
  onUpdate?: (partialContent: string, messageId: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();

  // Track text blocks by ID (v5 uses IDs to group text-start/delta/end)
  const textBlocks = new Map<string, string>();
  let currentTextId = "";
  let messageId = "";

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
            onMessage(createAssistantMessage(messageId, accumulatedText));
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
              break;

            // v5: Step boundaries (for multi-step tool calls)
            case "start-step":
            case "finish-step":
              // Currently no-op, but could track step state
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
            case "text-end":
              // Text block complete, no action needed
              break;

            // v5: Stream finish
            case "finish": {
              const accumulatedText = getAccumulatedText(textBlocks);
              if (accumulatedText) {
                onMessage(createAssistantMessage(messageId, accumulatedText));
              }
              break;
            }

            // Custom data events
            case "data":
              onData(parsed.data || parsed.value);
              break;

            // Tool events (future support)
            case "tool-input-start":
            case "tool-input-delta":
            case "tool-result":
              // TODO: Implement tool call UI updates
              break;

            // Reasoning events (future support)
            case "reasoning-start":
            case "reasoning-delta":
            case "reasoning-end":
              // TODO: Implement reasoning UI updates
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
 * Create assistant message
 */
function createAssistantMessage(messageId: string, content: string): Message {
  return {
    id: messageId || generateClientId("msg"),
    role: "assistant",
    content,
    timestamp: Date.now(),
  };
}

/**
 * Generate client-side ID (fallback when server doesn't provide one)
 */
function generateClientId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
