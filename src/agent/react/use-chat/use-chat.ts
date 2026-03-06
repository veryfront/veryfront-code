/**
 * useChat Hook - Layer 1 (Headless)
 *
 * Complete chat state management with zero UI.
 * Consumes the veryfront streaming protocol
 * (message-start/message-finish + step-start/step-end).
 *
 * Supports three inference modes:
 * - cloud: API key present, normal server-side inference
 * - server-local: No API key, server runs local model via ONNX
 * - browser: Server can't run ONNX (compiled binary), falls back to browser Worker
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createError, ensureError, toError } from "#veryfront/errors/veryfront-error.ts";

import { handleStreamingResponse } from "./streaming/index.ts";
import type {
  BranchInfo,
  BrowserInferenceStatus,
  InferenceMode,
  ToolOutput,
  UIMessage,
  UIMessagePart,
  UseChatOptions,
  UseChatResult,
} from "./types.ts";
import { generateClientId } from "./utils.ts";

/** A snapshot of messages from a branch point onward */
interface Branch {
  messages: UIMessage[];
}

/** Tracks branches keyed by the message ID where the edit occurred */
interface BranchState {
  branches: Branch[];
  currentIndex: number;
  baseMessages: UIMessage[];
}

export function isLatestRequest(activeRequestId: number, requestId: number): boolean {
  return activeRequestId === requestId;
}

export function resolveBranchKey(
  messageId: string,
  branchMap: Map<string, BranchState>,
  branchKeyByMessageId: Map<string, string>,
): string | undefined {
  return branchKeyByMessageId.get(messageId) ??
    (branchMap.has(messageId) ? messageId : undefined);
}

export function findBranchUserMessageIndex(
  messages: UIMessage[],
  branchKey: string,
  branchKeyByMessageId: Map<string, string>,
): number {
  return messages.findIndex((m) =>
    m.role === "user" && branchKeyByMessageId.get(m.id) === branchKey
  );
}

/**
 * useChat hook for managing chat state with veryfront stream events.
 */
export function useChat(options: UseChatOptions): UseChatResult {
  const [messages, setMessages] = useState<UIMessage[]>(options.initialMessages ?? []);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<unknown>(null);
  const [model, setModel] = useState<string | undefined>(options.model);
  const [inferenceMode, setInferenceMode] = useState<InferenceMode>("cloud");
  const [activeModel, setActiveModel] = useState<string | undefined>(undefined);
  const [browserStatus, setBrowserStatus] = useState<BrowserInferenceStatus | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const browserInferenceActiveRef = useRef(false);
  const browserInferenceRejectRef = useRef<((reason: Error) => void) | null>(null);

  // Branch tracking: keyed by the message ID at the edit point
  const branchMapRef = useRef<Map<string, BranchState>>(new Map());
  const branchKeyByMessageIdRef = useRef<Map<string, string>>(new Map());

  // System prompt for browser fallback (from 503 response or options)
  const systemPromptRef = useRef<string>(
    options.systemPrompt ?? "You are a helpful AI assistant.",
  );

  // Track pending tool outputs for addToolOutput
  const pendingToolOutputsRef = useRef<Map<string, ToolOutput>>(new Map());

  // Abort in-flight request on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  /**
   * Add tool output to pending tool-call parts.
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
            state: output.state ?? (output.errorText ? "output-error" : "output-available"),
            output: output.output,
            errorText: output.errorText,
          };
        }),
      }))
    );
  }, []);

  /**
   * Run inference in the browser via Web Worker.
   * Lazily imports the browser-inference module to avoid bundling it
   * when server-side inference works fine.
   */
  const doBrowserInference = useCallback(
    async (allMessages: UIMessage[]) => {
      browserInferenceActiveRef.current = true;

      try {
        const { runBrowserInference } = await import(
          "./browser-inference/browser-engine.ts"
        );

        await new Promise<void>((resolve, reject) => {
          browserInferenceRejectRef.current = reject;
          let hasAddedMessage = false;

          runBrowserInference(allMessages, systemPromptRef.current, {
            onUpdate: (parts: UIMessagePart[], messageId: string) => {
              if (!hasAddedMessage) {
                hasAddedMessage = true;
                setMessages((prev) => [
                  ...prev,
                  {
                    id: messageId,
                    role: "assistant",
                    parts,
                    metadata: { model: model ?? "browser" },
                  },
                ]);
                return;
              }
              setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, parts } : m)));
            },
            onMessage: (assistantMessage: UIMessage) => {
              const withMeta = {
                ...assistantMessage,
                metadata: { ...assistantMessage.metadata, model: model ?? "browser" },
              };
              setMessages((prev) => {
                if (!hasAddedMessage) return [...prev, withMeta];
                return prev.map((m) =>
                  m.id === assistantMessage.id
                    ? { ...withMeta, metadata: { ...m.metadata, ...withMeta.metadata } }
                    : m
                );
              });
              options.onFinish?.(withMeta);
              browserInferenceRejectRef.current = null;
              resolve();
            },
            onStatusChange: (status: BrowserInferenceStatus) => {
              setBrowserStatus(status);
            },
            onDownloadProgress: () => {
              // Progress is tracked via onStatusChange("downloading-model")
            },
            onError: (err: Error) => {
              browserInferenceRejectRef.current = null;
              reject(err);
            },
          });
        });
      } finally {
        browserInferenceActiveRef.current = false;
      }
    },
    [options],
  );

  /**
   * Send a message and stream assistant updates.
   */
  const sendMessage = useCallback(
    async (message: { text: string; baseMessages?: UIMessage[]; userMessageId?: string }) => {
      // Abort any in-flight request before starting a new one
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      const requestId = ++requestIdRef.current;

      const userMessage: UIMessage = {
        id: message.userMessageId ?? generateClientId("msg"),
        role: "user",
        parts: [{ type: "text", text: message.text }],
      };

      const base = message.baseMessages ?? messagesRef.current;
      setMessages([...base, userMessage]);
      setIsLoading(true);
      setError(null);

      try {
        const allMessages = [...base, userMessage];

        // If already in browser mode, skip fetch entirely
        if (inferenceMode === "browser") {
          await doBrowserInference(allMessages);
          return;
        }

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        const response = await fetch(options.api, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...options.headers,
          },
          credentials: options.credentials,
          body: JSON.stringify({
            messages: allMessages,
            ...(model ? { model } : {}),
            ...options.body,
          }),
          signal: abortController.signal,
        });

        // Handle 503 — server can't provide AI, fall back to browser
        if (response.status === 503 && (options.browserFallback ?? true)) {
          try {
            const body = await response.json();
            if (body.code === "NO_AI_AVAILABLE") {
              if (body.systemPrompt) {
                systemPromptRef.current = body.systemPrompt;
              }
              setInferenceMode("browser");
              setBrowserStatus("idle");
              await doBrowserInference(allMessages);
              return;
            }
          } catch {
            // If parsing fails, fall through to normal error handling
          }
        }

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
        const currentMessageIdRef = { current: streamingMessageId };

        await handleStreamingResponse(response.body, {
          onMessage: (assistantMessage) => {
            const withMeta = {
              ...assistantMessage,
              metadata: { ...assistantMessage.metadata, model },
            };
            setMessages((prev) => {
              if (!hasAddedStreamingMessage) return [...prev, withMeta];
              return prev.map((
                m,
              ) => (m.id === currentMessageIdRef.current
                ? { ...withMeta, metadata: { ...m.metadata, ...withMeta.metadata } }
                : m)
              );
            });
            options.onFinish?.(withMeta);
          },
          onData: (eventData) => {
            setData(eventData);
            // Detect inference mode and resolved model from server metadata
            if (
              eventData &&
              typeof eventData === "object" &&
              "inferenceMode" in eventData
            ) {
              const d = eventData as { inferenceMode: string; model?: string };
              if (d.inferenceMode === "server-local" || d.inferenceMode === "cloud") {
                setInferenceMode(d.inferenceMode);
              }
              if (d.model) {
                setActiveModel(d.model);
              }
            }
          },
          onUpdate: (parts, messageId) => {
            const id = messageId ?? streamingMessageId;

            if (messageId && messageId !== currentMessageIdRef.current) {
              const oldId = currentMessageIdRef.current;
              currentMessageIdRef.current = messageId;

              if (hasAddedStreamingMessage) {
                setMessages((prev) => prev.map((m) => (m.id === oldId ? { ...m, id, parts } : m)));
                return;
              }
            }

            if (!hasAddedStreamingMessage) {
              hasAddedStreamingMessage = true;
              setMessages((
                prev,
              ) => [...prev, { id, role: "assistant", parts, metadata: { model } }]);
              return;
            }

            setMessages((prev) =>
              prev.map((m) => (m.id === currentMessageIdRef.current ? { ...m, parts } : m))
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
        // Only the latest request can clear loading/abort state.
        if (isLatestRequest(requestIdRef.current, requestId)) {
          setIsLoading(false);
          abortControllerRef.current = null;
        }
      }
    },
    [model, options, inferenceMode, doBrowserInference],
  );

  /**
   * Reload last message
   */
  const reload = useCallback(async () => {
    const currentMessages = messagesRef.current;
    if (currentMessages.length === 0) return;

    const lastUserIndex = currentMessages.findLastIndex((m) => m.role === "user");
    if (lastUserIndex === -1) return;

    const lastUserMessage = currentMessages[lastUserIndex];
    const textPart = lastUserMessage?.parts.find((p) => p.type === "text");
    if (!textPart || !("text" in textPart)) return;

    const base = currentMessages.slice(0, lastUserIndex);
    await sendMessage({ text: textPart.text, baseMessages: base });
  }, [sendMessage]);

  /**
   * Stop generation
   */
  const stop = useCallback(async () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;

    // Also stop browser inference Worker if active
    if (browserInferenceActiveRef.current) {
      // Settle the pending doBrowserInference promise before terminating the Worker
      browserInferenceRejectRef.current?.(new Error("Generation stopped by user"));
      browserInferenceRejectRef.current = null;

      try {
        const { stopBrowserInference } = await import(
          "./browser-inference/browser-engine.ts"
        );
        stopBrowserInference();
      } catch {
        // Worker module may already be terminated or unavailable
      }
      browserInferenceActiveRef.current = false;
      setBrowserStatus("ready");
    }

    setIsLoading(false);
  }, []);

  /**
   * Edit a previous user message and resubmit.
   * Saves the current messages from the edit point as a branch so the user
   * can navigate back to it via switchBranch.
   */
  const editMessage = useCallback(
    async (messageId: string, newText: string) => {
      const current = messagesRef.current;
      const idx = current.findIndex((m) => m.id === messageId);
      if (idx === -1) return;

      const branchKey = branchKeyByMessageIdRef.current.get(messageId) ?? messageId;
      const tail = current.slice(idx);

      let state = branchMapRef.current.get(branchKey);
      if (state) {
        // Persist the currently visible branch before creating a new edit branch.
        state.baseMessages = current.slice(0, idx);
        state.branches[state.currentIndex] = { messages: tail };
        state.branches.push({ messages: [] }); // placeholder for the new edit branch
        state.currentIndex = state.branches.length - 1;
      } else {
        state = {
          branches: [
            { messages: tail }, // original
            { messages: [] }, // placeholder for the new edit
          ],
          currentIndex: 1,
          baseMessages: current.slice(0, idx),
        };
        branchMapRef.current.set(branchKey, state);
      }

      const newUserMessageId = generateClientId("msg");
      await sendMessage({
        text: newText,
        baseMessages: state.baseMessages,
        userMessageId: newUserMessageId,
      });

      // Update the placeholder with the newly generated branch and sync ID mappings.
      state = branchMapRef.current.get(branchKey);
      if (state) {
        state.branches[state.currentIndex] = {
          messages: messagesRef.current.slice(state.baseMessages.length),
        };
        for (const branch of state.branches) {
          const firstMessageId = branch.messages[0]?.id;
          if (firstMessageId) {
            branchKeyByMessageIdRef.current.set(firstMessageId, branchKey);
          }
        }
      }
    },
    [sendMessage],
  );

  /**
   * Get branch info for a message.
   */
  const getBranches = useCallback((messageId: string): BranchInfo => {
    const branchKey = resolveBranchKey(
      messageId,
      branchMapRef.current,
      branchKeyByMessageIdRef.current,
    );
    if (!branchKey) return { current: 1, total: 1 };

    const state = branchMapRef.current.get(branchKey);
    if (!state) return { current: 1, total: 1 };
    return { current: state.currentIndex + 1, total: state.branches.length };
  }, []);

  /**
   * Switch to a different branch at a given message.
   * branchIndex is 0-based.
   */
  const switchBranch = useCallback((messageId: string, branchIndex: number) => {
    const branchKey = resolveBranchKey(
      messageId,
      branchMapRef.current,
      branchKeyByMessageIdRef.current,
    );
    if (!branchKey) return;

    const state = branchMapRef.current.get(branchKey);
    if (!state || branchIndex < 0 || branchIndex >= state.branches.length) return;

    // Save currently visible tail before switching away.
    const current = messagesRef.current;
    const idx = findBranchUserMessageIndex(
      current,
      branchKey,
      branchKeyByMessageIdRef.current,
    );
    if (idx !== -1) {
      state.branches[state.currentIndex] = { messages: current.slice(idx) };
    }

    state.currentIndex = branchIndex;
    const branch = state.branches[branchIndex];
    if (!branch || branch.messages.length === 0) return;

    const firstMessageId = branch.messages[0]?.id;
    if (firstMessageId) {
      branchKeyByMessageIdRef.current.set(firstMessageId, branchKey);
    }

    // Rebuild from stable prefix captured at edit point.
    setMessages([...state.baseMessages, ...branch.messages]);
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
      await sendMessage({ text });
    },
    [input, isLoading, sendMessage],
  );

  return {
    messages,
    input,
    isLoading,
    error,
    model,
    activeModel,
    inferenceMode,
    browserStatus,
    setInput,
    setModel,
    sendMessage,
    editMessage,
    getBranches,
    switchBranch,
    reload,
    stop,
    setMessages,
    addToolOutput,
    data,
    handleInputChange,
    handleSubmit,
    // Aliases that match ChatProps / ChatWithSidebarProps so users can spread {...chat}
    onChange: handleInputChange,
    onSubmit: handleSubmit,
    onModelChange: setModel,
  };
}
