/**
 * App Types
 *
 * Type definitions for the CLI app shell.
 */

import type { AppState, StateUpdater } from "./state.ts";

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
