/**
 * Dependency-free anchored menu with the Studio part API used by Veryfront.
 * It provides menu ARIA wiring, roving keyboard navigation, typeahead, focus
 * restoration, collision-aware positioning, and outside/Escape dismissal.
 *
 * @module react/components/ui/dropdown-menu
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { getPolymorphicButtonType, type PolymorphicButtonAttributes, Slot } from "./slot.tsx";
import {
  type AnchoredSlottedTriggerProps,
  type AnchoredTriggerPublicProps,
  createAnchoredSurfaceParts,
} from "./anchored-surface.tsx";
import { focusWithoutScroll } from "./focus-management.ts";
import { useMenuContentKeyboard } from "./menu-keyboard.ts";

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

/**
 * Trigger — toggles the menu; the positioning anchor. `asChild` merges onto
 * the child element, which must forward `ref` to its DOM node.
 */
export interface DropdownMenuTriggerProps extends AnchoredTriggerPublicProps {}

/** Literal slotted trigger contract with an element-specific ref. */
export type DropdownMenuSlottedTriggerProps<T extends HTMLElement = HTMLElement> =
  AnchoredSlottedTriggerProps<T>;

export function DropdownMenuTrigger<T extends HTMLElement = HTMLElement>(
  props: DropdownMenuSlottedTriggerProps<T>,
): React.ReactElement;
export function DropdownMenuTrigger(props: DropdownMenuTriggerProps): React.ReactElement;
export function DropdownMenuTrigger<T extends HTMLElement = HTMLElement>(
  props: DropdownMenuTriggerProps | DropdownMenuSlottedTriggerProps<T>,
): React.ReactElement {
  return <_Trigger {...props} haspopup="menu" />;
}

/** Props accepted by `<DropdownMenuContent>`. */
export interface DropdownMenuContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Horizontal alignment relative to the trigger. */
  align?: "start" | "end";
  /** Consumer ref for the rendered menu surface. */
  ref?: React.Ref<HTMLDivElement>;
}

/** Menu surface — rendered below the trigger while open. No border (Studio). */
export function DropdownMenuContent({
  children,
  className,
  align = "start",
  onKeyDown,
  ...props
}: DropdownMenuContentProps): React.ReactElement | null {
  const ctx = React.useContext(_ctx);
  if (!ctx) {
    throw new Error("DropdownMenuContent must be used within <DropdownMenu>");
  }
  const handleKeyDown = useMenuContentKeyboard({
    onKeyDown,
    setOpen: ctx.setOpen,
    triggerRef: ctx.triggerRef,
  });

  return (
    <_Content
      {...props}
      role="menu"
      aria-orientation="vertical"
      align={align}
      initialFocus="[role='menuitem']:not([aria-disabled='true'])"
      onKeyDown={handleKeyDown}
      className={cn("min-w-[260px] p-2.5", className)}
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

/**
 * Backward-compatible props accepted by `<DropdownMenuItem>`.
 *
 * Keep this as an interface with a broad boolean `asChild` so existing wrapper
 * interfaces, conditional `asChild` values, and prop spreads remain valid.
 * The component overload below adds the element-specific contract for callers
 * that opt into a literal `asChild` value.
 */
export interface DropdownMenuItemProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onSelect"> {
  /** Called when the item is chosen (also closes the menu). */
  onSelect?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /** `asChild` merges item styling and behavior onto one child element. */
  asChild?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}

/** Slotted-element props accepted by `<DropdownMenuItem>`. */
export type DropdownMenuSlottedItemProps<T extends HTMLElement = HTMLElement> =
  & Omit<PolymorphicButtonAttributes<T>, "children" | "ref" | "type">
  & {
    /** Called when the item is chosen (also closes the menu). */
    onSelect?: (event: React.MouseEvent<T>) => void;
    /** Merge menu-item behavior and styling onto one custom child element. */
    asChild: true;
    children: React.ReactElement;
    disabled?: boolean;
    /** Applied only when `children` is an intrinsic `<button>`; opaque buttons own `type`. */
    type?: T extends HTMLButtonElement ? React.ButtonHTMLAttributes<HTMLButtonElement>["type"]
      : never;
    ref?: React.Ref<T>;
  };

function ownsKeyboardActivation(element: HTMLElement, key: "Enter" | " "): boolean {
  const tagName = element.tagName;
  if (tagName === "BUTTON") return true;
  return key === "Enter" && tagName === "A" && element.hasAttribute("href");
}

/** A selectable menu item. Icons render at `size-3.5` (14px). */
export function DropdownMenuItem<T extends HTMLElement = HTMLElement>(
  props: DropdownMenuSlottedItemProps<T>,
): React.ReactElement;
export function DropdownMenuItem(props: DropdownMenuItemProps): React.ReactElement;
export function DropdownMenuItem<T extends HTMLElement = HTMLElement>({
  children,
  className,
  onSelect,
  onClick,
  onKeyDown,
  disabled,
  asChild,
  ref,
  type,
  ...props
}: DropdownMenuItemProps | DropdownMenuSlottedItemProps<T>): React.ReactElement {
  const ctx = React.useContext(_ctx);
  if (!ctx) {
    throw new Error("DropdownMenuItem must be used within <DropdownMenu>");
  }
  const itemClassName = cn(
    "relative flex w-full cursor-pointer select-none items-center gap-2.5 rounded-md px-3 h-[36px] text-base font-normal text-left text-[var(--foreground)] outline-none transition-colors",
    "hover:bg-[var(--tertiary)] focus:bg-[var(--tertiary)] dark:hover:bg-[var(--accent)] dark:focus:bg-[var(--accent)]",
    "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0",
    className,
  );
  const handleClick = (event: React.MouseEvent<HTMLElement>): void => {
    if (disabled) return;
    (onClick as React.MouseEventHandler<HTMLElement> | undefined)?.(event);
    if (event.defaultPrevented) return;
    (onSelect as ((event: React.MouseEvent<HTMLElement>) => void) | undefined)?.(event);
    ctx.setOpen(false);
    const trigger = ctx.triggerRef.current;
    queueMicrotask(() => {
      if (trigger?.isConnected) focusWithoutScroll(trigger);
    });
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (disabled) return;
    (onKeyDown as React.KeyboardEventHandler<HTMLElement> | undefined)?.(event);
    if (
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229 ||
      (event.key !== "Enter" && event.key !== " ") ||
      ownsKeyboardActivation(event.currentTarget, event.key)
    ) {
      return;
    }
    event.preventDefault();
    event.currentTarget.click();
  };
  const itemStateProps = {
    role: "menuitem",
    "aria-disabled": disabled || undefined,
    disabled,
    tabIndex: -1,
    className: itemClassName,
    onClick: handleClick,
    onKeyDown: handleKeyDown,
  } as const;
  if (asChild) {
    return (
      <Slot
        {...(props as React.HTMLAttributes<HTMLElement>)}
        {...itemStateProps}
        type={getPolymorphicButtonType(true, children, type)}
        ref={ref as React.Ref<HTMLElement>}
      >
        {children}
      </Slot>
    );
  }
  return (
    <button
      {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)}
      {...itemStateProps}
      type="button"
      ref={ref as React.Ref<HTMLButtonElement>}
    >
      {children}
    </button>
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
    <div
      role="separator"
      className={cn("-mx-2.5 my-2 h-px bg-[var(--separator)]", className)}
    />
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
      role="presentation"
      className={cn(
        "px-3 py-1.5 mb-0.5 text-sm font-medium text-[var(--foreground)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
