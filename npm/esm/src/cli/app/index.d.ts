import { type AppState, type StateUpdater } from "./state.js";
export interface AppConfig {
    port: number;
    projects: Map<string, string>;
    examples?: Map<string, string>;
    defaultProject?: string;
    mcpPort?: number;
    /** Force headless mode (no TUI) for coding agents */
    headless?: boolean;
}
export interface App {
    /** Start the app */
    start(): void;
    /** Stop the app and restore terminal */
    stop(): void;
    /** Update state */
    update(updater: StateUpdater): void;
    /** Get current state */
    getState(): AppState;
    /** Render the current view */
    render(): void;
    /** Set server ready */
    setServerReady(): void;
    /** Add an error */
    addError(): void;
    /** Clear errors */
    clearErrors(): void;
    /** Add a log entry to the logs area */
    log(level: "info" | "warn" | "error" | "debug", message: string): void;
    /** Intercept console output and route to TUI logs */
    interceptConsole(): () => void;
}
/**
 * Create the CLI app
 */
export declare function createApp(config: AppConfig): App;
/**
 * Show startup animation with boxed view and shimmer effect
 */
export declare function showStartup(steps: string[]): Promise<void>;
export type { AppState } from "./state.js";
export * from "./state.js";
export * from "./actions.js";
export * from "./components/list-select.js";
//# sourceMappingURL=index.d.ts.map