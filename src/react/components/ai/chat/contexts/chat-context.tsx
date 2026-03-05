/**
 * ChatContext — Root-level shared state for the chat component system.
 *
 * Provided by ChatRoot. Consumed by all descendant chat components via useChatContext().
 *
 * @module ai/react/components/chat/contexts/chat-context
 */

import * as React from "react";
import type { UIMessage } from "#veryfront/agent/react";
import type { ChatTheme } from "../../theme.ts";
import type { ModelOption } from "../../model-selector.tsx";
import type { AttachmentInfo } from "../components/attachment-pill.tsx";
import type { FeedbackValue } from "../components/message-feedback.tsx";
import type { Source } from "../components/sources.tsx";
import type { BranchInfo } from "#veryfront/agent/react";

export interface ChatContextValue {
  // Messages
  messages: UIMessage[];
  isLoading: boolean;
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
  showSources: boolean;
  onSourceClick?: (source: Source, index: number) => void;

  // UI State
  isEmpty: boolean;
  isAtBottom: boolean;
  scrollToBottom: () => void;

  // Theme
  theme: ChatTheme;
}

const ChatContext = React.createContext<ChatContextValue | null>(null);

export function useChatContext(): ChatContextValue {
  const context = React.useContext(ChatContext);
  if (!context) {
    throw new Error("useChatContext must be used within a ChatRoot or Chat component");
  }
  return context;
}

export function useChatContextOptional(): ChatContextValue | null {
  return React.useContext(ChatContext);
}

export const ChatContextProvider = ChatContext.Provider;
