/**
 * Tabs — ported from Veryfront Studio `components/Tabs/Tabs.tsx`, with the
 * `motion/react` spring-slide forked out: the active pill is a static
 * background (no dependency, no layout animation), only the `transition-colors`
 * CSS that Studio already ships. Semantic classes remapped to veryfront's
 * `[var(--token)]` vocabulary. Private to the chat module.
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
 * @module react/components/ui/tabs
 */
import * as React from "react";
import { createStrictContext } from "../create-strict-context.ts";
import { cx as cn } from "./cva.ts";

type TabsSize = "default" | "sm";

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
  size: TabsSize;
}

const [TabsContext, useTabs] = createStrictContext<TabsContextValue>("TabsItem", "Tabs");

/** Props accepted by `<Tabs>` (the tablist container). */
export interface TabsProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  value: string;
  onValueChange: (value: string) => void;
  size?: TabsSize;
  children: React.ReactNode;
}

/** Tablist container — manages active state and passes context to items. */
export const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(function Tabs(
  { value, onValueChange, size = "default", className, children, ...props },
  ref,
): React.ReactElement {
  return (
    <TabsContext.Provider value={{ value, onValueChange, size }}>
      <div
        ref={ref}
        {...props}
        role="tablist"
        className={cn(
          "inline-flex w-fit items-center rounded-full",
          size === "sm"
            ? "h-[32px] gap-0 border border-[var(--edge)] bg-transparent p-0.5"
            : "h-[34px] gap-2 bg-[var(--input-bg)] p-1 md:h-[38px]",
          className,
        )}
      >
        {children}
      </div>
    </TabsContext.Provider>
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
 * Individual tab — renders as a button, or an anchor when `href` is set.
 * Forwards native props/ref and composes the caller's `onClick` with the
 * internal selection (caller's runs first, then the tab activates), so a
 * consumer-supplied handler adds to — never overrides — selection.
 */
export const TabsItem = React.forwardRef<HTMLButtonElement, TabsItemProps>(
  function TabsItem(
    { value, href, children, className, onClick, ...props },
    ref,
  ): React.ReactElement {
    const ctx = useTabs();

    const isActive = ctx.value === value;
    const Comp = (href ? "a" : "button") as React.ElementType;

    return (
      <Comp
        ref={ref}
        {...(href ? { href } : { type: "button" as const })}
        {...props}
        role="tab"
        aria-selected={isActive}
        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
          onClick?.(e);
          ctx.onValueChange(value);
        }}
        className={cn(
          "relative inline-flex items-center h-full rounded-full font-normal transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)]",
          ctx.size === "sm" ? "px-3 text-sm" : "px-5 md:px-6 text-sm md:text-base",
          isActive
            ? cn(
              "text-[var(--foreground)]",
              ctx.size === "default" && "dark:text-[var(--background)]",
            )
            : "text-[var(--foreground)] opacity-50 hover:opacity-100",
          className,
        )}
      >
        {isActive && (
          <div
            className={cn(
              "absolute inset-0 rounded-full bg-[var(--accent)]",
              ctx.size === "default" && "dark:bg-[var(--foreground)]",
            )}
          />
        )}
        <span className="relative z-10">{children}</span>
      </Comp>
    );
  },
);
TabsItem.displayName = "TabsItem";
