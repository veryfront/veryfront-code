import type { ListItem, ListSelectState } from "./components/list-select.ts";
import { createListState } from "./components/list-select.ts";
import { type EnvironmentConfig, getEnvironmentConfig } from "veryfront/config";
import { cwd } from "veryfront/platform";

export type AppView =
  | "dashboard"
  | "project-detail"
  | "new-project"
  | "templates"
  | "examples"
  | "auth"
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

export interface RemoteState {
  user: { email: string; name?: string } | null;
  projects: Array<{ id: string; name: string; slug: string }>;
  /** Currently focused index in remote projects list */
  focusedIndex: number;
  /** Scroll offset for remote projects list */
  scrollOffset: number;
}

export interface InputState {
  active: boolean;
  prompt: string;
  value: string;
  cursorPos: number;
  onSubmit: ((value: string) => void) | null;
  onCancel: (() => void) | null;
}

export interface LogMeta {
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  project?: string;
  env?: string;
  releaseId?: string;
}

export interface LogEntry {
  time: Date;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  meta?: LogMeta;
}

export interface AppState {
  view: AppView;
  previousView: AppView | null;

  server: ServerStatus;
  mcp: MCPStatus;
  remote: RemoteState;

  projects: ListSelectState<ProjectInfo>;
  examples: ListSelectState<ProjectInfo>;
  templates: ListSelectState<ProjectInfo>;

  activeList: "projects" | "examples" | "templates" | "remoteProjects";
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
  logsExpanded: boolean;
  logScroll: number;

  /** Auth provider selection index (0=Google, 1=GitHub, 2=Microsoft) */
  authProviderIndex: number;
  /** New project option index (0=template, 1=example, 2=scratch) */
  newProjectIndex: number;
  /** Show expanded help */
  showHelp: boolean;
}

export function createInitialState(): AppState {
  return {
    view: "dashboard",
    previousView: null,
    server: {
      running: false,
      url: "http://veryfront.me:8080",
      port: 8080,
      errors: 0,
      warnings: 0,
    },
    mcp: {
      enabled: false,
      transport: null,
      connected: false,
    },
    remote: {
      user: null,
      projects: [],
      focusedIndex: 0,
      scrollOffset: 0,
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
    logsExpanded: false,
    logScroll: 0,
    authProviderIndex: 0,
    newProjectIndex: 0,
    showHelp: false,
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

export function updateRemote(update: Partial<RemoteState>): StateUpdater {
  return (state) => ({ ...state, remote: { ...state.remote, ...update } });
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
  list: "projects" | "examples" | "templates" | "remoteProjects",
): StateUpdater {
  return (state) => ({ ...state, activeList: list });
}

export function updateActiveList(
  updater: (list: ListSelectState<ProjectInfo>) => ListSelectState<ProjectInfo>,
): StateUpdater {
  return (state) => {
    if (state.activeList === "remoteProjects") return state;
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

export function updateWizard(update: Partial<AppState["wizard"]>): StateUpdater {
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
  initialValue?: string,
): StateUpdater {
  return (state) => ({
    ...state,
    input: {
      active: true,
      prompt,
      value: initialValue ?? "",
      cursorPos: initialValue?.length ?? 0,
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

export function addLog(
  level: LogEntry["level"],
  message: string,
  meta?: LogMeta,
): StateUpdater {
  return (state) => {
    const logs = [...state.logs, { time: new Date(), level, message, meta }];
    if (logs.length > state.maxLogs) logs.shift();
    return { ...state, logs };
  };
}

export function clearLogs(): StateUpdater {
  return (state) => ({ ...state, logs: [], logScroll: 0 });
}

export function toggleLogsExpanded(): StateUpdater {
  return (state) => ({
    ...state,
    logsExpanded: !state.logsExpanded,
    logScroll: 0,
  });
}

export function toggleHelp(): StateUpdater {
  return (state) => ({ ...state, showHelp: !state.showHelp });
}

export function scrollLogs(direction: "up" | "down"): StateUpdater {
  return (state) => {
    if (!state.logsExpanded) return state;

    const maxScroll = Math.max(0, state.logs.length - 5);
    const delta = direction === "up" ? 1 : -1;
    const newScroll = Math.min(maxScroll, Math.max(0, state.logScroll + delta));

    return { ...state, logScroll: newScroll };
  };
}

function shortenPath(path: string, env: EnvironmentConfig = getEnvironmentConfig()): string {
  // Prefer relative path to cwd
  const currentDir = cwd();
  const cwdPrefix = `${currentDir}/`;

  if (path === currentDir) return "./";
  if (path.startsWith(cwdPrefix)) return `./${path.slice(cwdPrefix.length)}`;

  // Fall back to ~ for home
  const home = env.homeDir ?? "";
  if (home && path.startsWith(home)) return `~${path.slice(home.length)}`;

  return path;
}

export function getActiveSelection(
  state: AppState,
): ListItem<ProjectInfo> | undefined {
  if (state.activeList === "remoteProjects") return undefined;
  const list = state[state.activeList];
  return list.items[list.selectedIndex];
}
