// TUI Application State
// Simple, focused state management for Veryfront Code

import type { ListItem, ListSelectState } from "./components/list-select.ts";
import { createListState } from "./components/list-select.ts";
import { getRuntimeEnv, type RuntimeEnv } from "#veryfront/config/runtime-env.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import {
  type CodingAgentDef,
  type CodingAgentState,
  type CommandPaletteState,
  createCodingAgentState,
  createCommandPaletteState,
  createKeyChordState,
  type KeyChordState,
  type Mode,
} from "./core/types.ts";

// ============================================================================
// Views
// ============================================================================

export type AppView =
  | "dashboard" // Local/Remote/Templates/Examples
  | "code" // Coding agent (PTY passthrough)
  | "resources" // k9s-style browser (Files/Routes/Agents/Tools/MCP)
  | "new-project" // Create from selected template/example
  | "templates" // Template selection (sub-view of new-project)
  | "examples" // Example selection (sub-view of new-project)
  | "auth" // Login providers
  | "help"; // Keybindings + MCP config

export type DashboardSection = "projects" | "remote" | "templates" | "examples";
export type ResourceTab = "files" | "routes" | "agents" | "tools" | "mcp";

// ============================================================================
// Data Types
// ============================================================================

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
  focusedIndex: number;
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

export interface CodeViewState {
  agent: CodingAgentDef | null;
  model: string | null;
  projectPath: string | null; // null = root (multi-project)
  running: boolean;
}

// ============================================================================
// App State
// ============================================================================

export interface AppState {
  // Navigation
  view: AppView;
  previousView: AppView | null;

  // Mode system
  mode: Mode;
  keyChord: KeyChordState;
  commandPalette: CommandPaletteState;

  // Server
  server: ServerStatus;
  mcp: MCPStatus;

  // Dashboard sections
  activeSection: DashboardSection;
  projects: ListSelectState<ProjectInfo>;
  templates: ListSelectState<ProjectInfo>;
  examples: ListSelectState<ProjectInfo>;
  remote: RemoteState;

  // Code view
  code: CodeViewState;

  // Agent state (picker, installed agents)
  agents: CodingAgentState;

  // Resources view
  resourceTab: ResourceTab;
  activeProject: ProjectInfo | null;

  // Input
  input: InputState;

  // Logs
  logs: LogEntry[];
  maxLogs: number;
  logsExpanded: boolean;
  logScroll: number;

  // UI state
  authProviderIndex: number;
  newProjectIndex: number;
  codeMenuIndex: number;
  showHelp: boolean;
}

// ============================================================================
// Initial State
// ============================================================================

export function createInitialState(): AppState {
  return {
    view: "dashboard",
    previousView: null,
    mode: "NORMAL",
    keyChord: createKeyChordState(),
    commandPalette: createCommandPaletteState(),
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
    activeSection: "projects",
    projects: createListState([]),
    templates: createListState([]),
    examples: createListState([]),
    remote: {
      user: null,
      projects: [],
      focusedIndex: 0,
      scrollOffset: 0,
    },
    code: {
      agent: null,
      model: null,
      projectPath: null,
      running: false,
    },
    agents: createCodingAgentState(),
    resourceTab: "files",
    activeProject: null,
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
    codeMenuIndex: 0,
    showHelp: false,
  };
}

// ============================================================================
// State Updaters
// ============================================================================

export type StateUpdater = (state: AppState) => AppState;

// Navigation
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

// Server
export function updateServer(update: Partial<ServerStatus>): StateUpdater {
  return (state) => ({ ...state, server: { ...state.server, ...update } });
}

export function updateMCP(update: Partial<MCPStatus>): StateUpdater {
  return (state) => ({ ...state, mcp: { ...state.mcp, ...update } });
}

// Dashboard
export function setActiveSection(section: DashboardSection): StateUpdater {
  return (state) => ({ ...state, activeSection: section });
}

export function setProjects(projects: Array<{ slug: string; path: string }>): StateUpdater {
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

export function updateRemote(update: Partial<RemoteState>): StateUpdater {
  return (state) => ({ ...state, remote: { ...state.remote, ...update } });
}

export function updateActiveList(
  updater: (list: ListSelectState<ProjectInfo>) => ListSelectState<ProjectInfo>,
): StateUpdater {
  return (state) => {
    const section = state.activeSection;
    if (section === "remote") return state;
    return { ...state, [section]: updater(state[section]) };
  };
}

// Code view
export function enterCodeView(projectPath: string | null): StateUpdater {
  return (state) => ({
    ...state,
    view: "code",
    previousView: state.view,
    code: { ...state.code, projectPath },
  });
}

export function setCodeAgent(agent: CodingAgentDef | null, model?: string): StateUpdater {
  return (state) => ({
    ...state,
    code: { ...state.code, agent, model: model ?? agent?.defaultModel ?? null },
  });
}

export function setCodeRunning(running: boolean): StateUpdater {
  return (state) => ({ ...state, code: { ...state.code, running } });
}

// Agent picker
export function openAgentPicker(): StateUpdater {
  return (state) => ({
    ...state,
    agents: { ...state.agents, pickerOpen: true, pickerIndex: 0 },
  });
}

export function closeAgentPicker(): StateUpdater {
  return (state) => ({
    ...state,
    agents: { ...state.agents, pickerOpen: false },
  });
}

export function moveAgentPicker(delta: number): StateUpdater {
  return (state) => {
    const maxIndex = state.agents.agents.length - 1;
    let newIndex = state.agents.pickerIndex + delta;
    if (newIndex < 0) newIndex = maxIndex;
    if (newIndex > maxIndex) newIndex = 0;
    return { ...state, agents: { ...state.agents, pickerIndex: newIndex } };
  };
}

export function selectAgent(agent: CodingAgentDef | null): StateUpdater {
  return (state) => ({
    ...state,
    agents: {
      ...state.agents,
      activeAgent: agent,
      activeModel: agent?.defaultModel ?? null,
      pickerOpen: false,
    },
    code: {
      ...state.code,
      agent,
      model: agent?.defaultModel ?? null,
    },
  });
}

export function setModel(model: string | null): StateUpdater {
  return (state) => ({
    ...state,
    agents: { ...state.agents, activeModel: model },
    code: { ...state.code, model },
  });
}

export function setAgents(agents: CodingAgentDef[], installed: string[]): StateUpdater {
  return (state) => ({
    ...state,
    agents: { ...state.agents, agents, installedAgents: installed },
  });
}

// Resources view
export function setResourceTab(tab: ResourceTab): StateUpdater {
  return (state) => ({ ...state, resourceTab: tab });
}

export function setActiveProject(project: ProjectInfo | null): StateUpdater {
  return (state) => ({ ...state, activeProject: project });
}

// Input
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

// Logs
export function addLog(level: LogEntry["level"], message: string, meta?: LogMeta): StateUpdater {
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
  return (state) => ({ ...state, logsExpanded: !state.logsExpanded, logScroll: 0 });
}

export function scrollLogs(direction: "up" | "down"): StateUpdater {
  return (state) => {
    if (!state.logsExpanded) return state;
    const maxScroll = Math.max(0, state.logs.length - 5);
    const delta = direction === "up" ? 1 : -1;
    const newScroll = Math.max(0, Math.min(maxScroll, state.logScroll + delta));
    return { ...state, logScroll: newScroll };
  };
}

// Mode
export function setMode(mode: Mode): StateUpdater {
  return (state) => ({ ...state, mode });
}

export function setKeyChord(keyChord: KeyChordState): StateUpdater {
  return (state) => ({ ...state, keyChord });
}

export function resetKeyChord(): StateUpdater {
  return (state) => ({ ...state, keyChord: createKeyChordState() });
}

export function setCommandPaletteOpen(open: boolean): StateUpdater {
  return (state) => ({
    ...state,
    commandPalette: { ...state.commandPalette, open, query: "", selectedIndex: 0 },
    mode: open ? "COMMAND" : "NORMAL",
  });
}

export function updateCommandPalette(update: Partial<CommandPaletteState>): StateUpdater {
  return (state) => ({
    ...state,
    commandPalette: { ...state.commandPalette, ...update },
  });
}

// UI
export function toggleHelp(): StateUpdater {
  return (state) => ({ ...state, showHelp: !state.showHelp });
}

// ============================================================================
// Helpers
// ============================================================================

function shortenPath(path: string, env: RuntimeEnv = getRuntimeEnv()): string {
  const currentDir = cwd();
  if (path.startsWith(currentDir + "/")) return "./" + path.slice(currentDir.length + 1);
  if (path === currentDir) return "./";
  const home = env.homeDir ?? "";
  if (home && path.startsWith(home)) return `~${path.slice(home.length)}`;
  return path;
}

export function getActiveSelection(state: AppState): ListItem<ProjectInfo> | undefined {
  if (state.activeSection === "remote") return undefined;
  const list = state[state.activeSection];
  return list.items[list.selectedIndex];
}
