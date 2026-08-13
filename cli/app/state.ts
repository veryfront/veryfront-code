import type { ListItem, ListSelectState } from "./components/list-select.ts";
import { createListState } from "./components/list-select.ts";
import { type EnvironmentConfig, getEnvironmentConfig } from "veryfront/config";
import { cwd } from "veryfront/platform";
import { join } from "veryfront/platform/path";
import type { InitTemplate } from "../commands/init/types.ts";

export type AppView =
  | "dashboard"
  | "new-project"
  | "templates"
  | "auth"
  | "help";

export interface ProjectInfo {
  slug: string;
  path: string;
  type: "local" | "template" | "remote";
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
}

/**
 * Why the app is asking for text. Declarative so the key transition stays a
 * pure function of state, a callback here would put behaviour back in state.
 */
export type InputPurpose = { kind: "create-project"; template: InitTemplate };

export interface InputState {
  active: boolean;
  prompt: string;
  value: string;
  cursorPos: number;
  purpose: InputPurpose | null;
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

  /**
   * Selectable lists. `activeList` indexes this state directly, so every list
   * it can name must be a ListSelectState living at the top level.
   */
  projects: ListSelectState<ProjectInfo>;
  remoteProjects: ListSelectState<ProjectInfo>;
  templates: ListSelectState<ProjectInfo>;

  activeList: "projects" | "remoteProjects";

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
      url: "http://localhost:8080",
      port: 8080,
      errors: 0,
      warnings: 0,
    },
    mcp: {
      enabled: false,
      transport: null,
      connected: false,
    },
    remote: { user: null },
    projects: createListState([]),
    remoteProjects: createListState([]),
    templates: createListState([]),
    activeList: "projects",
    input: {
      active: false,
      prompt: "",
      value: "",
      cursorPos: 0,
      purpose: null,
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

/**
 * Remote projects are the same concept as local ones and navigate through the
 * same list module. A remote project's path is where a pull would put it.
 */
export function setRemoteProjects(
  projects: Array<{ slug: string }>,
): StateUpdater {
  return (state) =>
    withSelectableActiveList({
      ...state,
      remoteProjects: createListState(
        projects.map((p) => ({
          id: p.slug,
          label: p.slug,
          data: { slug: p.slug, path: remoteProjectPath(p.slug), type: "remote" as const },
        })),
      ),
    });
}

/** Where `pull` places a remote project, and what the IDE opens. */
export function remoteProjectPath(slug: string): string {
  return join(cwd(), "projects", slug);
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

/**
 * The dashboard renders the remote section only for a signed-in user with at
 * least one project. Pointing `activeList` at a section that is not rendered
 * shows no cursor anywhere and resolves action keys to no project, so keep the
 * two in step whenever either input changes.
 */
function withSelectableActiveList(state: AppState): AppState {
  if (state.activeList !== "remoteProjects") return state;

  const selectable = !!state.remote.user && state.remoteProjects.items.length > 0;
  return selectable ? state : { ...state, activeList: "projects" };
}

export function setRemoteUser(user: RemoteState["user"]): StateUpdater {
  return (state) => withSelectableActiveList({ ...state, remote: { ...state.remote, user } });
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
  list: "projects" | "remoteProjects",
): StateUpdater {
  return (state) => ({ ...state, activeList: list });
}

export function updateActiveList(
  updater: (list: ListSelectState<ProjectInfo>) => ListSelectState<ProjectInfo>,
): StateUpdater {
  return (state) => ({ ...state, [state.activeList]: updater(state[state.activeList]) });
}

export function startInput(
  prompt: string,
  purpose: InputPurpose,
  initialValue?: string,
): StateUpdater {
  return (state) => ({
    ...state,
    input: {
      active: true,
      prompt,
      value: initialValue ?? "",
      cursorPos: initialValue?.length ?? 0,
      purpose,
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
      purpose: null,
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

export function getActiveList(state: AppState): ListSelectState<ProjectInfo> {
  return state[state.activeList];
}

export function getActiveSelection(
  state: AppState,
): ListItem<ProjectInfo> | undefined {
  const list = getActiveList(state);
  return list.items[list.selectedIndex];
}
