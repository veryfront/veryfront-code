import * as React from "react";
import { cn } from "../../theme.ts";
import { ArrowDownIcon } from "../../icons/index.ts";

export interface SuggestionProps {
  suggestion: string;
  onClick?: (suggestion: string) => void;
  className?: string;
  icon?: React.ReactNode;
}

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
        "group flex items-center gap-2 rounded-full border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-2.5 text-left text-sm text-neutral-600 dark:text-neutral-400 transition-all hover:bg-neutral-50 dark:hover:bg-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-600 hover:text-neutral-900 dark:hover:text-neutral-100 hover:shadow-sm",
        className,
      )}
    >
      {icon
        ? (
          <span className="shrink-0 text-neutral-400 transition-colors group-hover:text-neutral-600 dark:group-hover:text-neutral-300">
            {icon}
          </span>
        )
        : null}
      <span className="line-clamp-1">{suggestion}</span>
    </button>
  );
}

export interface SuggestionsProps {
  children: React.ReactNode;
  className?: string;
  layout?: "grid" | "horizontal";
}

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
}: ConversationEmptyStateProps): React.ReactElement {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", className)}>
      {icon
        ? (
          <div className="mb-6 flex items-center justify-center size-14 rounded-2xl bg-neutral-100 dark:bg-neutral-800/80 text-neutral-400 dark:text-neutral-500">
            {icon}
          </div>
        )
        : null}
      <h1 className="text-3xl font-semibold text-neutral-800 dark:text-neutral-200 tracking-tight">{title}</h1>
      {description
        ? <p className="mt-3 max-w-md text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">{description}</p>
        : null}
      {children}
    </div>
  );
}

export interface ConversationScrollButtonProps {
  onClick?: () => void;
  visible?: boolean;
  className?: string;
}

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
        "absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-border bg-background p-2 shadow-lg transition-all hover:bg-muted",
        className,
      )}
    >
      <ArrowDownIcon className="size-4" />
    </button>
  );
}
