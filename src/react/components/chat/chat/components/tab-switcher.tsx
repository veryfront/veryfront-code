/**
 * TabSwitcher — Animated tab pill matching the Studio Tabs pattern.
 *
 * Uses a CSS-only sliding indicator (no Framer Motion dependency) with
 * spring-like cubic-bezier easing to approximate Studio's motion.div.
 * WAI-ARIA tabs pattern with keyboard navigation.
 */

import * as React from "react";
import { cn } from "../../theme.ts";

export type ChatTab = "chat" | "uploads";

export interface TabSwitcherProps {
  activeTab: ChatTab;
  onTabChange: (tab: ChatTab) => void;
  className?: string;
}

const TABS: { value: ChatTab; label: string }[] = [
  { value: "chat", label: "Chat" },
  { value: "uploads", label: "Uploads" },
];

export function TabSwitcher({
  activeTab,
  onTabChange,
  className,
}: TabSwitcherProps): React.ReactElement {
  return (
    <div className={cn("flex items-center justify-center py-5", className)}>
      <div
        role="tablist"
        aria-label="Chat view"
        className="inline-flex w-fit items-center gap-1 p-1 rounded-full bg-[var(--tab-background)] h-[38px]"
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onTabChange(tab.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  const next = tab.value === "chat" ? "uploads" : "chat";
                  onTabChange(next);
                }
              }}
              className={cn(
                "inline-flex items-center h-full px-5 text-sm font-medium rounded-full transition-colors cursor-pointer",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                isActive
                  ? "bg-[var(--tab-active-background)] text-[var(--tab-active-foreground)]"
                  : "text-[var(--tab-foreground)]",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
