/**
 * Tabs — ported from Veryfront Studio `components/Tabs/Tabs.tsx`, with the
 * `motion/react` spring-slide forked out: the active pill is a static
 * background (no dependency, no layout animation), only the `transition-colors`
 * CSS that Studio already ships. Semantic classes remapped to veryfront's
 * `[var(--token)]` vocabulary. Private to the chat module.
 *
 * Two sizes:
 * - `default` — filled track (`--input-bg`), 34/38px, accent pill.
 * - `sm` — flat, outlined, 32px, for panel headers.
 *
 * @module react/components/chat/ui/tabs
 */
import * as React from "react";
import { cn } from "../theme.ts";

type TabsSize = "default" | "sm";

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
  size: TabsSize;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

/** Props accepted by `<Tabs.Root>`. */
export interface TabsRootProps {
  value: string;
  onValueChange: (value: string) => void;
  size?: TabsSize;
  className?: string;
  children: React.ReactNode;
}

/** Tablist container — manages active state and passes context to items. */
function Root({
  value,
  onValueChange,
  size = "default",
  className,
  children,
}: TabsRootProps): React.ReactElement {
  return (
    <TabsContext.Provider value={{ value, onValueChange, size }}>
      <div
        className={cn(
          "inline-flex w-fit items-center rounded-full",
          size === "sm"
            ? "h-[32px] gap-0 border border-[var(--edge)] bg-transparent p-0.5"
            : "h-[34px] gap-2 bg-[var(--input-bg)] p-1 md:h-[38px]",
          className,
        )}
        role="tablist"
      >
        {children}
      </div>
    </TabsContext.Provider>
  );
}

/** Props accepted by `<Tabs.Item>`. */
export interface TabsItemProps {
  value: string;
  href?: string;
  children: React.ReactNode;
}

/** Individual tab — renders as a button, or an anchor when `href` is set. */
function Item({ value, href, children }: TabsItemProps): React.ReactElement {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error("Tabs.Item must be used within Tabs.Root");

  const isActive = ctx.value === value;
  const Comp = href ? "a" : "button";

  return (
    <Comp
      {...(href ? { href } : { type: "button" as const })}
      role="tab"
      aria-selected={isActive}
      onClick={() => ctx.onValueChange(value)}
      className={cn(
        "relative inline-flex items-center h-full rounded-full font-normal transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)]",
        ctx.size === "sm" ? "px-3 text-sm" : "px-5 md:px-6 text-sm md:text-base",
        isActive
          ? cn(
            "text-[var(--foreground)]",
            ctx.size === "default" && "dark:text-[var(--background)]",
          )
          : "text-[var(--foreground)] opacity-50 hover:opacity-100",
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
}

export const Tabs = { Root, Item };
