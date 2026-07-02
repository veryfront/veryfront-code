/**
 * ChatEmpty — the preset's empty state, composed from the `ChatEmptyState`
 * primitive (`Root` + `Avatar`/icon + `Heading` + `Suggestions`/`Suggestion`)
 * plus optional `QuickActions`. Prop-driven wrapper so `<Chat>` can render an
 * empty state from data; drop to `ChatEmptyState.*` directly for full control.
 *
 * @module react/components/chat/composition/chat-empty
 */

import * as React from "react";
import { ChatEmptyState } from "./chat-empty-state.tsx";
import { type QuickAction, QuickActions } from "../components/quick-actions.tsx";

/** Props accepted by chat empty. */
export interface ChatEmptyProps {
  icon?: React.ReactNode;
  title?: string;
  description?: string;
  suggestions?: string[];
  onSuggestionClick?: (suggestion: string) => void;
  quickActions?: QuickAction[];
  onQuickAction?: (action: QuickAction) => void;
  className?: string;
  children?: React.ReactNode;
}

/** Render chat empty. */
export const ChatEmpty = React.forwardRef<HTMLDivElement, ChatEmptyProps>(
  function ChatEmpty(
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
    },
    ref,
  ) {
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
            {suggestions?.map((suggestion) => (
              <ChatEmptyState.Suggestion
                key={suggestion}
                onClick={() => onSuggestionClick?.(suggestion)}
              >
                {suggestion}
              </ChatEmptyState.Suggestion>
            ))}
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
  },
);
ChatEmpty.displayName = "ChatEmpty";
