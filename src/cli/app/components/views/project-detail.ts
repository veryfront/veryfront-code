/**
 * Project Detail View
 *
 * Detailed view of a project with tabs for Dashboard, Files, Routes, Agents, Terminal, Logs.
 */

import { z } from "zod";
import { box } from "../../../ui/box.ts";
import { brand, dim, error as errorColor, muted, success } from "../../../ui/colors.ts";

// ============================================================================
// Schemas
// ============================================================================

export const ProjectTabSchema = z.enum([
  "dashboard",
  "files",
  "routes",
  "agents",
  "terminal",
  "logs",
]);

export type ProjectTab = z.infer<typeof ProjectTabSchema>;

export const ProjectInfoSchema = z.object({
  /** Project ID/slug */
  id: z.string(),
  /** Project name */
  name: z.string(),
  /** Local path */
  path: z.string(),
  /** Template used */
  template: z.string().optional(),
  /** Server status */
  serverStatus: z.enum(["running", "stopped", "starting", "error"]).optional(),
  /** Server URL */
  serverUrl: z.string().optional(),
  /** Created timestamp */
  createdAt: z.number().optional(),
  /** Last modified timestamp */
  modifiedAt: z.number().optional(),
});

export type ProjectInfo = z.infer<typeof ProjectInfoSchema>;

export const FileEntrySchema = z.object({
  /** File path relative to project root */
  path: z.string(),
  /** File name */
  name: z.string(),
  /** Is directory */
  isDirectory: z.boolean(),
  /** Depth in tree */
  depth: z.number(),
  /** Is expanded (for directories) */
  expanded: z.boolean().optional(),
});

export type FileEntry = z.infer<typeof FileEntrySchema>;

export const RouteEntrySchema = z.object({
  /** Route path */
  path: z.string(),
  /** HTTP method(s) */
  methods: z.array(z.string()),
  /** File path */
  filePath: z.string(),
  /** Route type */
  type: z.enum(["page", "api", "layout"]),
});

export type RouteEntry = z.infer<typeof RouteEntrySchema>;

export const ProjectDetailStateSchema = z.object({
  /** Project info */
  project: ProjectInfoSchema.nullable(),
  /** Active tab */
  activeTab: ProjectTabSchema,
  /** Files tree */
  files: z.array(FileEntrySchema),
  /** Routes list */
  routes: z.array(RouteEntrySchema),
  /** Selected index in current tab */
  selectedIndex: z.number(),
  /** Log lines */
  logs: z.array(z.string()),
});

export type ProjectDetailState = z.infer<typeof ProjectDetailStateSchema>;

// ============================================================================
// State Management
// ============================================================================

export type ProjectDetailUpdater = (state: ProjectDetailState) => ProjectDetailState;

/** Create initial project detail state */
export function createProjectDetail(project?: ProjectInfo): ProjectDetailState {
  return {
    project: project ?? null,
    activeTab: "dashboard",
    files: [],
    routes: [],
    selectedIndex: 0,
    logs: [],
  };
}

/** Set project */
export function setProject(project: ProjectInfo): ProjectDetailUpdater {
  return (state) => ({
    ...state,
    project,
  });
}

/** Set active tab */
export function setTab(tab: ProjectTab): ProjectDetailUpdater {
  return (state) => ({
    ...state,
    activeTab: tab,
    selectedIndex: 0,
  });
}

/** Cycle to next tab */
export function nextProjectTab(): ProjectDetailUpdater {
  const tabs: ProjectTab[] = ["dashboard", "files", "routes", "agents", "terminal", "logs"];
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
export function prevProjectTab(): ProjectDetailUpdater {
  const tabs: ProjectTab[] = ["dashboard", "files", "routes", "agents", "terminal", "logs"];
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

/** Set files */
export function setFiles(files: FileEntry[]): ProjectDetailUpdater {
  return (state) => ({
    ...state,
    files,
  });
}

/** Toggle file expansion */
export function toggleFileExpand(path: string): ProjectDetailUpdater {
  return (state) => ({
    ...state,
    files: state.files.map((f) =>
      f.path === path && f.isDirectory ? { ...f, expanded: !f.expanded } : f
    ),
  });
}

/** Set routes */
export function setRoutes(routes: RouteEntry[]): ProjectDetailUpdater {
  return (state) => ({
    ...state,
    routes,
  });
}

/** Move selection up */
export function projectMoveUp(): ProjectDetailUpdater {
  return (state) => {
    const count = getItemCount(state);
    if (count === 0) return state;

    const newIndex = state.selectedIndex > 0 ? state.selectedIndex - 1 : count - 1;

    return { ...state, selectedIndex: newIndex };
  };
}

/** Move selection down */
export function projectMoveDown(): ProjectDetailUpdater {
  return (state) => {
    const count = getItemCount(state);
    if (count === 0) return state;

    const newIndex = state.selectedIndex < count - 1 ? state.selectedIndex + 1 : 0;

    return { ...state, selectedIndex: newIndex };
  };
}

/** Add log line */
export function addLogLine(line: string): ProjectDetailUpdater {
  return (state) => ({
    ...state,
    logs: [...state.logs, line].slice(-500), // Keep last 500 lines
  });
}

/** Clear logs */
export function clearLogs(): ProjectDetailUpdater {
  return (state) => ({
    ...state,
    logs: [],
  });
}

// ============================================================================
// Selectors
// ============================================================================

/** Get visible files (respecting expanded state) */
export function getVisibleFiles(state: ProjectDetailState): FileEntry[] {
  const visible: FileEntry[] = [];
  const expandedPaths = new Set<string>();

  // First pass: collect expanded directories
  for (const file of state.files) {
    if (file.isDirectory && file.expanded) {
      expandedPaths.add(file.path);
    }
  }

  // Second pass: show files that are at root or under expanded parents
  for (const file of state.files) {
    if (file.depth === 0) {
      visible.push(file);
    } else {
      // Check if parent is expanded
      const parentPath = file.path.split("/").slice(0, -1).join("/");
      if (expandedPaths.has(parentPath)) {
        visible.push(file);
      }
    }
  }

  return visible;
}

/** Get item count for current tab */
export function getItemCount(state: ProjectDetailState): number {
  switch (state.activeTab) {
    case "files":
      return getVisibleFiles(state).length;
    case "routes":
      return state.routes.length;
    case "logs":
      return state.logs.length;
    default:
      return 0;
  }
}

/** Get selected file */
export function getSelectedFile(state: ProjectDetailState): FileEntry | null {
  if (state.activeTab !== "files") return null;
  const files = getVisibleFiles(state);
  return files[state.selectedIndex] ?? null;
}

/** Get selected route */
export function getSelectedRoute(state: ProjectDetailState): RouteEntry | null {
  if (state.activeTab !== "routes") return null;
  return state.routes[state.selectedIndex] ?? null;
}

// ============================================================================
// Rendering
// ============================================================================

/** Render tab bar */
export function renderProjectTabBar(state: ProjectDetailState): string {
  const tabs: Array<{ id: ProjectTab; label: string }> = [
    { id: "dashboard", label: "Dashboard" },
    { id: "files", label: "Files" },
    { id: "routes", label: "Routes" },
    { id: "agents", label: "Agents" },
    { id: "terminal", label: "Terminal" },
    { id: "logs", label: "Logs" },
  ];

  const tabStrings = tabs.map((tab) => {
    const isActive = tab.id === state.activeTab;
    return isActive ? brand(`[${tab.label}]`) : dim(tab.label);
  });

  return tabStrings.join("  ");
}

/** Render project header */
export function renderProjectHeader(state: ProjectDetailState): string {
  if (!state.project) return dim("No project selected");

  const lines: string[] = [];

  lines.push(brand(state.project.name));
  lines.push(dim(state.project.path));

  if (state.project.serverStatus) {
    const status = state.project.serverStatus === "running"
      ? success("● running")
      : state.project.serverStatus === "error"
      ? errorColor("● error")
      : dim(`○ ${state.project.serverStatus}`);

    lines.push(status + (state.project.serverUrl ? ` ${dim(state.project.serverUrl)}` : ""));
  }

  return lines.join("\n");
}

/** Render files tab */
export function renderFilesTab(state: ProjectDetailState, maxLines = 15): string {
  const files = getVisibleFiles(state);
  const lines: string[] = [];

  if (files.length === 0) {
    return dim("  No files");
  }

  const startIndex = Math.max(0, state.selectedIndex - Math.floor(maxLines / 2));
  const endIndex = Math.min(files.length, startIndex + maxLines);

  for (let i = startIndex; i < endIndex; i++) {
    const file = files[i];
    if (!file) continue;

    const isSelected = i === state.selectedIndex;
    const indent = "  ".repeat(file.depth);
    const indicator = isSelected ? brand("›") : " ";

    let icon: string;
    if (file.isDirectory) {
      icon = file.expanded ? "📂" : "📁";
    } else {
      icon = "📄";
    }

    const name = isSelected ? file.name : dim(file.name);
    lines.push(`${indicator} ${indent}${icon} ${name}`);
  }

  return lines.join("\n");
}

/** Render routes tab */
export function renderRoutesTab(state: ProjectDetailState, maxLines = 15): string {
  const lines: string[] = [];

  if (state.routes.length === 0) {
    return dim("  No routes");
  }

  const startIndex = Math.max(0, state.selectedIndex - Math.floor(maxLines / 2));
  const endIndex = Math.min(state.routes.length, startIndex + maxLines);

  for (let i = startIndex; i < endIndex; i++) {
    const route = state.routes[i];
    if (!route) continue;

    const isSelected = i === state.selectedIndex;
    const indicator = isSelected ? brand("›") : " ";
    const methods = route.methods.join(",");
    const methodStr = methods.padEnd(10);

    const path = isSelected ? route.path : dim(route.path);
    const type = dim(`[${route.type}]`);

    lines.push(`${indicator} ${methodStr} ${path} ${type}`);
  }

  return lines.join("\n");
}

/** Render dashboard tab */
export function renderDashboardTab(state: ProjectDetailState): string {
  if (!state.project) return dim("No project selected");

  const lines: string[] = [];

  lines.push(dim("Overview"));
  lines.push("");
  lines.push(`  ${dim("Files:")} ${state.files.length}`);
  lines.push(`  ${dim("Routes:")} ${state.routes.length}`);

  if (state.project.template) {
    lines.push(`  ${dim("Template:")} ${state.project.template}`);
  }

  lines.push("");
  lines.push(dim("Quick Actions"));
  lines.push("");
  lines.push(muted("  [o] Open in browser"));
  lines.push(muted("  [s] Open in Studio"));
  lines.push(muted("  [i] Open in IDE"));
  lines.push(muted("  [D] Deploy"));

  return lines.join("\n");
}

/** Render logs tab */
export function renderLogsTab(state: ProjectDetailState, maxLines = 15): string {
  if (state.logs.length === 0) {
    return dim("  No logs yet");
  }

  const lines = state.logs.slice(-maxLines);
  return lines.map((l) => dim(l)).join("\n");
}

/** Render project detail view */
export function renderProjectDetail(
  state: ProjectDetailState,
  width = 80,
  height = 20,
): string {
  const lines: string[] = [];

  // Header
  lines.push(renderProjectHeader(state));
  lines.push("");

  // Tab bar
  lines.push(renderProjectTabBar(state));
  lines.push(dim("─".repeat(width - 4)));

  // Tab content
  const contentHeight = height - 10;
  let content: string;

  switch (state.activeTab) {
    case "dashboard":
      content = renderDashboardTab(state);
      break;
    case "files":
      content = renderFilesTab(state, contentHeight);
      break;
    case "routes":
      content = renderRoutesTab(state, contentHeight);
      break;
    case "agents":
      content = dim("  Agents tab - coming soon");
      break;
    case "terminal":
      content = dim("  Terminal tab - coming soon");
      break;
    case "logs":
      content = renderLogsTab(state, contentHeight);
      break;
  }

  lines.push(content);

  // Footer
  lines.push("");
  lines.push(dim("─".repeat(width - 4)));
  lines.push(muted("Tab switch  ↑↓ select  Enter open  Esc back  ? help"));

  return box(lines.join("\n"), {
    style: "rounded",
    width,
    padding: 1,
  });
}

// ============================================================================
// Key Handling
// ============================================================================

export interface ProjectDetailKeyResult {
  handled: boolean;
  close: boolean;
  action?: "open" | "browser" | "studio" | "ide" | "deploy" | "expand";
  selectedFile?: FileEntry;
  selectedRoute?: RouteEntry;
  updater?: ProjectDetailUpdater;
}

/** Handle key in project detail */
export function handleProjectDetailKey(
  key: string,
  state: ProjectDetailState,
): ProjectDetailKeyResult {
  // Escape - close/back
  if (key === "\x1b") {
    return { handled: true, close: true };
  }

  // Tab - next tab
  if (key === "\t") {
    return { handled: true, close: false, updater: nextProjectTab() };
  }

  // Shift+Tab - previous tab
  if (key === "\x1b[Z") {
    return { handled: true, close: false, updater: prevProjectTab() };
  }

  // Up arrow or k
  if (key === "\x1b[A" || key === "k") {
    return { handled: true, close: false, updater: projectMoveUp() };
  }

  // Down arrow or j
  if (key === "\x1b[B" || key === "j") {
    return { handled: true, close: false, updater: projectMoveDown() };
  }

  // Enter - open/expand
  if (key === "\r" || key === "\n") {
    if (state.activeTab === "files") {
      const file = getSelectedFile(state);
      if (file?.isDirectory) {
        return {
          handled: true,
          close: false,
          action: "expand",
          updater: toggleFileExpand(file.path),
        };
      }
      return { handled: true, close: false, action: "open", selectedFile: file ?? undefined };
    }
    if (state.activeTab === "routes") {
      const route = getSelectedRoute(state);
      return { handled: true, close: false, action: "open", selectedRoute: route ?? undefined };
    }
    return { handled: true, close: false };
  }

  // o - open in browser
  if (key === "o") {
    return { handled: true, close: false, action: "browser" };
  }

  // s - open in studio
  if (key === "s") {
    return { handled: true, close: false, action: "studio" };
  }

  // i - open in IDE
  if (key === "i") {
    return { handled: true, close: false, action: "ide" };
  }

  // D - deploy
  if (key === "D") {
    return { handled: true, close: false, action: "deploy" };
  }

  // Number keys for tab selection
  const tabs: ProjectTab[] = ["dashboard", "files", "routes", "agents", "terminal", "logs"];
  if (/^[1-6]$/.test(key)) {
    const index = parseInt(key, 10) - 1;
    const tab = tabs[index];
    if (tab) {
      return { handled: true, close: false, updater: setTab(tab) };
    }
  }

  // Consume other keys
  return { handled: true, close: false };
}
