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
 * Uses Vercel AI SDK data stream format
 */
async function handleStreamingResponse(
  body: ReadableStream,
  onMessage: (message: Message) => void,
  onData: (data: unknown) => void,
  onUpdate?: (partialContent: string, messageId: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let accumulatedText = "";
  let messageId = `msg_${Date.now()}`;

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

        if (data === "[DONE]") {
          // Stream finished - create the assistant message
          if (accumulatedText) {
            const assistantMessage: Message = {
              id: messageId,
              role: "assistant",
              content: accumulatedText,
              timestamp: Date.now(),
            };
            onMessage(assistantMessage);
          }
          continue;
        }

        try {
          const parsed = JSON.parse(data);

          if (parsed.type === "data") {
            onData(parsed.data);
          } else if (parsed.type === "start") {
            // New message starting
            messageId = parsed.messageId || `msg_${Date.now()}`;
            accumulatedText = "";
          } else if (parsed.type === "text-delta") {
            // Text chunk - accumulate and update UI
            accumulatedText += parsed.textDelta || "";
            // Call onUpdate to show text progressively
            if (onUpdate) {
              onUpdate(accumulatedText, messageId);
            }
          } else if (parsed.type === "finish") {
            // Stream completed
            if (accumulatedText) {
              const assistantMessage: Message = {
                id: messageId,
                role: "assistant",
                content: accumulatedText,
                timestamp: Date.now(),
              };
              onMessage(assistantMessage);
            }
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }
  }
}
