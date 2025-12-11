
import { useCallback, useRef, useState } from "react";
import type { Message } from "../../types/agent.ts";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";

export interface UseChatOptions {
  api: string;

  initialMessages?: Message[];

  body?: Record<string, unknown>;

  headers?: Record<string, string>;

  credentials?: RequestCredentials;

  onResponse?: (response: Response) => void;

  onFinish?: (message: Message) => void;

  onError?: (error: Error) => void;
}

export interface UseChatResult {
  messages: Message[];

  input: string;

  isLoading: boolean;

  error: Error | null;

  setInput: (input: string) => void;

  append: (message: Omit<Message, "id" | "timestamp">) => Promise<void>;

  reload: () => Promise<void>;

  stop: () => void;

  setMessages: (messages: Message[]) => void;

  data?: unknown;

  handleInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;

  handleSubmit: (e: React.FormEvent) => Promise<void>;
}

export function useChat(options: UseChatOptions): UseChatResult {
  const [messages, setMessages] = useState<Message[]>(
    options.initialMessages || [],
  );
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<unknown>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const append = useCallback(
    async (message: Omit<Message, "id" | "timestamp">) => {
      const userMessage: Message = {
        ...message,
        id: `msg_${Date.now()}`,
        timestamp: Date.now(),
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

        if (options.onResponse) {
          options.onResponse(response);
        }

        if (response.body) {
          const streamingMessageId = `msg_${Date.now()}`;
          let hasAddedStreamingMessage = false;

          await handleStreamingResponse(
            response.body,
            (assistantMessage) => {
              setMessages((prev) => {
                if (hasAddedStreamingMessage) {
                  return prev.map((m) => m.id === streamingMessageId ? assistantMessage : m);
                }
                return [...prev, assistantMessage];
              });

              if (options.onFinish) {
                options.onFinish(assistantMessage);
              }
            },
            (partialData) => {
              setData(partialData);
            },
            (partialContent, messageId) => {
              if (!hasAddedStreamingMessage) {
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

  const reload = useCallback(async () => {
    if (messages.length === 0) return;

    const lastUserMessageIndex = messages.findLastIndex((m) => m.role === "user");

    if (lastUserMessageIndex === -1) return;

    const messagesToKeep = messages.slice(0, lastUserMessageIndex);
    const lastUserMessage = messages[lastUserMessageIndex];

    if (!lastUserMessage) return;

    setMessages(messagesToKeep);

    await append({
      role: lastUserMessage.role,
      content: lastUserMessage.content,
    });
  }, [messages, append]);

  const stop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setInput(e.target.value);
    },
    [],
  );

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
            messageId = parsed.messageId || `msg_${Date.now()}`;
            accumulatedText = "";
          } else if (parsed.type === "text-delta") {
            accumulatedText += parsed.textDelta || "";
            if (onUpdate) {
              onUpdate(accumulatedText, messageId);
            }
          } else if (parsed.type === "finish") {
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
        }
      }
    }
  }
}
