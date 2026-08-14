/**
 * Menubar - a horizontal bar of menu buttons (like a desktop app's
 * File / Edit / View). Each `MenubarMenu` is a `DropdownMenu` instance, so the
 * dropdown surface, outside-click / `Escape` dismissal, and token-scoped
 * portalling are all inherited unchanged. Menubar adds the horizontal bar
 * container, `role="menubar"`, and roving focus between the top-level triggers:
 * `ArrowRight` / `ArrowLeft` move focus (and carry an open menu) across
 * triggers, `Home` / `End` jump to the ends. Only one menu is open at a time -
 * the bar owns that state. Skinned entirely with veryfront theme tokens.
 *
 * @example
 * ```tsx
 * import {
 *   Menubar,
 *   MenubarContent,
 *   MenubarItem,
 *   MenubarMenu,
 *   MenubarSeparator,
 *   MenubarTrigger,
 * } from "veryfront/ui";
 *
 * function AppMenubar() {
 *   return (
 *     <Menubar>
 *       <MenubarMenu>
 *         <MenubarTrigger>File</MenubarTrigger>
 *         <MenubarContent>
 *           <MenubarItem onSelect={() => console.log("new")}>New</MenubarItem>
 *           <MenubarItem onSelect={() => console.log("open")}>Open…</MenubarItem>
 *           <MenubarSeparator />
 *           <MenubarItem onSelect={() => console.log("save")}>Save</MenubarItem>
 *         </MenubarContent>
 *       </MenubarMenu>
 *       <MenubarMenu>
 *         <MenubarTrigger>Edit</MenubarTrigger>
 *         <MenubarContent>
 *           <MenubarItem onSelect={() => console.log("undo")}>Undo</MenubarItem>
 *           <MenubarItem onSelect={() => console.log("redo")}>Redo</MenubarItem>
 *         </MenubarContent>
 *       </MenubarMenu>
 *     </Menubar>
 *   );
 * }
 * ```
 *
 * @module react/components/ui/menubar
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { composeRefs } from "./slot.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  type DropdownMenuContentProps,
  DropdownMenuItem,
  type DropdownMenuItemProps,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu.tsx";

/** Bar-level state shared from `Menubar` down to every trigger. */
interface MenubarState {
  /** Value of the menu that is currently open, or `null` when all are closed. */
  openValue: string | null;
  /** Open the menu with `value` (or close all with `null`). */
  setOpenValue: (value: string | null) => void;
  /** Value of the trigger that is roving-tabbable (`tabIndex=0`). */
  focusedValue: string | null;
  /** Mark `value` as the roving-tabbable trigger. */
  setFocusedValue: (value: string | null) => void;
  /** Adopt `value` as the initial roving trigger if none has been chosen yet. */
  registerFirst: (value: string) => void;
  /** Move focus `offset` triggers from `current` (wrapping), carrying an open menu. */
  focusByOffset: (current: HTMLElement, offset: number | "first" | "last") => void;
}

const MenubarContext = React.createContext<MenubarState | null>(null);
/** Per-menu context carrying the stable value that links a trigger to its menu. */
const MenubarMenuContext = React.createContext<string | null>(null);

function useMenubarContext(part: string): MenubarState {
  const ctx = React.useContext(MenubarContext);
  if (!ctx) throw new Error(`<${part}> must be rendered inside <Menubar>`);
  return ctx;
}

/** Props accepted by `<Menubar>`. */
export interface MenubarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The `MenubarMenu` children that make up the bar. */
  children: React.ReactNode;
  /** React 19: ref is a regular prop - points at the bar's `role="menubar"` node. */
  ref?: React.Ref<HTMLDivElement>;
}

/** Menubar root - the horizontal `role="menubar"` container that owns open + roving-focus state. */
export function Menubar({ children, className, ref, ...props }: MenubarProps): React.ReactElement {
  const barRef = React.useRef<HTMLDivElement | null>(null);
  const [openValue, setOpenValue] = React.useState<string | null>(null);
  const [focusedValue, setFocusedValue] = React.useState<string | null>(null);

  const registerFirst = React.useCallback((value: string) => {
    setFocusedValue((prev) => prev ?? value);
  }, []);

  const focusByOffset = React.useCallback(
    (current: HTMLElement, offset: number | "first" | "last") => {
      const bar = barRef.current;
      if (!bar) return;
      const triggers = Array.from(
        bar.querySelectorAll<HTMLElement>("[data-vf-menubar-trigger]"),
      ).filter((trigger) =>
        !trigger.matches(":disabled") && trigger.getAttribute("aria-disabled") !== "true"
      );
      const i = triggers.indexOf(current);
      if (i < 0 || triggers.length === 0) return;
      const nextIndex = offset === "first"
        ? 0
        : offset === "last"
        ? triggers.length - 1
        : (i + offset + triggers.length) % triggers.length;
      const target = triggers[nextIndex];
      if (!target) return;
      target.focus();
      const targetValue = target.getAttribute("data-vf-menubar-value");
      setFocusedValue(targetValue);
      // If a menu was already open, carry the open state to the newly focused
      // trigger - matching the desktop-app menubar feel.
      setOpenValue((prev) => (prev != null ? targetValue : prev));
    },
    [],
  );

  const ctx = React.useMemo<MenubarState>(
    () => ({
      openValue,
      setOpenValue,
      focusedValue,
      setFocusedValue,
      registerFirst,
      focusByOffset,
    }),
    [openValue, focusedValue, registerFirst, focusByOffset],
  );

  return (
    <MenubarContext.Provider value={ctx}>
      <div
        ref={composeRefs<HTMLDivElement>(barRef, ref)}
        role="menubar"
        aria-orientation="horizontal"
        className={cn(
          "inline-flex items-center gap-0.5 rounded-lg border border-[var(--outline-border)] bg-[var(--secondary)] p-1",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </MenubarContext.Provider>
  );
}

/** Props accepted by `<MenubarMenu>`. */
export interface MenubarMenuProps {
  /** The `MenubarTrigger` and `MenubarContent` for this one menu. */
  children: React.ReactNode;
  /** Stable identifier for this menu; auto-generated when omitted. */
  value?: string;
}

/** One menu in the bar - a `DropdownMenu` whose open state the bar controls. */
export function MenubarMenu({ children, value }: MenubarMenuProps): React.ReactElement {
  const ctx = useMenubarContext("MenubarMenu");
  const generatedValue = React.useId();
  const menuValue = value ?? generatedValue;
  const open = ctx.openValue === menuValue;
  return (
    <MenubarMenuContext.Provider value={menuValue}>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => ctx.setOpenValue(next ? menuValue : null)}
      >
        {children}
      </DropdownMenu>
    </MenubarMenuContext.Provider>
  );
}

/** Props accepted by `<MenubarTrigger>`. */
export interface MenubarTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** The trigger label (usually a word like "File" or "Edit"). */
  children: React.ReactNode;
  /** React 19: ref is a regular prop - points at the trigger button. */
  ref?: React.Ref<HTMLButtonElement>;
}

/** Top-level menu button - `role="menuitem"` with `aria-haspopup`, part of the roving-focus group. */
export function MenubarTrigger(
  { children, className, disabled, onKeyDown, onFocus, ref, ...props }: MenubarTriggerProps,
): React.ReactElement {
  const ctx = useMenubarContext("MenubarTrigger");
  const menuValue = React.useContext(MenubarMenuContext);
  const open = menuValue != null && ctx.openValue === menuValue;
  const tabbable = !disabled && menuValue != null && ctx.focusedValue === menuValue;

  React.useEffect(() => {
    if (!disabled && menuValue != null) ctx.registerFirst(menuValue);
  }, [ctx, disabled, menuValue]);

  return (
    <DropdownMenuTrigger
      ref={ref}
      role="menuitem"
      disabled={disabled}
      tabIndex={tabbable ? 0 : -1}
      data-vf-menubar-trigger=""
      data-vf-menubar-value={menuValue ?? undefined}
      data-state={open ? "open" : "closed"}
      onFocus={(event) => {
        onFocus?.(event);
        if (!disabled && menuValue != null) ctx.setFocusedValue(menuValue);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        switch (event.key) {
          case "ArrowRight":
            event.preventDefault();
            ctx.focusByOffset(event.currentTarget, 1);
            break;
          case "ArrowLeft":
            event.preventDefault();
            ctx.focusByOffset(event.currentTarget, -1);
            break;
          case "Home":
            event.preventDefault();
            ctx.focusByOffset(event.currentTarget, "first");
            break;
          case "End":
            event.preventDefault();
            ctx.focusByOffset(event.currentTarget, "last");
            break;
        }
      }}
      className={cn(
        "inline-flex select-none items-center rounded-md px-3 h-[34px] text-base font-normal",
        "text-[var(--foreground)] outline-none transition-colors",
        "hover:bg-[var(--tertiary)] focus-visible:bg-[var(--tertiary)] dark:hover:bg-[var(--accent)] dark:focus-visible:bg-[var(--accent)]",
        "data-[state=open]:bg-[var(--accent)]",
        className,
      )}
      {...props}
    >
      {children}
    </DropdownMenuTrigger>
  );
}

/** Props accepted by `<MenubarContent>`. */
export interface MenubarContentProps extends DropdownMenuContentProps {
  /** The `MenubarItem` / `MenubarSeparator` children of this menu's dropdown. */
  children: React.ReactNode;
}

/** The dropdown surface for one menu - reuses the `DropdownMenuContent` machinery. */
export function MenubarContent(
  { children, ...props }: MenubarContentProps,
): React.ReactElement | null {
  return <DropdownMenuContent {...props}>{children}</DropdownMenuContent>;
}

/** Props accepted by `<MenubarItem>`. */
export interface MenubarItemProps extends DropdownMenuItemProps {
  /** The item label / content. */
  children: React.ReactNode;
}

/** A selectable item inside a menu - `role="menuitem"`; selecting it closes the menu. */
export function MenubarItem({ children, ...props }: MenubarItemProps): React.ReactElement {
  return <DropdownMenuItem {...props}>{children}</DropdownMenuItem>;
}

/** Props accepted by `<MenubarSeparator>`. */
export interface MenubarSeparatorProps {
  /** Extra classes merged onto the divider. */
  className?: string;
}

/** A horizontal divider between groups of items inside a menu. */
export function MenubarSeparator({ className }: MenubarSeparatorProps): React.ReactElement {
  return <DropdownMenuSeparator className={className} />;
}
