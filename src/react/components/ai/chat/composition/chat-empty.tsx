/**
 * ChatEmpty — Empty state for the chat conversation.
 *
 * @module ai/react/components/chat/composition/chat-empty
 */

import * as React from "react";
import { cn } from "../../theme.ts";
import { MessageSquareIcon } from "../../icons/index.ts";
import { ConversationEmptyState, Suggestion, Suggestions } from "../components/empty-state.tsx";
import { type QuickAction, QuickActions } from "../components/quick-actions.tsx";

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
      <div
        ref={ref}
        className={cn("flex flex-col items-center justify-center h-full px-4", className)}
      >
        <div className="flex-1" />
        <ConversationEmptyState
          icon={icon ?? <MessageSquareIcon className="size-10" />}
          title={title}
          description={description}
        />
        {showSuggestions && (
          <div className="w-full max-w-2xl mt-6 mb-8">
            <Suggestions layout="grid">
              {suggestions?.map((suggestion) => (
                <Suggestion
                  key={suggestion}
                  suggestion={suggestion}
                  onClick={onSuggestionClick}
                />
              ))}
            </Suggestions>
          </div>
        )}
        {showQuickActions && (
          <div className="mb-4">
            <QuickActions actions={quickActions} onActionClick={onQuickAction} />
          </div>
        )}
        {children}
        <div className="flex-1" />
      </div>
    );
  },
);
ChatEmpty.displayName = "ChatEmpty";
