/**
 * Dependency-free anchored menu with the Studio part API used by Veryfront.
 * It provides menu ARIA wiring, roving keyboard navigation, typeahead, focus
 * restoration, collision-aware positioning, and outside/Escape dismissal.
 *
 * @module react/components/ui/dropdown-menu
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { Slot } from "./slot.tsx";
import { createAnchoredSurfaceParts } from "./anchored-surface.tsx";
import { focusWithoutScroll, getFocusableElements } from "./focus-management.ts";

const TYPEAHEAD_RESET_MS = 700;

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
export function DropdownMenuTrigger(
  props:
    & React.ButtonHTMLAttributes<HTMLButtonElement>
    & { asChild?: boolean; ref?: React.Ref<HTMLButtonElement> },
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
  onKeyDown,
  ...props
}: DropdownMenuContentProps): React.ReactElement | null {
  const ctx = React.useContext(_ctx);
  if (!ctx) {
    throw new Error("DropdownMenuContent must be used within <DropdownMenu>");
  }
  const typeaheadRef = React.useRef({ buffer: "", lastTypedAt: 0 });

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    onKeyDown?.(event);
    if (
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229
    ) {
      return;
    }

    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(
      "[role='menuitem']:not([aria-disabled='true'])",
    )];
    const activeIndex = items.indexOf(
      event.currentTarget.ownerDocument.activeElement as HTMLElement,
    );
    const focusAt = (index: number): void => {
      const item = items[(index + items.length) % items.length];
      if (item) focusWithoutScroll(item);
    };

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusAt(activeIndex + 1);
        return;
      case "ArrowUp":
        event.preventDefault();
        focusAt(activeIndex < 0 ? items.length - 1 : activeIndex - 1);
        return;
      case "Home":
        event.preventDefault();
        focusAt(0);
        return;
      case "End":
        event.preventDefault();
        focusAt(items.length - 1);
        return;
      case "Tab": {
        event.preventDefault();
        const trigger = ctx.triggerRef.current;
        const document = event.currentTarget.ownerDocument;
        const candidates = getFocusableElements(document.body).filter((element) =>
          !event.currentTarget.contains(element)
        );
        const triggerIndex = trigger ? candidates.indexOf(trigger) : -1;
        const next = event.shiftKey ? candidates[triggerIndex - 1] : candidates[triggerIndex + 1];
        ctx.setOpen(false);
        queueMicrotask(() => {
          if (next?.isConnected) focusWithoutScroll(next);
          else if (trigger?.isConnected) focusWithoutScroll(trigger);
        });
        return;
      }
    }

    if (
      event.key.length !== 1 || event.altKey || event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }
    const now = Date.now();
    const previous = typeaheadRef.current;
    const buffer = now - previous.lastTypedAt > TYPEAHEAD_RESET_MS
      ? event.key
      : previous.buffer + event.key;
    typeaheadRef.current = { buffer, lastTypedAt: now };
    const normalizedBuffer = buffer.normalize("NFKC").toLocaleLowerCase();
    const repeatedCharacter = [...normalizedBuffer].every((character) =>
      character === normalizedBuffer[0]
    );
    const query = repeatedCharacter ? normalizedBuffer[0]! : normalizedBuffer;
    for (let offset = 1; offset <= items.length; offset += 1) {
      const item = items[(activeIndex + offset + items.length) % items.length];
      const text = item?.textContent?.normalize("NFKC").trim()
        .replace(/\s+/g, " ").toLocaleLowerCase();
      if (item && text?.startsWith(query)) {
        event.preventDefault();
        focusWithoutScroll(item);
        break;
      }
    }
  };

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
  if (!ctx) {
    throw new Error("DropdownMenuItem must be used within <DropdownMenu>");
  }
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      {...props}
      {...(asChild ? {} : { type: "button" as const })}
      role="menuitem"
      aria-disabled={disabled || undefined}
      disabled={disabled}
      tabIndex={-1}
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center gap-2.5 rounded-md px-3 h-[36px] text-base font-normal text-left text-[var(--foreground)] outline-none transition-colors",
        "hover:bg-[var(--tertiary)] focus:bg-[var(--tertiary)] dark:hover:bg-[var(--accent)] dark:focus:bg-[var(--accent)]",
        "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0",
        className,
      )}
      onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
        if (disabled) return;
        onClick?.(e);
        if (e.defaultPrevented) return;
        onSelect?.();
        ctx.setOpen(false);
        const trigger = ctx.triggerRef.current;
        queueMicrotask(() => {
          if (trigger?.isConnected) focusWithoutScroll(trigger);
        });
      }}
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
