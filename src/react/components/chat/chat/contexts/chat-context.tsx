/**
 * ChatContext — Root-level shared state for the chat component system.
 *
 * Provided by ChatRoot. Consumed by all descendant chat components via useChatContext().
 *
 * @module react/components/chat/contexts/chat-context
 */

import * as React from "react";
import { COMPONENT_ERROR } from "#veryfront/errors/error-registry.ts";
import type { ChatMessage, ChatStatus } from "#veryfront/agent/react";
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

const ChatContext = React.createContext<ChatContextValue | null>(null);

/** Context for use chat. */
export function useChatContext(): ChatContextValue {
  const context = React.useContext(ChatContext);
  if (!context) {
    throw COMPONENT_ERROR.create({
      detail: "useChatContext must be used within a ChatRoot or Chat component",
    });
  }
  return context;
}

/** React hook for chat context optional. */
export function useChatContextOptional(): ChatContextValue | null {
  return React.useContext(ChatContext);
}

/** Render chat context provider. */
export const ChatContextProvider = ChatContext.Provider;
