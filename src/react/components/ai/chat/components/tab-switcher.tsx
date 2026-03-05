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
  const activeIndex = TABS.findIndex((t) => t.value === activeTab);

  return (
    <div className={cn("flex items-center justify-center py-2", className)}>
      <div
        role="tablist"
        aria-label="Chat view"
        className="relative inline-flex items-center h-[34px] gap-1 rounded-full bg-[var(--tab-background)] p-1"
      >
        {/* Animated indicator */}
        <div
          className="absolute top-1 bottom-1 rounded-full bg-[var(--tab-active-background)] shadow-sm transition-[left,width] duration-500"
          style={{
            left: activeIndex === 0 ? 4 : "50%",
            width: "calc(50% - 4px)",
            transitionTimingFunction: "cubic-bezier(0.34, 1.56, 0.64, 1)",
          }}
        />
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.value}
            tabIndex={activeTab === tab.value ? 0 : -1}
            onClick={() => onTabChange(tab.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const next = tab.value === "chat" ? "uploads" : "chat";
                onTabChange(next);
              }
            }}
            className={cn(
              "relative z-10 inline-flex items-center h-full px-5 text-sm font-medium rounded-full transition-colors cursor-pointer",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
              activeTab === tab.value
                ? "text-[var(--tab-active-foreground)]"
                : "text-[var(--tab-foreground)] hover:text-[var(--foreground)]",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
