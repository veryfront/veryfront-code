import * as React from "react";
import { cn } from "../../theme.ts";

export type ChatTab = "chat" | "docs";

export interface TabSwitcherProps {
  activeTab: ChatTab;
  onTabChange: (tab: ChatTab) => void;
  className?: string;
}

export function TabSwitcher({
  activeTab,
  onTabChange,
  className,
}: TabSwitcherProps): React.ReactElement {
  return (
    <div className={cn("flex items-center justify-center py-2", className)}>
      <div className="inline-flex rounded-full border border-neutral-200 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800/60 p-0.5">
        <button
          type="button"
          onClick={() => onTabChange("chat")}
          className={cn(
            "px-5 py-1.5 text-sm font-medium rounded-full transition-all",
            activeTab === "chat"
              ? "bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 shadow-sm"
              : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300",
          )}
        >
          Chat
        </button>
        <button
          type="button"
          onClick={() => onTabChange("docs")}
          className={cn(
            "px-5 py-1.5 text-sm font-medium rounded-full transition-all",
            activeTab === "docs"
              ? "bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 shadow-sm"
              : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300",
          )}
        >
          Docs
        </button>
      </div>
    </div>
  );
}
