/**
 * DropdownMenu — BASIC fork of @radix-ui/react-dropdown-menu with the same API
 * shape (Root / Trigger / Content / Group / Item / ItemMeta / Separator /
 * Label). Classes are ported 1:1 from Studio's `DropdownMenu` (token names
 * remapped to veryfront's `[var(--token)]` vocabulary). Opens below the
 * trigger; dismisses on outside-click, `Escape`, and item select.
 *
 * TODO(a11y): roving focus + arrow-key navigation, typeahead, `Tab` handling,
 * portal + collision-aware positioning (flip/shift), `aria-activedescendant`,
 * RadioItem/CheckboxItem/Sub menus. Private to the chat module.
 *
 * @module react/components/chat/ui/dropdown-menu
 */
import * as React from "react";
import { cn } from "../theme.ts";
import { Slot } from "./slot.tsx";
import { Floating } from "./floating.tsx";

const MenuContext = React.createContext<
  {
    open: boolean;
    setOpen: (open: boolean) => void;
    anchorRef: React.RefObject<HTMLElement | null>;
  } | null
>(null);

/** Props accepted by `<DropdownMenu>`. */
export interface DropdownMenuProps {
  children: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** DropdownMenu root — owns open state and the positioning anchor. */
export function DropdownMenu({
  children,
  open,
  defaultOpen,
  onOpenChange,
}: DropdownMenuProps): React.ReactElement {
  const [internal, setInternal] = React.useState(defaultOpen ?? false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internal;
  const setOpen = React.useCallback((next: boolean) => {
    if (!isControlled) setInternal(next);
    onOpenChange?.(next);
  }, [isControlled, onOpenChange]);
  const anchorRef = React.useRef<HTMLElement | null>(null);
  return (
    <span ref={anchorRef} className="relative inline-block">
      <MenuContext.Provider value={{ open: isOpen, setOpen, anchorRef }}>
        {children}
      </MenuContext.Provider>
    </span>
  );
}

/** Trigger — toggles the menu. `asChild` merges onto the child element. */
export function DropdownMenuTrigger({
  children,
  asChild,
  onClick,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }):
  React.ReactElement {
  const ctx = React.useContext(MenuContext);
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      {...(asChild ? {} : { type: "button" as const })}
      aria-haspopup="menu"
      aria-expanded={ctx?.open}
      onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(e);
        ctx?.setOpen(!ctx.open);
      }}
      {...props}
    >
      {children}
    </Comp>
  );
}

/** Props accepted by `<DropdownMenuContent>`. */
export interface DropdownMenuContentProps
  extends React.HTMLAttributes<HTMLDivElement> {
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
  const ctx = React.useContext(MenuContext);
  if (!ctx) return null;
  return (
    <Floating
      anchorRef={ctx.anchorRef}
      open={ctx.open}
      align={align}
      onDismiss={() => ctx.setOpen(false)}
      role="menu"
      className={cn(
        "z-50 min-w-[260px] overflow-hidden rounded-lg bg-[var(--popover)] p-2.5 shadow-sm outline-none",
        className,
      )}
      {...props}
    >
      {children}
    </Floating>
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
export interface DropdownMenuItemProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
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
  const ctx = React.useContext(MenuContext);
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      {...(asChild ? {} : { type: "button" as const })}
      role="menuitem"
      aria-disabled={disabled || undefined}
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center gap-2.5 rounded-md px-3 h-[36px] text-base font-normal text-[var(--foreground)] outline-none transition-colors",
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
  return (
    <div className={cn("-mx-2.5 my-2 h-px bg-[var(--separator)]", className)} />
  );
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
