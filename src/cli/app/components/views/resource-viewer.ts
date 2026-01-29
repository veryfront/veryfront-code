/**
 * Resource Viewer Component
 *
 * k9s-style resource browser for files, routes, agents, tools, and MCP connections.
 */

import { z } from "zod";
import { box } from "../../../ui/box.ts";
import { brand, dim, error as errorColor, muted, success } from "../../../ui/colors.ts";

// ============================================================================
// Schemas
// ============================================================================

export const ResourceTypeSchema = z.enum([
  "files",
  "routes",
  "agents",
  "tools",
  "mcp",
]);

export type ResourceType = z.infer<typeof ResourceTypeSchema>;

export const ResourceItemSchema = z.object({
  /** Unique ID */
  id: z.string(),
  /** Display name */
  name: z.string(),
  /** Resource type */
  type: ResourceTypeSchema,
  /** Status indicator */
  status: z.enum(["active", "inactive", "error", "pending"]).optional(),
  /** Description or path */
  description: z.string().optional(),
  /** Additional metadata */
  meta: z.record(z.string()).optional(),
});

export type ResourceItem = z.infer<typeof ResourceItemSchema>;

export const ResourceViewerStateSchema = z.object({
  /** Active tab */
  activeTab: ResourceTypeSchema,
  /** Resources by type */
  resources: z.record(ResourceTypeSchema, z.array(ResourceItemSchema)),
  /** Selected index in current tab */
  selectedIndex: z.number(),
  /** Filter query */
  filter: z.string(),
  /** Show detail pane */
  showDetail: z.boolean(),
});

export type ResourceViewerState = z.infer<typeof ResourceViewerStateSchema>;

// ============================================================================
// State Management
// ============================================================================

export type ResourceViewerUpdater = (state: ResourceViewerState) => ResourceViewerState;

/** Create initial resource viewer state */
export function createResourceViewer(): ResourceViewerState {
  return {
    activeTab: "files",
    resources: {
      files: [],
      routes: [],
      agents: [],
      tools: [],
      mcp: [],
    },
    selectedIndex: 0,
    filter: "",
    showDetail: true,
  };
}

/** Set active tab */
export function setActiveTab(tab: ResourceType): ResourceViewerUpdater {
  return (state) => ({
    ...state,
    activeTab: tab,
    selectedIndex: 0,
  });
}

/** Cycle to next tab */
export function nextTab(): ResourceViewerUpdater {
  const tabs: ResourceType[] = ["files", "routes", "agents", "tools", "mcp"];
  return (state) => {
    const currentIndex = tabs.indexOf(state.activeTab);
    const nextIndex = (currentIndex + 1) % tabs.length;
    return {
      ...state,
      activeTab: tabs[nextIndex]!,
      selectedIndex: 0,
    };
  };
}

/** Cycle to previous tab */
export function prevTab(): ResourceViewerUpdater {
  const tabs: ResourceType[] = ["files", "routes", "agents", "tools", "mcp"];
  return (state) => {
    const currentIndex = tabs.indexOf(state.activeTab);
    const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    return {
      ...state,
      activeTab: tabs[prevIndex]!,
      selectedIndex: 0,
    };
  };
}

/** Set resources for a type */
export function setResources(type: ResourceType, items: ResourceItem[]): ResourceViewerUpdater {
  return (state) => ({
    ...state,
    resources: {
      ...state.resources,
      [type]: items,
    },
  });
}

/** Move selection up */
export function moveUp(): ResourceViewerUpdater {
  return (state) => {
    const items = getFilteredItems(state);
    if (items.length === 0) return state;

    const newIndex = state.selectedIndex > 0 ? state.selectedIndex - 1 : items.length - 1;

    return { ...state, selectedIndex: newIndex };
  };
}

/** Move selection down */
export function moveDown(): ResourceViewerUpdater {
  return (state) => {
    const items = getFilteredItems(state);
    if (items.length === 0) return state;

    const newIndex = state.selectedIndex < items.length - 1 ? state.selectedIndex + 1 : 0;

    return { ...state, selectedIndex: newIndex };
  };
}

/** Set filter */
export function setFilter(filter: string): ResourceViewerUpdater {
  return (state) => ({
    ...state,
    filter,
    selectedIndex: 0,
  });
}

/** Clear filter */
export function clearFilter(): ResourceViewerUpdater {
  return (state) => ({
    ...state,
    filter: "",
    selectedIndex: 0,
  });
}

/** Toggle detail pane */
export function toggleDetail(): ResourceViewerUpdater {
  return (state) => ({
    ...state,
    showDetail: !state.showDetail,
  });
}

// ============================================================================
// Selectors
// ============================================================================

/** Get items for current tab */
export function getCurrentItems(state: ResourceViewerState): ResourceItem[] {
  return state.resources[state.activeTab] ?? [];
}

/** Get filtered items */
export function getFilteredItems(state: ResourceViewerState): ResourceItem[] {
  const items = getCurrentItems(state);
  if (!state.filter) return items;

  const query = state.filter.toLowerCase();
  return items.filter((item) =>
    item.name.toLowerCase().includes(query) ||
    item.description?.toLowerCase().includes(query)
  );
}

/** Get selected item */
export function getSelectedItem(state: ResourceViewerState): ResourceItem | null {
  const items = getFilteredItems(state);
  return items[state.selectedIndex] ?? null;
}

/** Get count for tab */
export function getTabCount(state: ResourceViewerState, tab: ResourceType): number {
  return state.resources[tab]?.length ?? 0;
}

// ============================================================================
// Rendering
// ============================================================================

/** Get icon for resource type */
function getTypeIcon(type: ResourceType): string {
  switch (type) {
    case "files":
      return "📄";
    case "routes":
      return "🔗";
    case "agents":
      return "🤖";
    case "tools":
      return "🔧";
    case "mcp":
      return "⚡";
  }
}

/** Get status indicator */
function getStatusIndicator(status?: string): string {
  switch (status) {
    case "active":
      return success("●");
    case "inactive":
      return dim("○");
    case "error":
      return errorColor("●");
    case "pending":
      return muted("◐");
    default:
      return " ";
  }
}

/** Render tab bar */
export function renderTabBar(state: ResourceViewerState): string {
  const tabs: ResourceType[] = ["files", "routes", "agents", "tools", "mcp"];

  const tabStrings = tabs.map((tab) => {
    const icon = getTypeIcon(tab);
    const count = getTabCount(state, tab);
    const label = `${icon} ${tab.charAt(0).toUpperCase() + tab.slice(1)} (${count})`;

    return tab === state.activeTab ? brand(`[${label}]`) : dim(label);
  });

  return tabStrings.join("  ");
}

/** Render resource list */
export function renderResourceList(
  state: ResourceViewerState,
  maxHeight = 15,
): string {
  const items = getFilteredItems(state);
  const lines: string[] = [];

  // Filter input
  if (state.filter) {
    lines.push(`${dim("Filter:")} ${state.filter}`);
    lines.push("");
  }

  if (items.length === 0) {
    lines.push(dim("  No resources found"));
    return lines.join("\n");
  }

  // Render items (with scrolling)
  const startIndex = Math.max(0, state.selectedIndex - Math.floor(maxHeight / 2));
  const endIndex = Math.min(items.length, startIndex + maxHeight);

  for (let i = startIndex; i < endIndex; i++) {
    const item = items[i];
    if (!item) continue;

    const isSelected = i === state.selectedIndex;
    const indicator = isSelected ? brand("›") : " ";
    const status = getStatusIndicator(item.status);
    const name = isSelected ? item.name : dim(item.name);

    lines.push(`${indicator} ${status} ${name}`);
  }

  // Show scroll indicator
  if (items.length > maxHeight) {
    const shown = endIndex - startIndex;
    lines.push(dim(`  ... ${items.length - shown} more`));
  }

  return lines.join("\n");
}

/** Render detail pane */
export function renderDetailPane(state: ResourceViewerState, width = 35): string {
  const item = getSelectedItem(state);

  if (!item) {
    return dim("No item selected");
  }

  const lines: string[] = [];

  // Header
  lines.push(brand(item.name));
  lines.push(dim("─".repeat(width - 4)));

  // Status
  if (item.status) {
    lines.push(`${dim("Status:")} ${getStatusIndicator(item.status)} ${item.status}`);
  }

  // Type
  lines.push(`${dim("Type:")} ${item.type}`);

  // Description
  if (item.description) {
    lines.push("");
    lines.push(item.description);
  }

  // Metadata
  if (item.meta && Object.keys(item.meta).length > 0) {
    lines.push("");
    lines.push(dim("Details:"));
    for (const [key, value] of Object.entries(item.meta)) {
      lines.push(`  ${dim(key + ":")} ${value}`);
    }
  }

  // Actions
  lines.push("");
  lines.push(dim("Actions:"));
  lines.push(muted("  [l]ogs [d]escribe [e]dit [y]ank"));

  return lines.join("\n");
}

/** Render full resource viewer */
export function renderResourceViewer(
  state: ResourceViewerState,
  width = 80,
  height = 20,
): string {
  const lines: string[] = [];

  // Tab bar
  lines.push(renderTabBar(state));
  lines.push(dim("─".repeat(width - 4)));

  // Split pane
  const listWidth = state.showDetail ? Math.floor(width * 0.55) : width - 4;
  const detailWidth = width - listWidth - 6;
  const contentHeight = height - 6;

  const listContent = renderResourceList(state, contentHeight);
  const detailContent = state.showDetail ? renderDetailPane(state, detailWidth) : "";

  const listLines = listContent.split("\n");
  const detailLines = detailContent.split("\n");

  const maxLines = Math.max(listLines.length, detailLines.length);

  for (let i = 0; i < maxLines; i++) {
    const listLine = (listLines[i] ?? "").padEnd(listWidth);
    if (state.showDetail) {
      const detailLine = detailLines[i] ?? "";
      lines.push(`${listLine}│${detailLine}`);
    } else {
      lines.push(listLine);
    }
  }

  // Footer
  lines.push(dim("─".repeat(width - 4)));
  lines.push(muted("Tab switch  ↑↓ select  / filter  Enter open  d detail  ? help"));

  return box(lines.join("\n"), {
    title: "Resources",
    titleAlign: "left",
    style: "rounded",
    width,
    padding: 1,
  });
}

// ============================================================================
// Key Handling
// ============================================================================

export interface ResourceViewerKeyResult {
  handled: boolean;
  close: boolean;
  action?: "open" | "logs" | "describe" | "edit" | "yank";
  selectedItem?: ResourceItem;
  updater?: ResourceViewerUpdater;
}

/** Handle key in resource viewer */
export function handleResourceViewerKey(
  key: string,
  state: ResourceViewerState,
): ResourceViewerKeyResult {
  // Escape - close
  if (key === "\x1b") {
    return { handled: true, close: true };
  }

  // Tab - next tab
  if (key === "\t") {
    return { handled: true, close: false, updater: nextTab() };
  }

  // Shift+Tab - previous tab
  if (key === "\x1b[Z") {
    return { handled: true, close: false, updater: prevTab() };
  }

  // Up arrow or k
  if (key === "\x1b[A" || key === "k") {
    return { handled: true, close: false, updater: moveUp() };
  }

  // Down arrow or j
  if (key === "\x1b[B" || key === "j") {
    return { handled: true, close: false, updater: moveDown() };
  }

  // Enter - open
  if (key === "\r" || key === "\n") {
    const item = getSelectedItem(state);
    return { handled: true, close: false, action: "open", selectedItem: item ?? undefined };
  }

  // l - logs
  if (key === "l") {
    const item = getSelectedItem(state);
    return { handled: true, close: false, action: "logs", selectedItem: item ?? undefined };
  }

  // d - describe/detail toggle
  if (key === "d") {
    return { handled: true, close: false, updater: toggleDetail() };
  }

  // e - edit
  if (key === "e") {
    const item = getSelectedItem(state);
    return { handled: true, close: false, action: "edit", selectedItem: item ?? undefined };
  }

  // y - yank (copy)
  if (key === "y") {
    const item = getSelectedItem(state);
    return { handled: true, close: false, action: "yank", selectedItem: item ?? undefined };
  }

  // / - start filter
  if (key === "/") {
    // This would normally enter filter mode
    return { handled: true, close: false };
  }

  // Number keys for tab selection
  if (/^[1-5]$/.test(key)) {
    const tabs: ResourceType[] = ["files", "routes", "agents", "tools", "mcp"];
    const index = parseInt(key, 10) - 1;
    const tab = tabs[index];
    if (tab) {
      return { handled: true, close: false, updater: setActiveTab(tab) };
    }
  }

  // Consume other keys
  return { handled: true, close: false };
}
