/**
 * Empty State Components
 * @module ai/react/components/chat/components/empty-state
 */

import * as React from "react";
import { cn } from "../../theme.ts";
import { ArrowDownIcon } from "../../icons/index.ts";

/**
 * Suggestion component - ChatGPT-style suggestion card
 */
export interface SuggestionProps {
  suggestion: string;
  onClick?: (suggestion: string) => void;
  className?: string;
  /** Optional icon to display */
  icon?: React.ReactNode;
}

export function Suggestion({ suggestion, onClick, className, icon }: SuggestionProps) {
  return (
    <button
      type="button"
      onClick={() => onClick?.(suggestion)}
      className={cn(
        "group flex items-start gap-3 rounded-xl border border-border bg-background p-4 text-left text-sm text-foreground transition-all hover:bg-muted hover:border-muted-foreground/20",
        className,
      )}
    >
      {icon && (
        <span className="shrink-0 text-muted-foreground group-hover:text-foreground transition-colors">
          {icon}
        </span>
      )}
      <span className="line-clamp-2">{suggestion}</span>
    </button>
  );
}

/**
 * Suggestions container - ChatGPT-style 2x2 grid layout
 */
export interface SuggestionsProps {
  children: React.ReactNode;
  className?: string;
  /** Layout mode: 'grid' for 2x2 grid (ChatGPT style), 'horizontal' for scrollable pills */
  layout?: "grid" | "horizontal";
}

export function Suggestions({ children, className, layout = "grid" }: SuggestionsProps) {
  if (layout === "horizontal") {
    return (
      <div className={cn("flex gap-2 overflow-x-auto pb-2 scrollbar-hide", className)}>
        {children}
      </div>
    );
  }

  return (
    <div className={cn("grid grid-cols-2 gap-3 max-w-2xl mx-auto", className)}>
      {children}
    </div>
  );
}

/**
 * ConversationEmptyState - ChatGPT-style empty state with large greeting
 */
export interface ConversationEmptyStateProps {
  icon?: React.ReactNode;
  title?: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}

export function ConversationEmptyState({
  icon,
  title = "What can I help with?",
  description,
  children,
  className,
}: ConversationEmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", className)}>
      {icon && <div className="mb-4 text-muted-foreground">{icon}</div>}
      <h1 className="text-3xl font-semibold text-foreground">{title}</h1>
      {description && <p className="mt-2 text-base text-muted-foreground max-w-md">{description}
      </p>}
      {children}
    </div>
  );
}

/**
 * ConversationScrollButton - scroll to bottom button
 */
export interface ConversationScrollButtonProps {
  onClick?: () => void;
  visible?: boolean;
  className?: string;
}

export function ConversationScrollButton({
  onClick,
  visible = true,
  className,
}: ConversationScrollButtonProps) {
  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-border bg-background p-2 shadow-lg transition-all hover:bg-muted",
        className,
      )}
    >
      <ArrowDownIcon className="size-4" />
    </button>
  );
}
