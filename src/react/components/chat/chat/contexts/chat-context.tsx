/**
 * ChatContext — Root-level shared state for the chat component system.
 *
 * Provided by ChatRoot. Consumed by all descendant chat components via useChatContext().
 *
 * @module react/components/chat/contexts/chat-context
 */

import * as React from "react";
import { createStrictContext } from "../../../create-strict-context.ts";
import type { ChatFilePart, ChatMessage, ChatStatus } from "#veryfront/agent/react";
import type { ChatTheme } from "../../theme.ts";
import type { ModelOption } from "../../model-selector.tsx";
import type { AttachmentInfo } from "../components/attachment-pill.tsx";
import type { FeedbackValue } from "../components/message-feedback.tsx";
import type { Source } from "../components/sources.tsx";
import type { BranchInfo } from "#veryfront/agent/react";

/** Public API contract for chat context value. */
export interface ChatContextValue {
  // Messages
  messages: ChatMessage[];
  isLoading: boolean;
  /**
   * Streaming lifecycle of the current turn (`useChat().status`).
   * Optional so hand-built providers can omit it; presentational nodes should
   * prefer `status`/`streamingMessageId` over `isLoading`.
   */
  status?: ChatStatus;
  /** Id of the assistant message currently streaming, or `null`/absent when idle. */
  streamingMessageId?: string | null;
  error: Error | null;

  // Input
  input: string;
  setInput: (value: string) => void;

  // Submit / Stop
  onSubmit: (e?: React.FormEvent) => void | Promise<void>;
  /** Send resolved composer text, attachments, and an optional request model through the session. */
  sendMessage?: (message: { text: string; files?: ChatFilePart[]; model?: string }) =>
    | void
    | Promise<void>;
  onStop?: () => void;
  onReload?: () => void;

  // Model
  model?: string;
  models: ModelOption[];
  onModelChange?: (modelId: string) => void;

  // Agent identity — fallback for assistant message headers when a message's
  // own metadata omits `agentName` / `agentAvatarUrl` (e.g. the AG-UI stream
  // only carries `agentId`). Populated by `<Chat agentId>` from agent metadata.
  // Accepts `AgentMetadata` structurally (hence `avatarUrl: string | null`), so
  // a `useAgentMetadata()` result can be passed straight through.
  agent?: { name?: string; avatarUrl?: string | null };

  // Attachments
  attachments: AttachmentInfo[];
  onAttach?: (files: FileList) => void;
  onRemoveAttachment?: (id: string) => void;

  // Branching
  editMessage?: (messageId: string, newText: string) => Promise<void>;
  getBranches?: (messageId: string) => BranchInfo;
  switchBranch?: (messageId: string, branchIndex: number) => void;

  // Feedback
  onFeedback?: (messageId: string, feedback: FeedbackValue) => void;

  // Sources
  onSourceClick?: (source: Source, index: number) => void;

  // UI State
  isEmpty: boolean;
  isAtBottom: boolean;
  scrollToBottom: () => void;

  // Theme
  theme: ChatTheme;
}

const [ChatContext, useChatContextStrict] = createStrictContext<ChatContextValue>(
  "useChatContext",
  "a ChatRoot or Chat component",
);

/**
 * Read the enclosing chat's shared state (messages, input, submit/stop, model,
 * attachments, branches, theme). Provided by `<Chat.Root>` / `<Chat>`; throws
 * when used outside one.
 *
 * @example
 * ```tsx
 * function SendButton() {
 *   const { onSubmit, isLoading } = useChatContext();
 *   return <button onClick={() => onSubmit()} disabled={isLoading}>Send</button>;
 * }
 * ```
 */
export const useChatContext = useChatContextStrict;

/** React hook for chat context optional. */
export function useChatContextOptional(): ChatContextValue | null {
  return React.useContext(ChatContext);
}

/** Render chat context provider. */
export const ChatContextProvider = ChatContext.Provider;
