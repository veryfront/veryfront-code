import * as React from "react";
import { cn } from "../../theme.ts";

export type ChatTab = "chat" | "docs";

export interface TabSwitcherProps {
  activeTab: ChatTab;
  onTabChange: (tab: ChatTab) => void;
  className?: string;
}

const TABS: { value: ChatTab; label: string }[] = [
  { value: "chat", label: "Chat" },
  { value: "docs", label: "Docs" },
];

export function TabSwitcher({
  activeTab,
  onTabChange,
  className,
}: TabSwitcherProps): React.ReactElement {
  return (
    <div className={cn("flex items-center justify-center py-2", className)}>
      <div
        role="tablist"
        aria-label="Chat view"
        className="inline-flex rounded-full border border-neutral-200 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800/60 p-0.5"
      >
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
                const next = tab.value === "chat" ? "docs" : "chat";
                onTabChange(next);
              }
            }}
            className={cn(
              "px-5 py-1.5 text-sm font-medium rounded-full transition-all",
              activeTab === tab.value
                ? "bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 shadow-sm"
                : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
