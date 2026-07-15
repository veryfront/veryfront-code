/**
 * ChatEmpty — the preset's empty state, composed from the `ChatEmptyState`
 * primitive (`Root` + `Avatar`/icon + `Heading` + `Suggestions`/`Suggestion`)
 * plus optional `QuickActions`. Prop-driven wrapper so `<Chat>` can render an
 * empty state from data; drop to `ChatEmptyState.*` directly for full control.
 *
 * @module react/components/chat/composition/chat-empty
 */

import * as React from "react";
import type { PromptSuggestion } from "#veryfront/agent/react";
import { ChatEmptyState } from "./chat-empty-state.tsx";
import { type QuickAction, QuickActions } from "../components/quick-actions.tsx";

/** Normalize a `string | PromptSuggestion` chip to the `{ label, prompt }` shape. */
function toPromptSuggestion(suggestion: string | PromptSuggestion): PromptSuggestion {
  return typeof suggestion === "string" ? { label: suggestion, prompt: suggestion } : suggestion;
}

/** Props accepted by chat empty. */
export interface ChatEmptyProps {
  icon?: React.ReactNode;
  title?: string;
  description?: string;
  /**
   * Suggestion chips. Plain strings become `{ label, prompt }` where both are
   * the string; pass `PromptSuggestion` objects to show a short label while
   * sending a longer prompt (e.g. from `getAgentPromptSuggestionItems`).
   */
  suggestions?: Array<string | PromptSuggestion>;
  /** Receives the clicked suggestion as a `{ label, prompt }` object. */
  onSuggestionClick?: (suggestion: PromptSuggestion) => void;
  quickActions?: QuickAction[];
  onQuickAction?: (action: QuickAction) => void;
  className?: string;
  children?: React.ReactNode;

  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** Render chat empty. */
export function ChatEmpty(
  {
    icon,
    title = "What can I help with?",
    description,
    suggestions,
    onSuggestionClick,
    quickActions,
    onQuickAction,
    className,
    children,
    ref,
  }: ChatEmptyProps,
): React.ReactElement {
  const showSuggestions = (suggestions?.length ?? 0) > 0;
  const showQuickActions = (quickActions?.length ?? 0) > 0;

  return (
    <ChatEmptyState.Root ref={ref} className={className}>
      {icon}
      <ChatEmptyState.Heading>{title}</ChatEmptyState.Heading>
      {description && (
        <p className="max-w-md text-center text-sm text-[var(--foreground)]">
          {description}
        </p>
      )}
      {showSuggestions && (
        <ChatEmptyState.Suggestions>
          {suggestions?.map((suggestion, index) => {
            const item = toPromptSuggestion(suggestion);
            return (
              <ChatEmptyState.Suggestion
                key={`${item.label}-${index}`}
                onClick={() => onSuggestionClick?.(item)}
              >
                {item.label}
              </ChatEmptyState.Suggestion>
            );
          })}
        </ChatEmptyState.Suggestions>
      )}
      {showQuickActions && (
        <div className="mt-4">
          <QuickActions actions={quickActions} onActionClick={onQuickAction} />
        </div>
      )}
      {children}
    </ChatEmptyState.Root>
  );
}
ChatEmpty.displayName = "ChatEmpty";
