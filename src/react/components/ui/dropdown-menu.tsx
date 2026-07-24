/**
 * DropdownMenu — BASIC fork of @radix-ui/react-dropdown-menu with the same API
 * shape (Root / Trigger / Content / Group / Item / ItemMeta / Separator /
 * Label). Classes are ported 1:1 from Studio's `DropdownMenu` (token names
 * remapped to veryfront's `[var(--token)]` vocabulary). Opens below the
 * trigger; dismisses on outside-click, `Escape`, and item select. A11y work
 * tracked in anchored-surface.tsx.
 *
 * @module react/components/ui/dropdown-menu
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { Slot } from "./slot.tsx";
import { createAnchoredSurfaceParts } from "./anchored-surface.tsx";

// Per-skin context + machinery -- distinct from Popover's instance so a
// Popover nested inside a DropdownMenu cannot accidentally close the menu.
const { Context: _ctx, AnchoredRoot: _Root, AnchoredTrigger: _Trigger, AnchoredContent: _Content } =
  createAnchoredSurfaceParts();

/** Props accepted by `<DropdownMenu>`. */
export interface DropdownMenuProps {
  children: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** DropdownMenu root — owns open state and the positioning anchor. */
export function DropdownMenu(props: DropdownMenuProps): React.ReactElement {
  return <_Root {...props} />;
}

/** Trigger — toggles the menu. `asChild` merges onto the child element. */
export function DropdownMenuTrigger(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean },
): React.ReactElement {
  return <_Trigger {...props} haspopup="menu" />;
}

/** Props accepted by `<DropdownMenuContent>`. */
export interface DropdownMenuContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Horizontal alignment relative to the trigger. */
  align?: "start" | "end";
}

/** Menu surface — rendered below the trigger while open. No border (Studio). */
export function DropdownMenuContent({
  children,
  className,
  align = "start",
  ...props
}: DropdownMenuContentProps): React.ReactElement | null {
  return (
    <_Content
      role="menu"
      align={align}
      className={cn("min-w-[260px] p-2.5", className)}
      {...props}
    >
      {children}
    </_Content>
  );
}

/** Groups related items with a tight inner gap (Studio: `gap-px p-0.5`). */
export function DropdownMenuGroup(
  { children, className }: { children: React.ReactNode; className?: string },
): React.ReactElement {
  return (
    <div role="group" className={cn("flex flex-col gap-px p-0.5", className)}>
      {children}
    </div>
  );
}

/** Props accepted by `<DropdownMenuItem>`. */
export interface DropdownMenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Called when the item is chosen (also closes the menu). */
  onSelect?: () => void;
  /** `asChild` merges item styling onto your own element. */
  asChild?: boolean;
}

/** A selectable menu item. Icons render at `size-3.5` (14px). */
export function DropdownMenuItem({
  children,
  className,
  onSelect,
  onClick,
  disabled,
  asChild,
  ...props
}: DropdownMenuItemProps): React.ReactElement {
  const ctx = React.useContext(_ctx);
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      {...(asChild ? {} : { type: "button" as const })}
      role="menuitem"
      aria-disabled={disabled || undefined}
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center gap-2.5 rounded-md px-3 h-[36px] text-base font-normal text-left text-[var(--foreground)] outline-none transition-colors",
        "hover:bg-[var(--tertiary)] focus:bg-[var(--tertiary)] dark:hover:bg-[var(--accent)] dark:focus:bg-[var(--accent)]",
        "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0",
        className,
      )}
      onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
        if (disabled) return;
        onClick?.(e);
        onSelect?.();
        ctx?.setOpen(false);
      }}
      {...props}
    >
      {children}
    </Comp>
  );
}

/** Trailing metadata text — keyboard shortcuts, counts, badges. */
export function DropdownMenuItemMeta({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <span
      className={cn(
        "ml-auto text-xs text-[var(--foreground)] opacity-60",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Full-width divider between groups (Studio: `-mx-2.5 my-2`). */
export function DropdownMenuSeparator(
  { className }: { className?: string },
): React.ReactElement {
  return <div className={cn("-mx-2.5 my-2 h-px bg-[var(--separator)]", className)} />;
}

/** Non-interactive section label — full-strength foreground (Studio). */
export function DropdownMenuLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div
      className={cn(
        "px-3 py-1.5 mb-0.5 text-sm font-medium text-[var(--foreground)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
