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
 * white fill — matching the Studio sidebar. Zero external deps.
 *
 * @module react/components/ui/list
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";

// A WeakSet keeps event provenance stable even if an activation synchronously
// unmounts its button before the already-collected ancestor click runs.
const primaryActionElements = new WeakSet<EventTarget>();

function eventCameFromPrimaryAction(
  event: React.MouseEvent<HTMLDivElement>,
): boolean {
  const composedPath = event.nativeEvent.composedPath;
  if (typeof composedPath === "function") {
    return composedPath.call(event.nativeEvent).some((target) => primaryActionElements.has(target));
  }

  // Older DOM implementations do not expose composedPath(). Retain the same
  // provenance check by walking from the original target. This also works when
  // the primary button synchronously unmounts before the row handler runs,
  // because the detached target keeps its ancestry inside the detached button.
  let target: EventTarget | null = event.target;
  while (target) {
    if (primaryActionElements.has(target)) return true;
    target = (target as EventTarget & { parentNode?: EventTarget | null })
      .parentNode ?? null;
  }
  return false;
}

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

/**
 * Props accepted by {@link ListItem}. Standalone clickable rows receive button
 * semantics and keyboard activation by default. Rows with a trailing action
 * should use `onActivate` so both controls have native, sibling semantics.
 */
export interface ListItemProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** Primary line. Truncates. Omit to render `children` as the body instead. */
  title?: React.ReactNode;
  /** Optional secondary line under the title. Truncates. */
  description?: React.ReactNode;
  /** Highlight as the current/selected row. */
  active?: boolean;
  /**
   * Render the row's primary action as a native button. Prefer this to
   * `onClick` when the row also has a trailing `action`, so the controls remain
   * siblings in the accessibility tree.
   */
  onActivate?: React.MouseEventHandler<HTMLButtonElement>;
  /** Native-button attributes for the primary action rendered by `onActivate`. */
  primaryActionProps?: Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    "children" | "dangerouslySetInnerHTML" | "onClick" | "type"
  >;
  /** Ref for the native primary-action button. The root `ref` remains the row div. */
  primaryActionRef?: React.Ref<HTMLButtonElement>;
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
  onActivate,
  primaryActionProps,
  primaryActionRef,
  role,
  tabIndex,
  onClick,
  onKeyDown,
  onKeyUp,
  onBlur,
  ...props
}: ListItemProps): React.ReactElement {
  const spacePressedRef = React.useRef(false);
  const primaryActionElementRef = React.useRef<HTMLButtonElement>(null);
  const primaryActionCleanupRef = React.useRef<(() => void) | undefined>(
    undefined,
  );
  const primaryActionAttachedRef = React.useRef(false);
  const rendersPrimaryAction = typeof onActivate === "function";
  const isLegacyClickable = typeof onClick === "function";
  const hasLegacyButtonSemantics = isLegacyClickable &&
    !rendersPrimaryAction &&
    (role === "button" || (role === undefined && action === undefined));
  const {
    className: primaryActionClassName,
    ...primaryButtonProps
  } = primaryActionProps ?? {};

  const setPrimaryActionRef = React.useCallback(
    (node: HTMLButtonElement | null) => {
      primaryActionElementRef.current = node;
      if (node) primaryActionElements.add(node);

      if (node === null) {
        if (!primaryActionAttachedRef.current) return;
        primaryActionAttachedRef.current = false;
        const cleanup = primaryActionCleanupRef.current;
        primaryActionCleanupRef.current = undefined;
        if (cleanup) cleanup();
        else if (typeof primaryActionRef === "function") primaryActionRef(null);
        else if (primaryActionRef) primaryActionRef.current = null;
        return;
      }

      primaryActionAttachedRef.current = true;
      if (typeof primaryActionRef === "function") {
        const result = primaryActionRef(node);
        primaryActionCleanupRef.current = typeof result === "function" ? result : undefined;
      } else if (primaryActionRef) {
        primaryActionRef.current = node;
      }
    },
    [primaryActionRef],
  );

  function handleClick(event: React.MouseEvent<HTMLDivElement>): void {
    const primaryActionElement = primaryActionElementRef.current;
    if (eventCameFromPrimaryAction(event)) {
      return;
    }
    if (onClick) onClick(event);
    else primaryActionElement?.click();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const isOwnButtonEvent = hasLegacyButtonSemantics &&
      event.target === event.currentTarget;
    const isSpace = isOwnButtonEvent && event.key === " ";
    if (isSpace) spacePressedRef.current = true;

    onKeyDown?.(event);
    if (event.defaultPrevented || !isOwnButtonEvent) {
      if (isSpace) spacePressedRef.current = false;
      return;
    }

    const nativeEvent = event.nativeEvent;
    if (nativeEvent.isComposing || event.keyCode === 229) {
      if (isSpace) spacePressedRef.current = false;
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.click();
    } else if (event.key === " ") {
      // Match a native button: block page scrolling on keydown, then activate
      // on keyup so moving focus away cancels the pending activation.
      event.preventDefault();
    }
  }

  function handleKeyUp(event: React.KeyboardEvent<HTMLDivElement>): void {
    onKeyUp?.(event);
    if (event.key !== " ") return;

    const shouldActivate = spacePressedRef.current &&
      event.target === event.currentTarget;
    spacePressedRef.current = false;
    if (
      event.defaultPrevented ||
      !hasLegacyButtonSemantics ||
      event.nativeEvent.isComposing ||
      event.keyCode === 229 ||
      !shouldActivate
    ) {
      return;
    }

    event.preventDefault();
    event.currentTarget.click();
  }

  function handleBlur(event: React.FocusEvent<HTMLDivElement>): void {
    spacePressedRef.current = false;
    onBlur?.(event);
  }

  const primaryContent = title !== undefined
    ? (
      <>
        <span className="block truncate text-[13px] leading-snug">{title}</span>
        {description !== undefined && (
          <span className="block truncate text-xs leading-snug text-[var(--faint)]">
            {description}
          </span>
        )}
      </>
    )
    : children;

  return (
    <div
      {...props}
      ref={ref}
      data-active={active || undefined}
      role={role ??
        (rendersPrimaryAction && action !== undefined
          ? "group"
          : (hasLegacyButtonSemantics ? "button" : undefined))}
      tabIndex={tabIndex ?? (hasLegacyButtonSemantics ? 0 : undefined)}
      onClick={onClick || rendersPrimaryAction ? handleClick : undefined}
      onKeyDown={onKeyDown || hasLegacyButtonSemantics ? handleKeyDown : undefined}
      onKeyUp={onKeyUp || hasLegacyButtonSemantics ? handleKeyUp : undefined}
      onBlur={onBlur || hasLegacyButtonSemantics ? handleBlur : undefined}
      className={cn(
        "group/li flex items-center gap-1 rounded-[var(--radius-sm)] px-2.5 py-1.5 transition-colors",
        (isLegacyClickable || rendersPrimaryAction) && "cursor-pointer",
        hasLegacyButtonSemantics &&
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]",
        active
          ? "bg-[var(--accent)] text-[var(--foreground)]"
          : "text-[var(--soft)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
        className,
      )}
    >
      {rendersPrimaryAction
        ? (
          <button
            {...primaryButtonProps}
            ref={setPrimaryActionRef}
            type="button"
            onClick={onActivate}
            className={cn(
              "min-w-0 flex-1 appearance-none rounded-[var(--radius-sm)] border-0 bg-transparent p-0 text-left font-[inherit] text-[inherit]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]",
              "disabled:cursor-not-allowed disabled:opacity-50",
              primaryActionClassName,
            )}
          >
            {primaryContent}
          </button>
        )
        : (
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
        )}
      {action !== undefined && (
        <div
          role="presentation"
          className={cn(
            "shrink-0 transition-opacity",
            active
              ? "opacity-100"
              : "opacity-0 group-hover/li:opacity-100 group-focus-within/li:opacity-100 focus-within:opacity-100",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {action}
        </div>
      )}
    </div>
  );
}
