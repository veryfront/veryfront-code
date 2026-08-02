/**
 * Toolbar: a `role="toolbar"` container that groups related controls (icon
 * buttons, links, separators) and shares a single tab stop. Focus moves between
 * items with the arrow keys (Left/Right when horizontal, Up/Down when vertical),
 * with Home/End jumping to the first/last item: a roving-tabindex pattern where
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
import { useAdapter } from "./adapter/context.tsx";

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

/** Props accepted by `<Toolbar>`. */
export interface ToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Layout + arrow-key axis. `horizontal` uses Left/Right; `vertical` uses Up/Down. @default "horizontal" */
  orientation?: "horizontal" | "vertical";
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/**
 * A container that groups controls behind one tab stop with roving focus. The
 * roving MECHANICS come from the active adapter's `toolbar` slot
 * (`useAdapter().toolbar`): builtin by default, swappable via `UIAdapterProvider`.
 */
export function Toolbar(
  { orientation = "horizontal", className, children, ...props }: ToolbarProps,
): React.ReactElement {
  const { toolbar } = useAdapter();
  return (
    <toolbar.Root
      orientation={orientation}
      className={cn(toolbarVariants({ orientation }), className)}
      {...props}
    >
      {children}
    </toolbar.Root>
  );
}

/** Props accepted by `<ToolbarButton>`. */
export interface ToolbarButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLButtonElement>;
}

/** A ghost icon button that participates in the toolbar's roving focus. */
export function ToolbarButton({ className, ...props }: ToolbarButtonProps): React.ReactElement {
  const { toolbar } = useAdapter();
  return (
    <toolbar.Item
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
  /** Remove the link from roving focus and suppress every activation path. */
  disabled?: boolean;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLAnchorElement>;
}

/** An anchor styled like a {@link ToolbarButton} that joins the roving focus. */
export function ToolbarLink(
  { className, disabled = false, ...props }: ToolbarLinkProps,
): React.ReactElement {
  const { toolbar } = useAdapter();
  return (
    <toolbar.Item
      asChild
      disabled={disabled}
      className={cn(
        "inline-flex h-8 min-w-8 items-center justify-center rounded-sm px-2 text-sm",
        "text-[var(--foreground)] no-underline transition-colors",
        "hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
        "aria-disabled:pointer-events-none aria-disabled:opacity-50",
        "[&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
    >
      <a {...props} />
    </toolbar.Item>
  );
}

/** Props accepted by `<ToolbarSeparator>`. */
export interface ToolbarSeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Rule direction: `vertical` divides a horizontal toolbar and vice versa. @default "vertical" */
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
