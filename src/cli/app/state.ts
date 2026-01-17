/**
 * CLI App State Management
 *
 * Centralized state for the interactive CLI app.
 * Manages views, projects, server status, and MCP connections.
 */

import type { ListItem, ListSelectState } from "./components/list-select.ts";
import { createListState } from "./components/list-select.ts";
import { getEnv } from "@veryfront/platform/compat/process.ts";

// ============================================================================
// Types
// ============================================================================

export type AppView =
  | "dashboard"
  | "project-detail"
  | "new-project"
  | "templates"
  | "help";

export interface ProjectInfo {
  slug: string;
  path: string;
  type: "local" | "example" | "template";
}

export interface ServerStatus {
  running: boolean;
  url: string;
  port: number;
  errors: number;
  warnings: number;
}

export interface MCPStatus {
  enabled: boolean;
  transport: "stdio" | "http" | null;
  connected: boolean;
  clientName?: string;
  httpPort?: number;
}

export interface InputState {
  active: boolean;
  prompt: string;
  value: string;
  cursorPos: number;
  onSubmit: ((value: string) => void) | null;
  onCancel: (() => void) | null;
}

export interface LogEntry {
  time: Date;
  level: "info" | "warn" | "error" | "debug";
  message: string;
}

export interface AppState {
  // Navigation
  view: AppView;
  previousView: AppView | null;

  // Server
  server: ServerStatus;

  // MCP
  mcp: MCPStatus;

  // Projects
  projects: ListSelectState<ProjectInfo>;
  examples: ListSelectState<ProjectInfo>;
  templates: ListSelectState<ProjectInfo>;

  // Active selection (which list is focused)
  activeList: "projects" | "examples" | "templates";

  // Selected project for detail view
  selectedProject: ProjectInfo | null;

  // Wizard state
  wizard: {
    step: number;
    startType: "scratch" | "template" | "example" | null;
    selectedTemplate: string | null;
    integrations: string[];
    projectName: string;
  };

  // Input state for inline prompts
  input: InputState;

  // Server logs buffer
  logs: LogEntry[];
  maxLogs: number;
}

// ============================================================================
// Initial State
// ============================================================================

export function createInitialState(): AppState {
  return {
    view: "dashboard",
    previousView: null,

    server: {
      running: false,
      url: "http://lvh.me:8080",
      port: 8080,
      errors: 0,
      warnings: 0,
    },

    mcp: {
      enabled: false,
      transport: null,
      connected: false,
    },

    projects: createListState([]),
    examples: createListState([]),
    templates: createListState([]),

    activeList: "projects",
    selectedProject: null,

    wizard: {
      step: 0,
      startType: null,
      selectedTemplate: null,
      integrations: [],
      projectName: "",
    },

    input: {
      active: false,
      prompt: "",
      value: "",
      cursorPos: 0,
      onSubmit: null,
      onCancel: null,
    },

    logs: [],
    maxLogs: 100,
  };
}

// ============================================================================
// State Updates
// ============================================================================

export type StateUpdater = (state: AppState) => AppState;

/**
 * Set projects list
 */
export function setProjects(
  projects: Array<{ slug: string; path: string }>,
): StateUpdater {
  return (state) => ({
    ...state,
    projects: createListState(
      projects.map((p) => ({
        id: p.slug,
        label: p.slug,
        meta: shortenPath(p.path),
        data: { slug: p.slug, path: p.path, type: "local" as const },
      })),
    ),
  });
}

/**
 * Set examples list
 */
export function setExamples(
  examples: Array<{ slug: string; path: string; description?: string }>,
): StateUpdater {
  return (state) => ({
    ...state,
    examples: createListState(
      examples.map((e) => ({
        id: e.slug,
        label: e.slug,
        description: e.description,
        data: { slug: e.slug, path: e.path, type: "example" as const },
      })),
    ),
  });
}

/**
 * Set templates list
 */
export function setTemplates(
  templates: Array<{ id: string; name: string; description: string }>,
): StateUpdater {
  return (state) => ({
    ...state,
    templates: createListState(
      templates.map((t) => ({
        id: t.id,
        label: t.name,
        description: t.description,
        data: { slug: t.id, path: "", type: "template" as const },
      })),
    ),
  });
}

/**
 * Update server status
 */
export function updateServer(update: Partial<ServerStatus>): StateUpdater {
  return (state) => ({
    ...state,
    server: { ...state.server, ...update },
  });
}

/**
 * Update MCP status
 */
export function updateMCP(update: Partial<MCPStatus>): StateUpdater {
  return (state) => ({
    ...state,
    mcp: { ...state.mcp, ...update },
  });
}

/**
 * Navigate to a view
 */
export function navigateTo(view: AppView): StateUpdater {
  return (state) => ({
    ...state,
    view,
    previousView: state.view,
  });
}

/**
 * Go back to previous view
 */
export function goBack(): StateUpdater {
  return (state) => ({
    ...state,
    view: state.previousView || "dashboard",
    previousView: null,
  });
}

/**
 * Set active list (which list receives keyboard input)
 */
export function setActiveList(
  list: "projects" | "examples" | "templates",
): StateUpdater {
  return (state) => ({
    ...state,
    activeList: list,
  });
}

/**
 * Update the active list's state
 */
export function updateActiveList(
  updater: (list: ListSelectState<ProjectInfo>) => ListSelectState<ProjectInfo>,
): StateUpdater {
  return (state) => {
    const key = state.activeList;
    return {
      ...state,
      [key]: updater(state[key]),
    };
  };
}

/**
 * Select a project for detail view
 */
export function selectProject(project: ProjectInfo | null): StateUpdater {
  return (state) => ({
    ...state,
    selectedProject: project,
    view: project ? "project-detail" : state.view,
    previousView: project ? state.view : state.previousView,
  });
}

/**
 * Update wizard state
 */
export function updateWizard(
  update: Partial<AppState["wizard"]>,
): StateUpdater {
  return (state) => ({
    ...state,
    wizard: { ...state.wizard, ...update },
  });
}

/**
 * Reset wizard to initial state
 */
export function resetWizard(): StateUpdater {
  return (state) => ({
    ...state,
    wizard: {
      step: 0,
      startType: null,
      selectedTemplate: null,
      integrations: [],
      projectName: "",
    },
  });
}

/**
 * Start input mode with a prompt
 */
export function startInput(
  prompt: string,
  onSubmit: (value: string) => void,
  onCancel?: () => void,
): StateUpdater {
  return (state) => ({
    ...state,
    input: {
      active: true,
      prompt,
      value: "",
      cursorPos: 0,
      onSubmit,
      onCancel: onCancel || null,
    },
  });
}

/**
 * Update input value
 */
export function updateInputValue(value: string, cursorPos: number): StateUpdater {
  return (state) => ({
    ...state,
    input: {
      ...state.input,
      value,
      cursorPos,
    },
  });
}

/**
 * End input mode
 */
export function endInput(): StateUpdater {
  return (state) => ({
    ...state,
    input: {
      active: false,
      prompt: "",
      value: "",
      cursorPos: 0,
      onSubmit: null,
      onCancel: null,
    },
  });
}

/**
 * Add a log entry
 */
export function addLog(level: LogEntry["level"], message: string): StateUpdater {
  return (state) => {
    const newLog: LogEntry = { time: new Date(), level, message };
    const logs = [...state.logs, newLog];
    // Keep only maxLogs entries
    if (logs.length > state.maxLogs) {
      logs.shift();
    }
    return { ...state, logs };
  };
}

/**
 * Clear all logs
 */
export function clearLogs(): StateUpdater {
  return (state) => ({
    ...state,
    logs: [],
  });
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Shorten path for display (replace home dir with ~)
 */
function shortenPath(path: string): string {
  const home = getEnv("HOME") || getEnv("USERPROFILE") || "";
  if (home && path.startsWith(home)) {
    return "~" + path.slice(home.length);
  }
  return path;
}

/**
 * Get currently selected item from active list
 */
export function getActiveSelection(state: AppState): ListItem<ProjectInfo> | undefined {
  const list = state[state.activeList];
  return list.items[list.selectedIndex];
}
