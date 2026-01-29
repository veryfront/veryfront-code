// Tab Bar Component
// Horizontal navigation tabs for main views

import { brand, dim, muted } from "../../ui/colors.ts";

export interface Tab {
  id: string;
  label: string;
  shortcut?: string;
}

export interface TabBarOptions {
  tabs: Tab[];
  activeTabId: string;
}

export function renderTabBar(options: TabBarOptions): string {
  const { tabs, activeTabId } = options;

  const tabStrings = tabs.map((tab) => {
    const isActive = tab.id === activeTabId;
    const shortcutHint = tab.shortcut ? dim(`[${tab.shortcut}]`) : "";

    if (isActive) {
      // Active tab: highlighted with box
      return ` ${brand("[")}${brand(tab.label)}${brand("]")} ${shortcutHint}`;
    } else {
      // Inactive tab: dimmed
      return ` ${dim("[")}${muted(tab.label)}${dim("]")} ${shortcutHint}`;
    }
  });

  return tabStrings.join("  ");
}

// Default tabs for the main app
// Alt+number for quick navigation
export const MAIN_TABS: Tab[] = [
  { id: "dashboard", label: "Dashboard", shortcut: "⌥1" },
  { id: "new-project", label: "New", shortcut: "⌥2" },
  { id: "code", label: "Code", shortcut: "⌥3" },
  { id: "resources", label: "Resources", shortcut: "⌥4" },
];

export function getTabIndex(tabId: string): number {
  return MAIN_TABS.findIndex((t) => t.id === tabId);
}

export function getTabById(tabId: string): Tab | undefined {
  return MAIN_TABS.find((t) => t.id === tabId);
}

export function getNextTab(currentTabId: string): string {
  const currentIndex = getTabIndex(currentTabId);
  const nextIndex = (currentIndex + 1) % MAIN_TABS.length;
  return MAIN_TABS[nextIndex]?.id ?? "dashboard";
}

export function getPrevTab(currentTabId: string): string {
  const currentIndex = getTabIndex(currentTabId);
  const prevIndex = currentIndex <= 0 ? MAIN_TABS.length - 1 : currentIndex - 1;
  return MAIN_TABS[prevIndex]?.id ?? "dashboard";
}
