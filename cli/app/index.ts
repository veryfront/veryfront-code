/**
 * CLI App Shell
 *
 * Interactive app-like CLI experience with dashboard and project navigation.
 */

// Core app
export { createApp } from "./shell.ts";
export { startStartupProgress, type StartupProgress } from "./startup.ts";

// Types
export type { App, AppConfig } from "./types.ts";
export type { AppState, LogMeta, ProjectInfo, StateUpdater } from "./state.ts";

// Key transition (the app's decision surface)
export { type Effect, type KeyEnv, type KeyResult, reduceKey } from "./key-reducer.ts";
