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
  onCopy: (ownerDocument?: Document) => Promise<void>;
  /** True briefly after `onCopy` — lifted here so composed layouts keep the tick. */
  copied: boolean;
  /** True briefly after every available clipboard mechanism fails. */
  copyFailed?: boolean;
  onEdit?: (content: string) => void;
  onRegenerate?: () => void;
  onFeedback?: (value: FeedbackValue) => void;
  feedback?: FeedbackValue | null;
}

const [MessageContext, useMessageContextStrict] = createStrictContext<MessageContextValue>(
  "useMessageContext",
  "a Message component",
);
const NOOP_BRANCH_NAVIGATION = (): void => undefined;

/**
 * Read the enclosing message's state (the message, role, streaming flag, parts,
 * branch navigation, copy/edit/regenerate/feedback actions). Provided by
 * `<Message.Root>`; throws when used outside a `<Message>`.
 *
 * @example
 * ```tsx
 * function Regenerate() {
 *   const { onRegenerate } = useMessageContext();
 *   return onRegenerate ? <button onClick={onRegenerate}>Retry</button> : null;
 * }
 * ```
 */
export const useMessageContext = useMessageContextStrict;

/** React hook for message context optional. */
export function useMessageContextOptional(): MessageContextValue | null {
  return React.useContext(MessageContext);
}

/** Result of {@link useMessageBranches}, the message's regeneration variants. */
export interface UseMessageBranchesResult {
  /** 0-based index of the active branch. */
  index: number;
  /** Total number of branches (1 when the message has no variants). */
  count: number;
  /** Whether an earlier / later variant exists. */
  hasPrevious: boolean;
  hasNext: boolean;
  /** Switch to the previous / next variant. No-op when unavailable. */
  previous: () => void;
  next: () => void;
}

/**
 * `useMessageBranches` is a thin hook over the message context's branch state
 * (`getBranches` / `switchBranch` on `useChat`, surfaced as `branch` +
 * `onBranchPrev/Next`). Powers `Message.BranchPicker`; RFC 2980. Must be used
 * within a `<Message>`.
 */
export function useMessageBranches(): UseMessageBranchesResult {
  const ctx = useMessageContext();
  const current = ctx.branch?.current ?? 1; // 1-based
  const count = ctx.branch?.total ?? 1;
  const previous = current > 1 ? ctx.onBranchPrev : undefined;
  const next = current < count ? ctx.onBranchNext : undefined;
  return {
    index: current - 1,
    count,
    hasPrevious: previous !== undefined,
    hasNext: next !== undefined,
    previous: previous ?? NOOP_BRANCH_NAVIGATION,
    next: next ?? NOOP_BRANCH_NAVIGATION,
  };
}

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
