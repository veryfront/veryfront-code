import type { ListItem, ListSelectState } from "./components/list-select.js";
export type AppView = "dashboard" | "project-detail" | "new-project" | "templates" | "examples" | "auth" | "help";
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
}
export declare function createInitialState(): AppState;
export type StateUpdater = (state: AppState) => AppState;
export declare function setProjects(projects: Array<{
    slug: string;
    path: string;
}>): StateUpdater;
export declare function setExamples(examples: Array<{
    slug: string;
    path: string;
    description?: string;
}>): StateUpdater;
export declare function setTemplates(templates: Array<{
    id: string;
    name: string;
    description: string;
}>): StateUpdater;
export declare function updateServer(update: Partial<ServerStatus>): StateUpdater;
export declare function updateMCP(update: Partial<MCPStatus>): StateUpdater;
export declare function updateRemote(update: Partial<RemoteState>): StateUpdater;
export declare function navigateTo(view: AppView): StateUpdater;
export declare function goBack(): StateUpdater;
export declare function setActiveList(list: "projects" | "examples" | "templates" | "remoteProjects"): StateUpdater;
export declare function updateActiveList(updater: (list: ListSelectState<ProjectInfo>) => ListSelectState<ProjectInfo>): StateUpdater;
export declare function selectProject(project: ProjectInfo | null): StateUpdater;
export declare function updateWizard(update: Partial<AppState["wizard"]>): StateUpdater;
export declare function resetWizard(): StateUpdater;
export declare function startInput(prompt: string, onSubmit: (value: string) => void, onCancel?: () => void, initialValue?: string): StateUpdater;
export declare function updateInputValue(value: string, cursorPos: number): StateUpdater;
export declare function endInput(): StateUpdater;
export declare function addLog(level: LogEntry["level"], message: string, meta?: LogMeta): StateUpdater;
export declare function clearLogs(): StateUpdater;
export declare function toggleLogsExpanded(): StateUpdater;
export declare function scrollLogs(direction: "up" | "down"): StateUpdater;
export declare function getActiveSelection(state: AppState): ListItem<ProjectInfo> | undefined;
//# sourceMappingURL=state.d.ts.map