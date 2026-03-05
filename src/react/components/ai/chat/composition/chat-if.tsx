/**
 * ChatIf — Conditional rendering helper for chat components.
 *
 * @module ai/react/components/chat/composition/chat-if
 */

import type * as React from "react";
import { useChatContextOptional } from "../contexts/chat-context.tsx";
import type { ChatContextValue } from "../contexts/chat-context.tsx";

export interface ChatIfProps {
  children: React.ReactNode;
  condition: boolean | ((ctx: ChatContextValue) => boolean);
  fallback?: React.ReactNode;
}

export function ChatIf(
  { children, condition, fallback = null }: ChatIfProps,
): React.ReactNode {
  const ctx = useChatContextOptional();

  const shouldRender = typeof condition === "function" ? (ctx ? condition(ctx) : false) : condition;

  return shouldRender ? children : fallback;
}
