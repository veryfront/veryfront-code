/**
 * Tabs — ported from Veryfront Studio `components/Tabs/Tabs.tsx`, with the
 * `motion/react` spring-slide forked out: the active pill is a static
 * background (no dependency, no layout animation), only the `transition-colors`
 * CSS that Studio already ships. Semantic classes remapped to veryfront's
 * `[var(--token)]` vocabulary.
 *
 * The selection MECHANICS (`role="tablist"` / `role="tab"`, `aria-selected`,
 * select-on-click) come from the active adapter's `tabs` slot
 * (`useAdapter().tabs`) — with no provider that is the zero-dependency builtin,
 * so behaviour and markup are unchanged. This skin owns only the API shape, the
 * `size` variant, and the visual look (including the active pill), which it
 * drives from the controlled `value` prop.
 *
 * Flat, prefixed exports (`Tabs` + `TabsItem`) to match the other `ui/`
 * primitives (`SelectItem`, `DialogTrigger`, …). Note: `cn` is clsx-only (no
 * tailwind-merge), so overriding a base utility via `className` needs the `!`
 * suffix (e.g. `px-8!`).
 *
 * Two sizes:
 * - `default` — filled track (`--input-bg`), 34/38px, accent pill.
 * - `sm` — flat, outlined, 32px, for panel headers.
 *
 * @example
 * ```tsx
 * import { Tabs, TabsItem } from "veryfront/ui";
 *
 * function Example() {
 *   const [tab, setTab] = React.useState("overview");
 *   return (
 *     <Tabs value={tab} onValueChange={setTab}>
 *       <TabsItem value="overview">Overview</TabsItem>
 *       <TabsItem value="activity">Activity</TabsItem>
 *     </Tabs>
 *   );
 * }
 * ```
 *
 * @module react/components/ui/tabs
 */
import * as React from "react";
import { createStrictContext } from "../create-strict-context.ts";
import { cx as cn } from "./cva.ts";
import { useAdapter } from "./adapter/context.tsx";

type TabsSize = "default" | "sm";

/** Skin-level context: the adapter owns selection; the skin owns the size + the
 * active-pill look, which it derives from the controlled `value`. */
interface TabsSkinValue {
  value: string;
  size: TabsSize;
}

const [TabsSkinContext, useTabsSkin] = createStrictContext<TabsSkinValue>("TabsItem", "Tabs");

/** Props accepted by `<Tabs>` (the tablist container). */
export interface TabsProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  value: string;
  onValueChange: (value: string) => void;
  size?: TabsSize;
  children: React.ReactNode;
}

/** Tablist container — delegates selection to the adapter, owns the size + look. */
export const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(function Tabs(
  { value, onValueChange, size = "default", className, children, ...props },
  ref,
): React.ReactElement {
  const { tabs } = useAdapter();
  return (
    <TabsSkinContext.Provider value={{ value, size }}>
      <tabs.Root
        ref={ref}
        value={value}
        onValueChange={onValueChange}
        {...props}
        className={cn(
          "inline-flex w-fit items-center rounded-full",
          size === "sm"
            ? "h-[32px] gap-0 border border-[var(--edge)] bg-transparent p-0.5"
            : "h-[34px] gap-2 bg-[var(--input-bg)] p-1 md:h-[38px]",
          className,
        )}
      >
        {children}
      </tabs.Root>
    </TabsSkinContext.Provider>
  );
});
Tabs.displayName = "Tabs";

/** Props accepted by `<TabsItem>`. */
export interface TabsItemProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value"> {
  value: string;
  href?: string;
  children: React.ReactNode;
}

/**
 * Individual tab — renders as a button, or an anchor when `href` is set. The
 * adapter's `tabs.Tab` supplies the `role="tab"` / `aria-selected` / `data-state`
 * mechanics and composes selection onto the caller's `onClick` (caller's runs
 * first, then the tab activates); this skin renders the visual pill and forwards
 * native props/ref.
 */
export const TabsItem = React.forwardRef<HTMLButtonElement, TabsItemProps>(
  function TabsItem(
    { value, href, children, className, onClick, ...props },
    ref,
  ): React.ReactElement {
    const { tabs } = useAdapter();
    const { value: selected, size } = useTabsSkin();

    const isActive = selected === value;
    const Comp = (href ? "a" : "button") as React.ElementType;

    return (
      <tabs.Tab value={value} asChild ref={ref} onClick={onClick}>
        <Comp
          {...(href ? { href } : { type: "button" as const })}
          {...props}
          className={cn(
            "relative inline-flex items-center h-full rounded-full font-normal transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)]",
            size === "sm" ? "px-3 text-sm" : "px-5 md:px-6 text-sm md:text-base",
            isActive
              ? cn(
                "text-[var(--foreground)]",
                size === "default" && "dark:text-[var(--background)]",
              )
              : "text-[var(--foreground)] opacity-50 hover:opacity-100",
            className,
          )}
        >
          {isActive && (
            <div
              className={cn(
                "absolute inset-0 rounded-full bg-[var(--accent)]",
                size === "default" && "dark:bg-[var(--foreground)]",
              )}
            />
          )}
          <span className="relative z-10">{children}</span>
        </Comp>
      </tabs.Tab>
    );
  },
);
TabsItem.displayName = "TabsItem";
