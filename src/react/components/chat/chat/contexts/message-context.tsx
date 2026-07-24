/**
 * MessageContext — Per-message state for message sub-components.
 *
 * Provided by Message.Root or the message rendering loop.
 * Consumed by action bars, branch pickers, feedback buttons, etc.
 *
 * @module react/components/chat/contexts/message-context
 */

import * as React from "react";
import { createStrictContext } from "../../../create-strict-context.ts";
import type { BranchInfo, ChatMessage } from "#veryfront/agent/react";
import type { FeedbackValue } from "../components/message-feedback.tsx";
import type { PartGroup } from "../utils/message-parts.ts";

/** Public API contract for message context value. */
export interface MessageContextValue {
  message: ChatMessage;
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
  /** True briefly after `onCopy` — lifted here so composed layouts keep the tick. */
  copied: boolean;
  onEdit?: (content: string) => void;
  onRegenerate?: () => void;
  onFeedback?: (value: FeedbackValue) => void;
  feedback?: FeedbackValue | null;
}

const [MessageContext, useMessageContext] = createStrictContext<MessageContextValue>(
  "useMessageContext",
  "a Message component",
);

/** React hook for message context optional. */
export function useMessageContextOptional(): MessageContextValue | null {
  return React.useContext(MessageContext);
}

export { useMessageContext };

/** The message's grouped parts exposed as headless data. */
export interface MessagePartsData {
  /** Parts grouped in render order (text / reasoning / tool / source …). */
  parts: MessageContextValue["parts"];
  /** The concatenated text content of the answer parts. */
  textContent: string;
}

/**
 * `useMessageParts` — read the current message's parts as data, so a consumer
 * can render them however they like (the headless access point to parts;
 * `Message.Part` is the leaf and `Message.Content` provides the default
 * rendering). Throws outside a `Message`.
 */
export function useMessageParts(): MessagePartsData {
  const { parts, textContent } = useMessageContext();
  return { parts, textContent };
}

/** Render message context provider. */
export const MessageContextProvider = MessageContext.Provider;
