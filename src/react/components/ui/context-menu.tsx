/**
 * ContextMenu - a menu opened by right-click (the native `contextmenu` event) at
 * the pointer position, rather than by clicking a trigger button. It shares the
 * exact item / surface look of {@link ./dropdown-menu.tsx DropdownMenu} (classes
 * ported 1:1 from Studio, token names remapped to veryfront's `[var(--token)]`
 * vocabulary) and reuses the shared {@link ./floating.tsx Floating} portal +
 * fixed-positioning helper for dismissal (outside-click / `Escape`), scroll
 * following, viewport clamping, and portalling into the `[data-vf-ui]` token
 * scope. The only behavioural difference from DropdownMenu is the trigger: it
 * captures `onContextMenu`, calls `preventDefault()`, and opens the surface at
 * the pointer's `clientX` / `clientY` via a zero-size virtual anchor.
 *
 * A11y work (roving focus, typeahead, focus trap) is tracked in
 * anchored-surface.tsx and shared with the other menu surfaces.
 *
 * @example
 * ```tsx
 * <ContextMenu>
 *   <ContextMenuTrigger className="rounded-md border border-[var(--edge-medium)] p-8">
 *     Right-click here
 *   </ContextMenuTrigger>
 *   <ContextMenuContent>
 *     <ContextMenuLabel>Actions</ContextMenuLabel>
 *     <ContextMenuGroup>
 *       <ContextMenuItem onSelect={() => console.log("cut")}>Cut</ContextMenuItem>
 *       <ContextMenuItem onSelect={() => console.log("copy")}>Copy</ContextMenuItem>
 *     </ContextMenuGroup>
 *     <ContextMenuSeparator />
 *     <ContextMenuItem onSelect={() => console.log("delete")}>Delete</ContextMenuItem>
 *   </ContextMenuContent>
 * </ContextMenu>
 * ```
 *
 * @module react/components/ui/context-menu
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { Slot } from "./slot.tsx";
import { Floating } from "./floating.tsx";
import { type DisclosureOptions, useDisclosure } from "./disclosure.ts";

/** Context shared between a ContextMenu root and its parts. */
interface ContextMenuState {
  /** Whether the menu surface is currently open. */
  open: boolean;
  /** Set the open state (also fires `onOpenChange`). */
  setOpen: (open: boolean) => void;
  /** The zero-size virtual anchor `Floating` positions the surface against. */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Move the virtual anchor to `(x, y)` (viewport coords) and open. */
  openAt: (x: number, y: number) => void;
}

const ContextMenuContext = React.createContext<ContextMenuState | null>(null);

/** Props accepted by `<ContextMenu>`. */
export interface ContextMenuProps extends DisclosureOptions {
  /** The trigger and content parts to compose. */
  children: React.ReactNode;
}

/**
 * ContextMenu root - owns open state and the pointer position. Renders a
 * zero-size, `position: fixed` virtual anchor (kept inside the token scope so
 * the portalled surface resolves `var(--…)`), which `Floating` measures to place
 * the surface at the last right-click.
 */
export function ContextMenu(
  { children, open, defaultOpen, onOpenChange }: ContextMenuProps,
): React.ReactElement {
  const { open: isOpen, setOpen } = useDisclosure({ open, defaultOpen, onOpenChange });
  const anchorRef = React.useRef<HTMLElement | null>(null);
  const [pos, setPos] = React.useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const openAt = React.useCallback((x: number, y: number) => {
    setPos({ x, y });
    setOpen(true);
  }, [setOpen]);
  const ctx = React.useMemo<ContextMenuState>(
    () => ({ open: isOpen, setOpen, anchorRef, openAt }),
    [isOpen, setOpen, openAt],
  );
  return (
    <ContextMenuContext.Provider value={ctx}>
      <span
        ref={anchorRef as React.Ref<HTMLSpanElement>}
        aria-hidden="true"
        style={{
          position: "fixed",
          left: pos.x,
          top: pos.y,
          width: 0,
          height: 0,
          pointerEvents: "none",
        }}
      />
      {children}
    </ContextMenuContext.Provider>
  );
}

/** Props accepted by `<ContextMenuTrigger>`. */
export interface ContextMenuTriggerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Merge the trigger behaviour onto your own element instead of a wrapper `div`. */
  asChild?: boolean;
  /** React 19: ref is a regular prop, forwarded to the trigger node. */
  ref?: React.Ref<HTMLDivElement>;
}

/**
 * Trigger - the region a right-click opens the menu over. Captures
 * `onContextMenu`, calls `preventDefault()` (suppressing the browser's native
 * menu), and opens the surface at the pointer coordinates. `asChild` merges onto
 * the child element, which must forward `ref` to its DOM node.
 */
export function ContextMenuTrigger(
  { asChild, onContextMenu, children, ref, ...props }: ContextMenuTriggerProps,
): React.ReactElement {
  const ctx = React.useContext(ContextMenuContext);
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-state={ctx?.open ? "open" : "closed"}
      onContextMenu={(e: React.MouseEvent<HTMLDivElement>) => {
        onContextMenu?.(e);
        if (e.defaultPrevented) return;
        e.preventDefault();
        ctx?.openAt(e.clientX, e.clientY);
      }}
      {...props}
    >
      {children}
    </Comp>
  );
}

/** Props accepted by `<ContextMenuContent>`. */
export interface ContextMenuContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Horizontal edge of the surface aligned to the pointer. @default "start" */
  align?: "start" | "end";
  /** Consumer ref for the surface node (forwarded through `Floating`). */
  ref?: React.Ref<HTMLDivElement>;
}

/** Menu surface - portalled to the pointer position while open. No border (Studio). */
export function ContextMenuContent({
  children,
  className,
  align = "start",
  ref,
  ...props
}: ContextMenuContentProps): React.ReactElement | null {
  const ctx = React.useContext(ContextMenuContext);
  if (!ctx) return null;
  return (
    <Floating
      anchorRef={ctx.anchorRef}
      open={ctx.open}
      align={align}
      onDismiss={() => ctx.setOpen(false)}
      contentRef={ref}
      role="menu"
      className={cn(
        "z-50 min-w-[260px] overflow-hidden rounded-lg bg-[var(--popover)] p-2.5 text-[var(--foreground)] shadow-sm outline-none",
        className,
      )}
      {...props}
    >
      {children}
    </Floating>
  );
}

/** Groups related items with a tight inner gap (Studio: `gap-px p-0.5`). */
export function ContextMenuGroup(
  { children, className }: { children: React.ReactNode; className?: string },
): React.ReactElement {
  return (
    <div role="group" className={cn("flex flex-col gap-px p-0.5", className)}>
      {children}
    </div>
  );
}

/** Props accepted by `<ContextMenuItem>`. */
export interface ContextMenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Called when the item is chosen (also closes the menu). */
  onSelect?: () => void;
  /** `asChild` merges item styling onto your own element. */
  asChild?: boolean;
  /** Consumer ref for the item node. */
  ref?: React.Ref<HTMLButtonElement>;
}

/** A selectable menu item. Icons render at `size-3.5` (14px). Closes on select. */
export function ContextMenuItem({
  children,
  className,
  onSelect,
  onClick,
  disabled,
  asChild,
  ref,
  ...props
}: ContextMenuItemProps): React.ReactElement {
  const ctx = React.useContext(ContextMenuContext);
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      {...(asChild ? {} : { type: "button" as const })}
      ref={ref}
      role="menuitem"
      aria-disabled={disabled || undefined}
      disabled={disabled}
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

/** Full-width divider between groups (Studio: `-mx-2.5 my-2`). */
export function ContextMenuSeparator(
  { className }: { className?: string },
): React.ReactElement {
  return <div className={cn("-mx-2.5 my-2 h-px bg-[var(--separator)]", className)} />;
}

/** Non-interactive section label - full-strength foreground (Studio). */
export function ContextMenuLabel({
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
