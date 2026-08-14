/**
 * NavigationMenu: a horizontal site-navigation bar whose items can open a
 * dropdown panel of links. Self-contained (context + `aria-expanded` triggers,
 * no floating engine): the root owns which item's panel is open and only one is
 * open at a time. A `NavigationMenuTrigger` toggles its panel on click and opens
 * it on pointer-enter; its `NavigationMenuContent` renders absolutely under the
 * trigger while open (`data-state="open"`). Plain `NavigationMenuLink` items with
 * no panel are supported for simple top-level links. Skinned with veryfront
 * theme tokens.
 *
 * @example
 * ```tsx
 * import {
 *   NavigationMenu,
 *   NavigationMenuContent,
 *   NavigationMenuItem,
 *   NavigationMenuLink,
 *   NavigationMenuList,
 *   NavigationMenuTrigger,
 * } from "veryfront/ui";
 *
 * <NavigationMenu>
 *   <NavigationMenuList>
 *     <NavigationMenuItem value="products">
 *       <NavigationMenuTrigger>Products</NavigationMenuTrigger>
 *       <NavigationMenuContent>
 *         <NavigationMenuLink href="/analytics">Analytics</NavigationMenuLink>
 *         <NavigationMenuLink href="/automation">Automation</NavigationMenuLink>
 *       </NavigationMenuContent>
 *     </NavigationMenuItem>
 *     <NavigationMenuItem value="docs">
 *       <NavigationMenuLink href="/docs">Docs</NavigationMenuLink>
 *     </NavigationMenuItem>
 *   </NavigationMenuList>
 * </NavigationMenu>;
 * ```
 *
 * @module react/components/ui/navigation-menu
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";

const CLOSE_DELAY_MS = 100;

/** Root-level state shared from `NavigationMenu` down to every item. */
interface NavigationMenuState {
  /** Internal id of the item whose panel is open, or `null` when all are closed. */
  openItemId: string | null;
  /** Open the item with `itemId` (or close all with `null`). */
  setOpenItemId: (itemId: string | null) => void;
  /** Cancel a pending hover close when the pointer enters the coordinated region. */
  cancelClose: () => void;
  /** Close `itemId` after the pointer has time to cross into its panel. */
  scheduleClose: (itemId: string) => void;
}

/** Per-item identity. `value` is the caller's label; `itemId` is unique per instance. */
interface NavigationMenuItemIdentity {
  value: string;
  itemId: string;
}

const NavigationMenuContext = React.createContext<NavigationMenuState | null>(null);
/** Per-item context carrying the identity that links a trigger to its panel. */
const NavigationMenuItemContext = React.createContext<NavigationMenuItemIdentity | null>(null);

function useNavigationMenuContext(part: string): NavigationMenuState {
  const ctx = React.useContext(NavigationMenuContext);
  if (!ctx) throw new Error(`<${part}> must be used within <NavigationMenu>`);
  return ctx;
}

function useNavigationMenuItem(part: string): NavigationMenuItemIdentity {
  const identity = React.useContext(NavigationMenuItemContext);
  if (identity == null) throw new Error(`<${part}> must be used within <NavigationMenuItem>`);
  return identity;
}

/** Props accepted by `<NavigationMenu>`. */
export interface NavigationMenuProps extends React.HTMLAttributes<HTMLElement> {
  /** Accessible name for the navigation landmark. @default "Main" */
  label?: string;
  /** The `NavigationMenuList` (and its items) that make up the nav. */
  children: React.ReactNode;
  /** React 19: ref is a regular prop, points at the `<nav>` landmark. */
  ref?: React.Ref<HTMLElement>;
}

/** Navigation root: a `<nav>` landmark that owns which item's panel is open. */
export function NavigationMenu({
  label = "Main",
  className,
  children,
  ref,
  ...props
}: NavigationMenuProps): React.ReactElement {
  const [openItemId, setOpenItemIdState] = React.useState<string | null>(null);
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = React.useCallback(() => {
    if (closeTimerRef.current != null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);
  const setOpenItemId = React.useCallback((itemId: string | null) => {
    cancelClose();
    setOpenItemIdState(itemId);
  }, [cancelClose]);
  const scheduleClose = React.useCallback((itemId: string) => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setOpenItemIdState((current) => current === itemId ? null : current);
    }, CLOSE_DELAY_MS);
  }, [cancelClose]);
  React.useEffect(() => cancelClose, [cancelClose]);
  const ctx = React.useMemo<NavigationMenuState>(
    () => ({ openItemId, setOpenItemId, cancelClose, scheduleClose }),
    [openItemId, setOpenItemId, cancelClose, scheduleClose],
  );
  return (
    <NavigationMenuContext.Provider value={ctx}>
      <nav
        ref={ref}
        aria-label={label}
        data-state={openItemId == null ? "closed" : "open"}
        className={cn("relative inline-flex max-w-max items-center", className)}
        {...props}
      >
        {children}
      </nav>
    </NavigationMenuContext.Provider>
  );
}

/** Props accepted by `<NavigationMenuList>`. */
export interface NavigationMenuListProps extends React.HTMLAttributes<HTMLUListElement> {
  /** The `NavigationMenuItem` children of the bar. */
  children: React.ReactNode;
  /** React 19: ref is a regular prop, points at the `<ul>`. */
  ref?: React.Ref<HTMLUListElement>;
}

/** The horizontal list container: a flex `<ul>` of items. */
export function NavigationMenuList({
  className,
  children,
  ref,
  ...props
}: NavigationMenuListProps): React.ReactElement {
  return (
    <ul
      ref={ref}
      className={cn("flex flex-1 list-none items-center gap-1", className)}
      {...props}
    >
      {children}
    </ul>
  );
}

/** Props accepted by `<NavigationMenuItem>`. */
export interface NavigationMenuItemProps extends React.LiHTMLAttributes<HTMLLIElement> {
  /** Stable identifier linking this item's trigger to its panel and open state. */
  value: string;
  /** The `NavigationMenuTrigger` + `NavigationMenuContent` (or a plain `NavigationMenuLink`). */
  children: React.ReactNode;
  /** React 19: ref is a regular prop, points at the `<li>`. */
  ref?: React.Ref<HTMLLIElement>;
}

/** One item in the bar: an `<li>` that provides its value to its trigger/panel. */
export function NavigationMenuItem({
  value,
  className,
  children,
  ref,
  ...props
}: NavigationMenuItemProps): React.ReactElement {
  const ctx = React.useContext(NavigationMenuContext);
  // Identity is per instance, not per `value`. Two items may legitimately carry
  // the same `value`; keying open state on it would open both panels at once
  // and mint duplicate panel ids, making aria-controls ambiguous.
  const reactId = React.useId();
  const itemId = `vf-navigation-menu-${reactId}`;
  const open = ctx?.openItemId === itemId;
  const identity = React.useMemo(() => ({ value, itemId }), [value, itemId]);
  return (
    <NavigationMenuItemContext.Provider value={identity}>
      <li
        ref={ref}
        data-value={value}
        data-state={open ? "open" : "closed"}
        className={cn("relative", className)}
        {...props}
      >
        {children}
      </li>
    </NavigationMenuItemContext.Provider>
  );
}

/** Props accepted by `<NavigationMenuTrigger>`. */
export interface NavigationMenuTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** The trigger label (usually a nav word like "Products"). */
  children: React.ReactNode;
  /** React 19: ref is a regular prop, points at the trigger button. */
  ref?: React.Ref<HTMLButtonElement>;
}

/** The button that toggles its item's panel: `aria-expanded` + `aria-controls`, with a caret. */
export function NavigationMenuTrigger({
  className,
  onClick,
  onPointerEnter,
  onPointerLeave,
  children,
  ref,
  ...props
}: NavigationMenuTriggerProps): React.ReactElement {
  const ctx = useNavigationMenuContext("NavigationMenuTrigger");
  const { itemId } = useNavigationMenuItem("NavigationMenuTrigger");
  const open = ctx.openItemId === itemId;
  const panelId = `${itemId}-panel`;
  return (
    <button
      ref={ref}
      type="button"
      aria-expanded={open}
      // Only reference the panel while it exists: NavigationMenuContent renders
      // null when closed, so a constant aria-controls would dangle.
      aria-controls={open ? panelId : undefined}
      data-state={open ? "open" : "closed"}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (!event.defaultPrevented) ctx.setOpenItemId(open ? null : itemId);
      }}
      onPointerEnter={(event: React.PointerEvent<HTMLButtonElement>) => {
        onPointerEnter?.(event);
        if (!event.defaultPrevented && !event.currentTarget.disabled) {
          ctx.setOpenItemId(itemId);
        }
      }}
      onPointerLeave={(event: React.PointerEvent<HTMLButtonElement>) => {
        onPointerLeave?.(event);
        if (!event.defaultPrevented && open) ctx.scheduleClose(itemId);
      }}
      className={cn(
        "inline-flex h-9 select-none items-center gap-1 rounded-md px-3 text-sm font-medium",
        "text-[var(--foreground)] outline-none transition-colors",
        "hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]",
        "focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
        "data-[state=open]:bg-[var(--accent)] data-[state=open]:text-[var(--accent-foreground)]",
        className,
      )}
      {...props}
    >
      {children}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-3 w-3 transition-transform duration-200 data-[state=open]:rotate-180"
        data-state={open ? "open" : "closed"}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  );
}

/** Props accepted by `<NavigationMenuContent>`. */
export interface NavigationMenuContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The `NavigationMenuLink`s (or other content) for this item's dropdown panel. */
  children: React.ReactNode;
  /** React 19: ref is a regular prop, points at the panel. */
  ref?: React.Ref<HTMLDivElement>;
}

/** The dropdown panel for one item: absolutely positioned, rendered only while open. */
export function NavigationMenuContent({
  className,
  children,
  ref,
  onPointerEnter,
  onPointerLeave,
  ...props
}: NavigationMenuContentProps): React.ReactElement | null {
  const ctx = useNavigationMenuContext("NavigationMenuContent");
  const { itemId } = useNavigationMenuItem("NavigationMenuContent");
  const open = ctx.openItemId === itemId;
  if (!open) return null;
  // Deliberately not role="menu". That role declares an application-menu
  // keyboard model (arrows, Home/End, Escape, roving focus) which site
  // navigation does not implement and does not want. A plain disclosure panel
  // of links is the accessible pattern here.
  return (
    <div
      ref={ref}
      id={`${itemId}-panel`}
      data-slot="navigation-menu-content"
      data-state="open"
      className={cn(
        "absolute left-0 top-full z-50 mt-1 flex min-w-[12rem] flex-col gap-1 p-1",
        "rounded-md border border-[var(--border)] bg-[var(--popover)] text-[var(--popover-foreground)] shadow-md",
        className,
      )}
      onPointerEnter={(event) => {
        onPointerEnter?.(event);
        if (!event.defaultPrevented) ctx.cancelClose();
      }}
      onPointerLeave={(event) => {
        onPointerLeave?.(event);
        if (!event.defaultPrevented) ctx.scheduleClose(itemId);
      }}
      {...props}
    >
      {children}
    </div>
  );
}

/** Props accepted by `<NavigationMenuLink>`. */
export interface NavigationMenuLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  /** Marks this link as the current page (`aria-current="page"` + active styling). @default false */
  active?: boolean;
  /** The link label / content. */
  children: React.ReactNode;
  /** React 19: ref is a regular prop, points at the `<a>`. */
  ref?: React.Ref<HTMLAnchorElement>;
}

/** A single navigable link: used inside a panel or as a plain top-level item. */
export function NavigationMenuLink({
  active = false,
  className,
  children,
  ref,
  ...props
}: NavigationMenuLinkProps): React.ReactElement {
  return (
    // No role="menuitem": it is only meaningful inside a real menu/menubar, and
    // a plain top-level link has no menu owner at all. A bare <a> is correct.
    <a
      ref={ref}
      aria-current={active ? "page" : undefined}
      data-active={active ? "" : undefined}
      className={cn(
        "block select-none rounded-md px-3 py-2 text-sm font-medium no-underline outline-none transition-colors",
        "text-[var(--foreground)]",
        "hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]",
        "focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
        "data-[active]:bg-[var(--accent)] data-[active]:text-[var(--accent-foreground)]",
        className,
      )}
      {...props}
    >
      {children}
    </a>
  );
}
