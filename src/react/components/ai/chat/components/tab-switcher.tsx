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
    <div className={cn("flex items-center justify-center py-2", className)}>
      <div
        role="tablist"
        aria-label="Chat view"
        className="inline-flex rounded-full border border-[var(--border)] bg-[var(--tab-background)] p-0.5"
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
                const next = tab.value === "chat" ? "uploads" : "chat";
                onTabChange(next);
              }
            }}
            className={cn(
              "px-5 py-1.5 text-sm font-medium rounded-full transition-all",
              activeTab === tab.value
                ? "bg-[var(--tab-active-background)] text-[var(--tab-active-foreground)] shadow-sm"
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
