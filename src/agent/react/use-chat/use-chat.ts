/**
 * useChat Hook - Layer 1 (Headless)
 *
 * Complete chat state management with zero UI.
 * Consumes AG-UI SSE by default.
 *
 * Supports two inference modes:
 * - cloud: server-side provider inference
 * - server-local: explicit local model on the server
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createError, ensureError, toError } from "#veryfront/errors";

import { handleAgUiStreamingResponse } from "#veryfront/agent/react/use-chat/streaming/index.ts";
import type {
  BranchInfo,
  ChatFilePart,
  ChatMessage,
  ChatMessagePart,
  InferenceMode,
  ToolOutput,
  UseChatOptions,
  UseChatResult,
} from "#veryfront/agent/react/use-chat/types.ts";
import { generateClientId } from "#veryfront/agent/react/use-chat/utils.ts";

type UseChatStreamHandler = typeof handleAgUiStreamingResponse;

/** A snapshot of messages from a branch point onward */
interface Branch {
  messages: ChatMessage[];
}

/** Tracks branches keyed by the message ID where the edit occurred */
interface BranchState {
  branches: Branch[];
  currentIndex: number;
  baseMessages: ChatMessage[];
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
  messages: ChatMessage[],
  branchKey: string,
  branchKeyByMessageId: Map<string, string>,
): number {
  return messages.findIndex((m) =>
    m.role === "user" && branchKeyByMessageId.get(m.id) === branchKey
  );
}

/**
 * Build the parts for an outgoing user message. File attachments lead (before
 * the text) so the model sees the referenced files first — matching how AI-SDK
 * orders multimodal parts. Exported for unit testing.
 */
export function buildUserMessageParts(
  text: string,
  files?: ChatFilePart[],
): ChatMessagePart[] {
  return [...(files ?? []), { type: "text", text }];
}

function isFilePart(part: ChatMessagePart): part is ChatFilePart {
  return part.type === "file";
}

/** Extract the text and file payload from a user message for regenerate. */
export function userMessagePayload(
  message: ChatMessage,
): { text: string; files?: ChatFilePart[] } | null {
  const text = message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
  const files = message.parts.filter(isFilePart);
  if (!text && files.length === 0) return null;
  return { text, ...(files.length > 0 ? { files } : {}) };
}

export function resolveUseChatStreamHandler(
  transport: UseChatOptions["transport"],
): UseChatStreamHandler {
  void transport;
  return handleAgUiStreamingResponse;
}

/**
 * useChat hook for managing chat state with veryfront stream events.
 */
const DEFAULT_CHAT_API = "/api/ag-ui";

export function useChat(options: UseChatOptions = {}): UseChatResult {
  const api = options.api ?? DEFAULT_CHAT_API;
  const [messages, setMessages] = useState<ChatMessage[]>(options.initialMessages ?? []);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<unknown>(null);
  const [model, setModel] = useState<string | undefined>(options.model);
  const [inferenceMode, setInferenceMode] = useState<InferenceMode>("cloud");
  const [activeModel, setActiveModel] = useState<string | undefined>(undefined);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  // Branch tracking: keyed by the message ID at the edit point
  const branchMapRef = useRef<Map<string, BranchState>>(new Map());
  const branchKeyByMessageIdRef = useRef<Map<string, string>>(new Map());

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
   * Send a message and stream assistant updates.
   */
  const sendMessage = useCallback(
    async (
      message: {
        text: string;
        files?: ChatFilePart[];
        baseMessages?: ChatMessage[];
        userMessageId?: string;
      },
    ) => {
      // Abort any in-flight request before starting a new one
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      const requestId = ++requestIdRef.current;

      const userMessage: ChatMessage = {
        id: message.userMessageId ?? generateClientId("msg"),
        role: "user",
        parts: buildUserMessageParts(message.text, message.files),
        createdAt: new Date().toISOString(),
      };

      const base = message.baseMessages ?? messagesRef.current;
      setMessages([...base, userMessage]);
      setIsLoading(true);
      setError(null);

      try {
        const allMessages = [...base, userMessage];

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        const response = await fetch(api, {
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

        if (!response.ok) {
          let message = `API error: ${response.status}`;
          try {
            const body = await response.clone().json();
            if (body && typeof body === "object" && "error" in body) {
              const errorMessage = (body as { error?: unknown }).error;
              if (typeof errorMessage === "string" && errorMessage.trim()) {
                message = errorMessage;
              }
            }
          } catch {
            // Ignore non-JSON error responses.
          }
          throw toError(
            createError({
              type: "agent",
              message,
            }),
          );
        }

        options.onResponse?.(response);

        if (!response.body) return;

        const streamingMessageId = generateClientId("msg");
        let hasAddedStreamingMessage = false;
        const currentMessageIdRef = { current: streamingMessageId };
        // Mutable local — updated by onData before onMessage/onUpdate use it.
        let serverModel: string | undefined = model;
        setActiveModel(undefined);

        const handleResponse = resolveUseChatStreamHandler(options.transport);

        await handleResponse(response.body, {
          onMessage: (assistantMessage) => {
            const withMeta = {
              ...assistantMessage,
              metadata: { ...assistantMessage.metadata, model: serverModel },
            };
            setMessages((prev) => {
              if (!hasAddedStreamingMessage) return [...prev, withMeta];
              return prev.map((
                m,
              ) => (m.id === currentMessageIdRef.current
                ? {
                  ...withMeta,
                  // Keep the timestamp from when the turn first streamed in.
                  createdAt: m.createdAt ?? withMeta.createdAt,
                  metadata: { ...m.metadata, ...withMeta.metadata },
                }
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
                serverModel = d.model;
                setActiveModel(d.model);
              }
            }
          },
          onUpdate: (parts, messageId, messageMetadata) => {
            const id = messageId ?? streamingMessageId;
            const metadata = { ...messageMetadata, model: serverModel };

            if (messageId && messageId !== currentMessageIdRef.current) {
              const oldId = currentMessageIdRef.current;
              currentMessageIdRef.current = messageId;

              if (hasAddedStreamingMessage) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === oldId
                      ? { ...m, id, parts, metadata: { ...m.metadata, ...metadata } }
                      : m
                  )
                );
                return;
              }
            }

            if (!hasAddedStreamingMessage) {
              hasAddedStreamingMessage = true;
              setMessages((
                prev,
              ) => [
                ...prev,
                {
                  id,
                  role: "assistant",
                  parts,
                  metadata,
                  // Stamp when the turn first appears; `onMessage` preserves it.
                  createdAt: new Date().toISOString(),
                },
              ]);
              return;
            }

            setMessages((prev) =>
              prev.map((m) =>
                m.id === currentMessageIdRef.current
                  ? { ...m, parts, metadata: { ...m.metadata, ...metadata } }
                  : m
              )
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
    [model, options],
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
    if (!lastUserMessage) return;
    const payload = userMessagePayload(lastUserMessage);
    if (!payload) return;

    const base = currentMessages.slice(0, lastUserIndex);
    await sendMessage({ ...payload, baseMessages: base });
  }, [sendMessage]);

  /**
   * Stop generation
   */
  const stop = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
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
    async (e?: React.FormEvent) => {
      e?.preventDefault();
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
    // Aliases that match ChatProps so users can spread {...chat}
    onChange: handleInputChange,
    onSubmit: handleSubmit,
    onModelChange: setModel,
  };
}
