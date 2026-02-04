/**
 * CLI App Shell
 *
 * Interactive app-like CLI experience with dashboard, project navigation,
 * and MCP integration for coding agents.
 */

// Core app
export { createApp } from "./shell.ts";
export { showStartup } from "./startup.ts";

// Types
export type { App, AppConfig } from "./types.ts";
export type { AppState, StateUpdater, LogMeta, ProjectInfo } from "./state.ts";

// State management (for external consumers)
export * from "./state.ts";
export * from "./actions.ts";
export * from "./components/list-select.ts";
