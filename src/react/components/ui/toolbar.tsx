/**
 * Toolbar — a `role="toolbar"` container that groups related controls (icon
 * buttons, links, separators) and shares a single tab stop. Focus moves between
 * items with the arrow keys (Left/Right when horizontal, Up/Down when vertical),
 * with Home/End jumping to the first/last item — a roving-tabindex pattern where
 * only one item is tabbable at a time. Self-contained (no floating engine);
 * skinned with the veryfront theme tokens.
 *
 * @example
 * ```tsx
 * import { Toolbar, ToolbarButton, ToolbarSeparator } from "veryfront/ui";
 *
 * <Toolbar aria-label="Text formatting">
 *   <ToolbarButton aria-label="Bold">B</ToolbarButton>
 *   <ToolbarButton aria-label="Italic">I</ToolbarButton>
 *   <ToolbarSeparator />
 *   <ToolbarButton aria-label="Link">↗</ToolbarButton>
 * </Toolbar>;
 * ```
 *
 * @module react/components/ui/toolbar
 */
import * as React from "react";
import { cva, cx as cn } from "./cva.ts";

export const toolbarVariants = cva(
  "inline-flex gap-1 rounded-md border border-[var(--border)] bg-[var(--background)] p-1",
  {
    variants: {
      orientation: {
        horizontal: "flex-row items-center",
        vertical: "flex-col items-stretch",
      },
    },
    defaultVariants: { orientation: "horizontal" },
  },
);

/** All focusable items the toolbar governs, in DOM order. */
function toolbarItems(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-toolbar-item]"));
}

/** Toolbar items that can currently take focus (not disabled). */
function enabledItems(root: HTMLElement): HTMLElement[] {
  return toolbarItems(root).filter(
    (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-disabled") !== "true",
  );
}

/** Props accepted by `<Toolbar>`. */
export interface ToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Layout + arrow-key axis. `horizontal` uses Left/Right; `vertical` uses Up/Down. @default "horizontal" */
  orientation?: "horizontal" | "vertical";
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** A container that groups controls behind one tab stop with roving focus. */
export function Toolbar({
  orientation = "horizontal",
  className,
  children,
  onKeyDown,
  ref,
  ...props
}: ToolbarProps): React.ReactElement {
  const innerRef = React.useRef<HTMLDivElement | null>(null);

  const setRef = React.useCallback((node: HTMLDivElement | null) => {
    innerRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) (ref as React.RefObject<HTMLDivElement | null>).current = node;
  }, [ref]);

  // Roving tabindex: exactly one item (the first enabled) is tabbable; re-run on
  // every render so the resting state survives item add/remove/enable changes.
  React.useLayoutEffect(() => {
    const root = innerRef.current;
    if (!root) return;
    const items = enabledItems(root);
    items.forEach((el, i) => {
      el.tabIndex = i === 0 ? 0 : -1;
    });
  });

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    const root = innerRef.current;
    if (!root) return;
    const items = enabledItems(root);
    if (items.length === 0) return;

    const nextKey = orientation === "vertical" ? "ArrowDown" : "ArrowRight";
    const prevKey = orientation === "vertical" ? "ArrowUp" : "ArrowLeft";
    const current = items.indexOf(root.ownerDocument.activeElement as HTMLElement);

    let nextIndex: number;
    if (event.key === nextKey) nextIndex = current < 0 ? 0 : (current + 1) % items.length;
    else if (event.key === prevKey) {
      nextIndex = current < 0 ? 0 : (current - 1 + items.length) % items.length;
    } else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    else return;

    event.preventDefault();
    const next = items[nextIndex];
    if (!next) return;
    items.forEach((el) => {
      el.tabIndex = el === next ? 0 : -1;
    });
    next.focus();
  };

  return (
    <div
      ref={setRef}
      role="toolbar"
      aria-orientation={orientation}
      data-orientation={orientation}
      onKeyDown={handleKeyDown}
      className={cn(toolbarVariants({ orientation }), className)}
      {...props}
    >
      {children}
    </div>
  );
}

/** Props accepted by `<ToolbarButton>`. */
export interface ToolbarButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLButtonElement>;
}

/** A ghost icon button that participates in the toolbar's roving focus. */
export function ToolbarButton({
  className,
  ref,
  ...props
}: ToolbarButtonProps): React.ReactElement {
  return (
    <button
      ref={ref}
      type="button"
      data-toolbar-item=""
      className={cn(
        "inline-flex h-8 min-w-8 items-center justify-center rounded-sm px-2 text-sm",
        "text-[var(--foreground)] transition-colors",
        "hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
        "disabled:pointer-events-none disabled:opacity-50",
        "[&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

/** Props accepted by `<ToolbarLink>`. */
export interface ToolbarLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLAnchorElement>;
}

/** An anchor styled like a {@link ToolbarButton} that joins the roving focus. */
export function ToolbarLink({
  className,
  ref,
  ...props
}: ToolbarLinkProps): React.ReactElement {
  return (
    <a
      ref={ref}
      data-toolbar-item=""
      className={cn(
        "inline-flex h-8 min-w-8 items-center justify-center rounded-sm px-2 text-sm",
        "text-[var(--foreground)] no-underline transition-colors",
        "hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
        "[&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

/** Props accepted by `<ToolbarSeparator>`. */
export interface ToolbarSeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Rule direction — `vertical` divides a horizontal toolbar and vice versa. @default "vertical" */
  orientation?: "horizontal" | "vertical";
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** A thin rule dividing groups of items within a toolbar. */
export function ToolbarSeparator({
  orientation = "vertical",
  className,
  ref,
  ...props
}: ToolbarSeparatorProps): React.ReactElement {
  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation={orientation}
      data-orientation={orientation}
      className={cn(
        "shrink-0 bg-[var(--border)]",
        orientation === "vertical" ? "mx-0.5 w-px self-stretch" : "my-0.5 h-px w-full",
        className,
      )}
      {...props}
    />
  );
}
