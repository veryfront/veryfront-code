/**
 * Tabs — ported from Veryfront Studio `components/Tabs/Tabs.tsx`, with the
 * `motion/react` spring-slide forked out: the active pill is a static
 * `data-[state=active]` background (no dependency, no layout animation), only the
 * `transition-colors` CSS that Studio already ships. Semantic classes remapped to
 * veryfront's `[var(--token)]` vocabulary. Private to the chat module.
 *
 * The selection MECHANICS (`role="tablist"`/`tab`, `aria-selected`, select-on-
 * click) come from the active adapter's `tabs` slot (`useAdapter().tabs`) —
 * zero-dependency builtin by default, swappable via `UIAdapterProvider`. This file
 * owns only the API shape, the `size` variant, and the visual classes. Tabs are
 * panel-less: render content keyed by the active value yourself.
 *
 * Flat, prefixed exports (`Tabs` + `TabsItem`) to match the other `ui/`
 * primitives. Note: `cn` is clsx-only (no tailwind-merge), so overriding a base
 * utility via `className` needs the `!` suffix (e.g. `px-8!`).
 *
 * @example
 * ```tsx
 * import { Tabs, TabsItem } from "veryfront/ui";
 *
 * const [tab, setTab] = React.useState("overview");
 * <Tabs value={tab} onValueChange={setTab}>
 *   <TabsItem value="overview">Overview</TabsItem>
 *   <TabsItem value="activity">Activity</TabsItem>
 * </Tabs>;
 * ```
 *
 * @module react/components/ui/tabs
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { useAdapter } from "./adapter/context.tsx";

type TabsSize = "default" | "sm";

/** Skin-level size context (the adapter owns selection; the skin owns sizing). */
const TabsSizeContext = React.createContext<TabsSize>("default");

/** Props accepted by `<Tabs>` (the tablist container). */
export interface TabsProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  /** The active tab's value (controlled). */
  value: string;
  /** Fires with the newly-selected tab's value. */
  onValueChange: (value: string) => void;
  /** Tab size. @default "default" */
  size?: TabsSize;
  /** `TabsItem` children. */
  children: React.ReactNode;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** Tablist container — delegates selection to the adapter, owns the size + look. */
export function Tabs(
  { value, onValueChange, size = "default", className, children, ...props }: TabsProps,
): React.ReactElement {
  const { tabs } = useAdapter();
  return (
    <TabsSizeContext.Provider value={size}>
      <tabs.Root
        value={value}
        onValueChange={onValueChange}
        className={cn(
          "inline-flex w-fit items-center rounded-full",
          size === "sm"
            ? "h-[32px] gap-0 border border-[var(--edge)] bg-transparent p-0.5"
            : "h-[34px] gap-2 bg-[var(--input-bg)] p-1 md:h-[38px]",
          className,
        )}
        {...props}
      >
        {children}
      </tabs.Root>
    </TabsSizeContext.Provider>
  );
}

/** Props accepted by `<TabsItem>`. */
export interface TabsItemProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value"> {
  /** The tab's value; matches the active `Tabs` value. */
  value: string;
  /** Render as an anchor with this href instead of a button. */
  href?: string;
  /** The tab label. */
  children: React.ReactNode;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLButtonElement>;
}

/** Individual tab — a button, or an anchor when `href` is set. */
export function TabsItem(
  { value, href, children, className, ...props }: TabsItemProps,
): React.ReactElement {
  const { tabs } = useAdapter();
  const size = React.useContext(TabsSizeContext);
  const cls = cn(
    "relative inline-flex h-full items-center rounded-full font-normal transition-colors cursor-pointer",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)]",
    size === "sm" ? "px-3 text-sm" : "px-5 text-sm md:px-6 md:text-base",
    // Inactive: dimmed; active (data-state, set by the adapter Tab): full pill.
    "text-[var(--foreground)] opacity-50 hover:opacity-100",
    "data-[state=active]:opacity-100 data-[state=active]:bg-[var(--accent)]",
    size === "default" &&
      "dark:data-[state=active]:bg-[var(--foreground)] dark:data-[state=active]:text-[var(--background)]",
    className,
  );
  if (href) {
    return (
      <tabs.Tab value={value} asChild className={cls}>
        <a href={href} {...(props as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>{children}</a>
      </tabs.Tab>
    );
  }
  return <tabs.Tab value={value} className={cls} {...props}>{children}</tabs.Tab>;
}
