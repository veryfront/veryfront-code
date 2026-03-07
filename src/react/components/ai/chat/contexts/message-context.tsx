/**
 * MessageContext — Per-message state for message sub-components.
 *
 * Provided by Message.Root or the message rendering loop.
 * Consumed by action bars, branch pickers, feedback buttons, etc.
 *
 * @module ai/react/components/chat/contexts/message-context
 */

import * as React from "react";
import { COMPONENT_ERROR } from "#veryfront/errors";
import type { BranchInfo, UIMessage } from "#veryfront/agent/react";
import type { FeedbackValue } from "../components/message-feedback.tsx";
import type { PartGroup } from "../utils/message-parts.ts";

export interface MessageContextValue {
  message: UIMessage;
  role: "user" | "assistant" | "system" | "tool";
  isStreaming: boolean;
  parts: PartGroup[];
  textContent: string;

  // Branch navigation
  branch: BranchInfo | null;
  onBranchPrev?: () => void;
  onBranchNext?: () => void;

  // Actions
  onCopy: () => Promise<void>;
  onEdit?: (content: string) => void;
  onRegenerate?: () => void;
  onFeedback?: (value: FeedbackValue) => void;
  feedback?: FeedbackValue | null;
}

const MessageContext = React.createContext<MessageContextValue | null>(null);

export function useMessageContext(): MessageContextValue {
  const context = React.useContext(MessageContext);
  if (!context) {
    throw COMPONENT_ERROR.create({
      detail: "useMessageContext must be used within a Message component",
    });
  }
  return context;
}

export function useMessageContextOptional(): MessageContextValue | null {
  return React.useContext(MessageContext);
}

export const MessageContextProvider = MessageContext.Provider;
