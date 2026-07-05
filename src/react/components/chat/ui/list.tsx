/**
 * List — a lightweight primitive for vertical item lists: sidebars, thread
 * rails, nav groups, command results. Three parts:
 *
 * - `List`      — the container (tight vertical rhythm).
 * - `ListLabel` — an uppercase section heading (e.g. date groups: "Today").
 * - `ListItem`  — a row with padding / rounded / hover + active states, an
 *                 optional `description` line, and an optional trailing `action`
 *                 slot (revealed on hover, e.g. a "…" menu button).
 *
 * Colors use the chrome-surface hover token (`--accent`) — a subtle tint, not a
 * white fill — matching the Studio sidebar. Zero external deps. Built in
 * `chat/ui`; designed for a clean move to a top-level `/ui`.
 *
 * @module react/components/chat/ui/list
 */
import * as React from "react";
import { cn } from "../theme.ts";

/** Props accepted by {@link List}. */
export interface ListProps extends React.HTMLAttributes<HTMLDivElement> {
  ref?: React.Ref<HTMLDivElement>;
}

/** Vertical list container. */
export function List({ className, ref, ...props }: ListProps): React.ReactElement {
  return <div ref={ref} className={cn("space-y-0.5", className)} {...props} />;
}

/** Props accepted by {@link ListLabel}. */
export interface ListLabelProps extends React.HTMLAttributes<HTMLDivElement> {
  ref?: React.Ref<HTMLDivElement>;
}

/** Section heading — uppercase, faint. Use for date groups etc. */
export function ListLabel(
  { className, ref, ...props }: ListLabelProps,
): React.ReactElement {
  return (
    <div
      ref={ref}
      className={cn(
        "px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider text-[var(--faint)]",
        className,
      )}
      {...props}
    />
  );
}

/** Props accepted by {@link ListItem}. */
export interface ListItemProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** Primary line. Truncates. Omit to render `children` as the body instead. */
  title?: React.ReactNode;
  /** Optional secondary line under the title. Truncates. */
  description?: React.ReactNode;
  /** Highlight as the current/selected row. */
  active?: boolean;
  /**
   * Trailing slot — e.g. a "…" menu button. Hidden until row hover (or when
   * `active`). Its clicks don't bubble to the row's `onClick`.
   */
  action?: React.ReactNode;
  ref?: React.Ref<HTMLDivElement>;
}

/** A single list row. */
export function ListItem({
  title,
  description,
  active = false,
  action,
  className,
  children,
  ref,
  ...props
}: ListItemProps): React.ReactElement {
  return (
    <div
      ref={ref}
      data-active={active || undefined}
      className={cn(
        "group/li flex items-center gap-1 rounded-[var(--radius-sm)] px-2.5 py-1.5 transition-colors",
        props.onClick && "cursor-pointer",
        active
          ? "bg-[var(--accent)] text-[var(--foreground)]"
          : "text-[var(--soft)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
        className,
      )}
      {...props}
    >
      <div className="min-w-0 flex-1">
        {title !== undefined
          ? (
            <>
              <div className="truncate text-[13px] leading-snug">{title}</div>
              {description !== undefined && (
                <div className="truncate text-xs leading-snug text-[var(--faint)]">
                  {description}
                </div>
              )}
            </>
          )
          : children}
      </div>
      {action !== undefined && (
        <div
          className={cn(
            "shrink-0 transition-opacity",
            active
              ? "opacity-100"
              : "opacity-0 group-hover/li:opacity-100 focus-within:opacity-100",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {action}
        </div>
      )}
    </div>
  );
}
