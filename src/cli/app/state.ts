import type { ListItem, ListSelectState } from "./components/list-select.ts";
import { createListState } from "./components/list-select.ts";
import { getRuntimeEnv, type RuntimeEnv } from "#veryfront/config/runtime-env.ts";

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
  view: AppView;
  previousView: AppView | null;

  server: ServerStatus;
  mcp: MCPStatus;

  projects: ListSelectState<ProjectInfo>;
  examples: ListSelectState<ProjectInfo>;
  templates: ListSelectState<ProjectInfo>;

  activeList: "projects" | "examples" | "templates";
  selectedProject: ProjectInfo | null;

  wizard: {
    step: number;
    startType: "scratch" | "template" | "example" | null;
    selectedTemplate: string | null;
    integrations: string[];
    projectName: string;
  };

  input: InputState;

  logs: LogEntry[];
  maxLogs: number;
}

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

export type StateUpdater = (state: AppState) => AppState;

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
        data: { slug: p.slug, path: p.path, type: "local" },
      })),
    ),
  });
}

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
        data: { slug: e.slug, path: e.path, type: "example" },
      })),
    ),
  });
}

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
        data: { slug: t.id, path: "", type: "template" },
      })),
    ),
  });
}

export function updateServer(update: Partial<ServerStatus>): StateUpdater {
  return (state) => ({ ...state, server: { ...state.server, ...update } });
}

export function updateMCP(update: Partial<MCPStatus>): StateUpdater {
  return (state) => ({ ...state, mcp: { ...state.mcp, ...update } });
}

export function navigateTo(view: AppView): StateUpdater {
  return (state) => ({ ...state, view, previousView: state.view });
}

export function goBack(): StateUpdater {
  return (state) => ({
    ...state,
    view: state.previousView ?? "dashboard",
    previousView: null,
  });
}

export function setActiveList(
  list: "projects" | "examples" | "templates",
): StateUpdater {
  return (state) => ({ ...state, activeList: list });
}

export function updateActiveList(
  updater: (list: ListSelectState<ProjectInfo>) => ListSelectState<ProjectInfo>,
): StateUpdater {
  return (state) => {
    const key = state.activeList;
    return { ...state, [key]: updater(state[key]) };
  };
}

export function selectProject(project: ProjectInfo | null): StateUpdater {
  return (state) => {
    if (!project) return { ...state, selectedProject: null };

    return {
      ...state,
      selectedProject: project,
      view: "project-detail",
      previousView: state.view,
    };
  };
}

export function updateWizard(
  update: Partial<AppState["wizard"]>,
): StateUpdater {
  return (state) => ({ ...state, wizard: { ...state.wizard, ...update } });
}

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
      onCancel: onCancel ?? null,
    },
  });
}

export function updateInputValue(value: string, cursorPos: number): StateUpdater {
  return (state) => ({
    ...state,
    input: { ...state.input, value, cursorPos },
  });
}

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

export function addLog(level: LogEntry["level"], message: string): StateUpdater {
  return (state) => {
    const logs = [...state.logs, { time: new Date(), level, message }];
    if (logs.length > state.maxLogs) logs.shift();
    return { ...state, logs };
  };
}

export function clearLogs(): StateUpdater {
  return (state) => ({ ...state, logs: [] });
}

function shortenPath(path: string, env: RuntimeEnv = getRuntimeEnv()): string {
  const home = env.homeDir ?? "";
  if (!home || !path.startsWith(home)) return path;
  return `~${path.slice(home.length)}`;
}

export function getActiveSelection(
  state: AppState,
): ListItem<ProjectInfo> | undefined {
  const list = state[state.activeList];
  return list.items[list.selectedIndex];
}
