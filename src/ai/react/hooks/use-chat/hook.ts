/**
 * useChat Hook Implementation
 *
 * Layer 1 (Headless) - Complete chat state management with zero UI.
 * Build any interface you want.
 *
 * NOTE: In production, this could leverage Vercel AI SDK's useChat
 * for battle-tested implementation. This is a simplified reference implementation.
 *
 * @module ai/react/hooks/use-chat/hook
 */

import { useCallback, useRef, useState } from "react";
import { createError, ensureError, toError } from "@veryfront/errors/veryfront-error.ts";
import type { TextUIPart, ToolOutput, UIMessage, UseChatOptions, UseChatResult } from "./types.ts";
import { generateClientId } from "./utils.ts";
import { handleStreamingResponse } from "./streaming/handler.ts";

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
          let currentMessageId = streamingMessageId;

          await handleStreamingResponse(response.body, {
            onMessage: (assistantMessage) => {
              setMessages((prev) => {
                if (hasAddedStreamingMessage) {
                  return prev.map((m) => m.id === currentMessageId ? assistantMessage : m);
                }
                return [...prev, assistantMessage];
              });
              options.onFinish?.(assistantMessage);
            },
            onData: setData,
            onUpdate: (parts, messageId) => {
              const id = messageId || streamingMessageId;
              if (messageId && messageId !== currentMessageId) {
                const oldId = currentMessageId;
                currentMessageId = messageId;
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

        const error = ensureError(err);
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
