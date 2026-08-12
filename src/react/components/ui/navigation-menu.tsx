/**
 * NavigationMenu — a horizontal site-navigation bar whose items can open a
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

/** Root-level state shared from `NavigationMenu` down to every item. */
interface NavigationMenuState {
  /** Value of the item whose panel is open, or `null` when all are closed. */
  openValue: string | null;
  /** Open the item with `value` (or close all with `null`). */
  setOpenValue: (value: string | null) => void;
}

const NavigationMenuContext = React.createContext<NavigationMenuState | null>(null);
/** Per-item context carrying the stable value that links a trigger to its panel. */
const NavigationMenuItemContext = React.createContext<string | null>(null);

function useNavigationMenuContext(part: string): NavigationMenuState {
  const ctx = React.useContext(NavigationMenuContext);
  if (!ctx) throw new Error(`<${part}> must be used within <NavigationMenu>`);
  return ctx;
}

function useNavigationMenuItem(part: string): string {
  const value = React.useContext(NavigationMenuItemContext);
  if (value == null) throw new Error(`<${part}> must be used within <NavigationMenuItem>`);
  return value;
}

/** Props accepted by `<NavigationMenu>`. */
export interface NavigationMenuProps extends React.HTMLAttributes<HTMLElement> {
  /** Accessible name for the navigation landmark. @default "Main" */
  label?: string;
  /** The `NavigationMenuList` (and its items) that make up the nav. */
  children: React.ReactNode;
  /** React 19: ref is a regular prop — points at the `<nav>` landmark. */
  ref?: React.Ref<HTMLElement>;
}

/** Navigation root — a `<nav>` landmark that owns which item's panel is open. */
export function NavigationMenu({
  label = "Main",
  className,
  children,
  ref,
  ...props
}: NavigationMenuProps): React.ReactElement {
  const [openValue, setOpenValue] = React.useState<string | null>(null);
  const ctx = React.useMemo<NavigationMenuState>(
    () => ({ openValue, setOpenValue }),
    [openValue],
  );
  return (
    <NavigationMenuContext.Provider value={ctx}>
      <nav
        ref={ref}
        aria-label={label}
        data-state={openValue == null ? "closed" : "open"}
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
  /** React 19: ref is a regular prop — points at the `<ul>`. */
  ref?: React.Ref<HTMLUListElement>;
}

/** The horizontal list container — a flex `<ul>` of items. */
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
  /** React 19: ref is a regular prop — points at the `<li>`. */
  ref?: React.Ref<HTMLLIElement>;
}

/** One item in the bar — an `<li>` that provides its value to its trigger/panel. */
export function NavigationMenuItem({
  value,
  className,
  children,
  ref,
  ...props
}: NavigationMenuItemProps): React.ReactElement {
  const ctx = React.useContext(NavigationMenuContext);
  const open = ctx?.openValue === value;
  return (
    <NavigationMenuItemContext.Provider value={value}>
      <li
        ref={ref}
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
  /** React 19: ref is a regular prop — points at the trigger button. */
  ref?: React.Ref<HTMLButtonElement>;
}

/** The button that toggles its item's panel — `aria-expanded` + `aria-controls`, with a caret. */
export function NavigationMenuTrigger({
  className,
  onClick,
  onPointerEnter,
  children,
  ref,
  ...props
}: NavigationMenuTriggerProps): React.ReactElement {
  const ctx = useNavigationMenuContext("NavigationMenuTrigger");
  const value = useNavigationMenuItem("NavigationMenuTrigger");
  const open = ctx.openValue === value;
  const panelId = `${value}-panel`;
  return (
    <button
      ref={ref}
      type="button"
      aria-expanded={open}
      aria-controls={panelId}
      data-state={open ? "open" : "closed"}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (!event.defaultPrevented) ctx.setOpenValue(open ? null : value);
      }}
      onPointerEnter={(event: React.PointerEvent<HTMLButtonElement>) => {
        onPointerEnter?.(event);
        if (!event.defaultPrevented) ctx.setOpenValue(value);
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
  /** React 19: ref is a regular prop — points at the panel. */
  ref?: React.Ref<HTMLDivElement>;
}

/** The dropdown panel for one item — absolutely positioned, rendered only while open. */
export function NavigationMenuContent({
  className,
  children,
  ref,
  ...props
}: NavigationMenuContentProps): React.ReactElement | null {
  const ctx = useNavigationMenuContext("NavigationMenuContent");
  const value = useNavigationMenuItem("NavigationMenuContent");
  const open = ctx.openValue === value;
  if (!open) return null;
  return (
    <div
      ref={ref}
      id={`${value}-panel`}
      role="menu"
      data-state="open"
      className={cn(
        "absolute left-0 top-full z-50 mt-1 flex min-w-[12rem] flex-col gap-1 p-1",
        "rounded-md border border-[var(--border)] bg-[var(--popover)] text-[var(--popover-foreground)] shadow-md",
        className,
      )}
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
  /** React 19: ref is a regular prop — points at the `<a>`. */
  ref?: React.Ref<HTMLAnchorElement>;
}

/** A single navigable link — used inside a panel or as a plain top-level item. */
export function NavigationMenuLink({
  active = false,
  className,
  children,
  ref,
  ...props
}: NavigationMenuLinkProps): React.ReactElement {
  return (
    <a
      ref={ref}
      role="menuitem"
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
