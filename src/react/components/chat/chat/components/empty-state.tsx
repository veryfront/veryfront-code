import * as React from "react";
import { cn } from "../../theme.ts";
import { ArrowDownIcon } from "../../icons/index.ts";

/** Props accepted by suggestion. */
export interface SuggestionProps {
  suggestion: string;
  onClick?: (suggestion: string) => void;
  className?: string;
  icon?: React.ReactNode;
}

/** Render suggestion. */
export function Suggestion({
  suggestion,
  onClick,
  className,
  icon,
}: SuggestionProps): React.ReactElement {
  return (
    <button
      type="button"
      onClick={() => onClick?.(suggestion)}
      className={cn(
        "group flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-left text-sm text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)] hover:border-[var(--input-border)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2",
        className,
      )}
    >
      {icon
        ? (
          <span className="shrink-0 text-[var(--input-placeholder)] transition-colors group-hover:text-[var(--foreground)]">
            {icon}
          </span>
        )
        : null}
      <span className="line-clamp-1">{suggestion}</span>
    </button>
  );
}

/** Props accepted by suggestions. */
export interface SuggestionsProps {
  children: React.ReactNode;
  className?: string;
  layout?: "grid" | "horizontal";
}

/** Render suggestions. */
export function Suggestions({
  children,
  className,
  layout = "grid",
}: SuggestionsProps): React.ReactElement {
  const containerClassName = layout === "horizontal"
    ? "flex gap-2 overflow-x-auto pb-2 scrollbar-hide"
    : "flex flex-wrap justify-center gap-2 max-w-2xl mx-auto";

  return <div className={cn(containerClassName, className)}>{children}</div>;
}

/** Props accepted by conversation empty state. */
export interface ConversationEmptyStateProps {
  icon?: React.ReactNode;
  title?: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}

/** State for conversation empty. */
export function ConversationEmptyState({
  icon,
  title = "What can I help with?",
  description,
  children,
  className,
}: ConversationEmptyStateProps): React.ReactElement {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", className)}>
      {icon
        ? (
          <div className="mb-4 text-[var(--muted-foreground)]">
            {icon}
          </div>
        )
        : null}
      <h1 className="text-2xl font-medium text-[var(--foreground)] tracking-tight">
        {title}
      </h1>
      {description
        ? (
          <p className="mt-2 max-w-sm text-sm text-[var(--muted-foreground)] leading-relaxed">
            {description}
          </p>
        )
        : null}
      {children}
    </div>
  );
}

/** Props accepted by conversation scroll button. */
export interface ConversationScrollButtonProps {
  onClick?: () => void;
  visible?: boolean;
  className?: string;
}

/** Render conversation scroll button. */
export function ConversationScrollButton({
  onClick,
  visible = true,
  className,
}: ConversationScrollButtonProps): React.ReactElement | null {
  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-[var(--border)] bg-[var(--card)] p-2 shadow-lg transition-all hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2",
        className,
      )}
    >
      <ArrowDownIcon className="size-4" />
    </button>
  );
}
