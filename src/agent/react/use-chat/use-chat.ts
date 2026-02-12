/**
 * useChat Hook - Layer 1 (Headless)
 *
 * Complete chat state management with zero UI.
 * Wire-compatible with the AI SDK Data Stream Protocol.
 */

import { useCallback, useRef, useState } from "react";
import { createError, ensureError, toError } from "#veryfront/errors/veryfront-error.ts";

import { handleStreamingResponse } from "./streaming/index.ts";
import type { ToolOutput, UIMessage, UseChatOptions, UseChatResult } from "./types.ts";
import { generateClientId } from "./utils.ts";

/**
 * useChat hook for managing chat state - AI SDK v5 compatible
 */
export function useChat(options: UseChatOptions): UseChatResult {
  const [messages, setMessages] = useState<UIMessage[]>(options.initialMessages ?? []);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<unknown>(null);
  const [model, setModel] = useState<string | undefined>(options.model);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Track pending tool outputs for addToolOutput
  const pendingToolOutputsRef = useRef<Map<string, ToolOutput>>(new Map());

  /**
   * Add tool output - AI SDK v5 compatible
   * Call from onToolCall to provide results (don't await)
   */
  const addToolOutput = useCallback((output: ToolOutput) => {
    pendingToolOutputsRef.current.set(output.toolCallId, output);

    setMessages((prev) =>
      prev.map((msg) => ({
        ...msg,
        parts: msg.parts.map((part) => {
          const isToolPart = part.type.startsWith("tool-") || part.type === "dynamic-tool";
          if (!isToolPart || !("toolCallId" in part) || part.toolCallId !== output.toolCallId) {
            return part;
          }

          return {
            ...part,
            state: output.state ?? "output-available",
            output: output.output,
            errorText: output.errorText,
          };
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
            ...(model ? { model } : {}),
            ...options.body,
          }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw toError(
            createError({
              type: "agent",
              message: `API error: ${response.status}`,
            }),
          );
        }

        options.onResponse?.(response);

        if (!response.body) return;

        const streamingMessageId = generateClientId("msg");
        let hasAddedStreamingMessage = false;
        let currentMessageId = streamingMessageId;

        await handleStreamingResponse(response.body, {
          onMessage: (assistantMessage) => {
            setMessages((prev) => {
              if (!hasAddedStreamingMessage) return [...prev, assistantMessage];
              return prev.map((m) => (m.id === currentMessageId ? assistantMessage : m));
            });
            options.onFinish?.(assistantMessage);
          },
          onData: setData,
          onUpdate: (parts, messageId) => {
            const id = messageId ?? streamingMessageId;

            if (messageId && messageId !== currentMessageId) {
              const oldId = currentMessageId;
              currentMessageId = messageId;

              if (hasAddedStreamingMessage) {
                setMessages((prev) => prev.map((m) => (m.id === oldId ? { ...m, id, parts } : m)));
                return;
              }
            }

            if (!hasAddedStreamingMessage) {
              hasAddedStreamingMessage = true;
              setMessages((prev) => [...prev, { id, role: "assistant", parts }]);
              return;
            }

            setMessages((prev) =>
              prev.map((m) => (m.id === currentMessageId ? { ...m, parts } : m))
            );
          },
          onToolCall: options.onToolCall,
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;

        const nextError = ensureError(error);
        setError(nextError);
        options.onError?.(nextError);
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [messages, model, options],
  );

  /**
   * Reload last message
   */
  const reload = useCallback(async () => {
    if (messages.length === 0) return;

    const lastUserIndex = messages.findLastIndex((m) => m.role === "user");
    if (lastUserIndex === -1) return;

    const lastUserMessage = messages[lastUserIndex];
    const textPart = lastUserMessage?.parts.find((p) => p.type === "text");
    if (!textPart || !("text" in textPart)) return;

    setMessages(messages.slice(0, lastUserIndex));
    await sendMessage({ text: textPart.text });
  }, [messages, sendMessage]);

  /**
   * Stop generation
   */
  const stop = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
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
      if (isLoading) return;

      const text = input.trim();
      if (!text) return;

      setInput("");
      await sendMessage({ text: input });
    },
    [input, isLoading, sendMessage],
  );

  return {
    messages,
    input,
    isLoading,
    error,
    model,
    setInput,
    setModel,
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
