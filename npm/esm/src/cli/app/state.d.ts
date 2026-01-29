import type { ListItem, ListSelectState } from "./components/list-select.js";
import { type CodingAgentDef, type CodingAgentState, type CommandPaletteState, type KeyChordState, type Mode } from "./core/types.js";
export type AppView = "dashboard" | "code" | "resources" | "new-project" | "templates" | "examples" | "auth" | "help";
export type DashboardSection = "projects" | "remote" | "templates" | "examples";
export type ResourceTab = "files" | "routes" | "agents" | "tools" | "mcp";
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
    user: {
        email: string;
        name?: string;
    } | null;
    projects: Array<{
        id: string;
        name: string;
        slug: string;
    }>;
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
    projectPath: string | null;
    running: boolean;
}
export interface AppState {
    view: AppView;
    previousView: AppView | null;
    mode: Mode;
    keyChord: KeyChordState;
    commandPalette: CommandPaletteState;
    server: ServerStatus;
    mcp: MCPStatus;
    activeSection: DashboardSection;
    projects: ListSelectState<ProjectInfo>;
    templates: ListSelectState<ProjectInfo>;
    examples: ListSelectState<ProjectInfo>;
    remote: RemoteState;
    code: CodeViewState;
    agents: CodingAgentState;
    resourceTab: ResourceTab;
    activeProject: ProjectInfo | null;
    input: InputState;
    logs: LogEntry[];
    maxLogs: number;
    logsExpanded: boolean;
    logScroll: number;
    authProviderIndex: number;
    newProjectIndex: number;
    codeMenuIndex: number;
    showHelp: boolean;
}
export declare function createInitialState(): AppState;
export type StateUpdater = (state: AppState) => AppState;
export declare function navigateTo(view: AppView): StateUpdater;
export declare function goBack(): StateUpdater;
export declare function updateServer(update: Partial<ServerStatus>): StateUpdater;
export declare function updateMCP(update: Partial<MCPStatus>): StateUpdater;
export declare function setActiveSection(section: DashboardSection): StateUpdater;
export declare function setProjects(projects: Array<{
    slug: string;
    path: string;
}>): StateUpdater;
export declare function setTemplates(templates: Array<{
    id: string;
    name: string;
    description: string;
}>): StateUpdater;
export declare function setExamples(examples: Array<{
    slug: string;
    path: string;
    description?: string;
}>): StateUpdater;
export declare function updateRemote(update: Partial<RemoteState>): StateUpdater;
export declare function updateActiveList(updater: (list: ListSelectState<ProjectInfo>) => ListSelectState<ProjectInfo>): StateUpdater;
export declare function enterCodeView(projectPath: string | null): StateUpdater;
export declare function setCodeAgent(agent: CodingAgentDef | null, model?: string): StateUpdater;
export declare function setCodeRunning(running: boolean): StateUpdater;
export declare function openAgentPicker(): StateUpdater;
export declare function closeAgentPicker(): StateUpdater;
export declare function moveAgentPicker(delta: number): StateUpdater;
export declare function selectAgent(agent: CodingAgentDef | null): StateUpdater;
export declare function setModel(model: string | null): StateUpdater;
export declare function setAgents(agents: CodingAgentDef[], installed: string[]): StateUpdater;
export declare function setResourceTab(tab: ResourceTab): StateUpdater;
export declare function setActiveProject(project: ProjectInfo | null): StateUpdater;
export declare function startInput(prompt: string, onSubmit: (value: string) => void, onCancel?: () => void, initialValue?: string): StateUpdater;
export declare function updateInputValue(value: string, cursorPos: number): StateUpdater;
export declare function endInput(): StateUpdater;
export declare function addLog(level: LogEntry["level"], message: string, meta?: LogMeta): StateUpdater;
export declare function clearLogs(): StateUpdater;
export declare function toggleLogsExpanded(): StateUpdater;
export declare function scrollLogs(direction: "up" | "down"): StateUpdater;
export declare function setMode(mode: Mode): StateUpdater;
export declare function setKeyChord(keyChord: KeyChordState): StateUpdater;
export declare function resetKeyChord(): StateUpdater;
export declare function setCommandPaletteOpen(open: boolean): StateUpdater;
export declare function updateCommandPalette(update: Partial<CommandPaletteState>): StateUpdater;
export declare function toggleHelp(): StateUpdater;
export declare function getActiveSelection(state: AppState): ListItem<ProjectInfo> | undefined;
//# sourceMappingURL=state.d.ts.map