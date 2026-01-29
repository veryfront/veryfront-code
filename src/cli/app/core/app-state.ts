// Unified App State
// Main entry point for TUI state management combining all modules

import { z } from "zod";
import type { Mode, View } from "./types.ts";
import { createKeyChordState, type KeyChordState } from "./types.ts";
import type { CodingAgentState, CommandPaletteState, SearchState } from "./types.ts";
import { type ConfirmationState, createConfirmationState } from "./types.ts";
import { createCommandPaletteState, createSearchState } from "./types.ts";
import { createAgentRegistry, initAgentState } from "./agents.ts";
import { type ConfigState, createConfigState } from "./config.ts";
import type { HeaderState } from "../components/header-banner.ts";
import { createHeaderState } from "../components/header-banner.ts";
import type { ResourceViewerState } from "../components/views/resource-viewer.ts";
import { createResourceViewer } from "../components/views/resource-viewer.ts";
import type { ProjectDetailState } from "../components/views/project-detail.ts";
import { createProjectDetail } from "../components/views/project-detail.ts";

// ============================================================================
// App State Schema
// ============================================================================

export const AppStateSchema = z.object({
  mode: z.enum(["NORMAL", "COMMAND", "SEARCH", "INSERT"]),
  view: z.enum([
    "dashboard",
    "project-detail",
    "resources",
    "settings",
    "new-project",
    "templates",
    "examples",
    "auth",
    "help",
  ]),
  navStack: z.array(z.object({
    view: z.string(),
    params: z.record(z.unknown()).optional(),
  })),
  keyChord: z.custom<KeyChordState>(),
  header: z.custom<HeaderState>(),
  commandPalette: z.custom<CommandPaletteState>(),
  search: z.custom<SearchState>(),
  agents: z.custom<CodingAgentState>(),
  confirmation: z.custom<ConfirmationState>(),
  resourceViewer: z.custom<ResourceViewerState>(),
  projectDetail: z.custom<ProjectDetailState>(),
  config: z.custom<ConfigState>(),
  termSize: z.object({ width: z.number(), height: z.number() }),
  debug: z.boolean(),
});

export type AppState = z.infer<typeof AppStateSchema>;

// ============================================================================
// Initial State
// ============================================================================

export function createAppState(): AppState {
  const registry = createAgentRegistry();
  return {
    mode: "NORMAL",
    view: "dashboard",
    navStack: [{ view: "dashboard" }],
    keyChord: createKeyChordState(),
    header: createHeaderState(),
    commandPalette: createCommandPaletteState(),
    search: createSearchState(),
    agents: initAgentState(registry),
    confirmation: createConfirmationState(),
    resourceViewer: createResourceViewer(),
    projectDetail: createProjectDetail(),
    config: createConfigState(),
    termSize: { width: 80, height: 24 },
    debug: false,
  };
}

// ============================================================================
// State Updaters
// ============================================================================

export type AppUpdater = (state: AppState) => AppState;

export function setMode(mode: Mode): AppUpdater {
  return (state) => ({ ...state, mode });
}

export function setView(view: View): AppUpdater {
  return (state) => ({
    ...state,
    view,
    navStack: [...state.navStack, { view }],
  });
}

export function goBack(): AppUpdater {
  return (state) => {
    if (state.navStack.length <= 1) return state;
    const newStack = state.navStack.slice(0, -1);
    const prev = newStack[newStack.length - 1];
    return {
      ...state,
      navStack: newStack,
      view: (prev?.view as View) ?? "dashboard",
    };
  };
}

export function setTermSize(width: number, height: number): AppUpdater {
  return (state) => ({ ...state, termSize: { width, height } });
}

export function toggleDebug(): AppUpdater {
  return (state) => ({ ...state, debug: !state.debug });
}

export function updateHeader(updater: (h: HeaderState) => HeaderState): AppUpdater {
  return (state) => ({ ...state, header: updater(state.header) });
}

export function updateCommandPalette(
  updater: (p: CommandPaletteState) => CommandPaletteState,
): AppUpdater {
  return (state) => ({ ...state, commandPalette: updater(state.commandPalette) });
}

export function updateSearch(updater: (s: SearchState) => SearchState): AppUpdater {
  return (state) => ({ ...state, search: updater(state.search) });
}

export function updateAgents(updater: (a: CodingAgentState) => CodingAgentState): AppUpdater {
  return (state) => ({ ...state, agents: updater(state.agents) });
}

export function updateConfirmation(
  updater: (c: ConfirmationState) => ConfirmationState,
): AppUpdater {
  return (state) => ({ ...state, confirmation: updater(state.confirmation) });
}

export function updateResourceViewer(
  updater: (r: ResourceViewerState) => ResourceViewerState,
): AppUpdater {
  return (state) => ({ ...state, resourceViewer: updater(state.resourceViewer) });
}

export function updateProjectDetail(
  updater: (p: ProjectDetailState) => ProjectDetailState,
): AppUpdater {
  return (state) => ({ ...state, projectDetail: updater(state.projectDetail) });
}

export function updateConfig(updater: (c: ConfigState) => ConfigState): AppUpdater {
  return (state) => ({ ...state, config: updater(state.config) });
}

export function updateKeyChord(updater: (k: KeyChordState) => KeyChordState): AppUpdater {
  return (state) => ({ ...state, keyChord: updater(state.keyChord) });
}

// ============================================================================
// Modal Helpers
// ============================================================================

export function isModalOpen(state: AppState): boolean {
  return (
    state.commandPalette.open ||
    state.search.open ||
    state.agents.pickerOpen ||
    state.confirmation.open
  );
}

export function getActiveModal(
  state: AppState,
): "command" | "search" | "agent" | "confirmation" | null {
  if (state.commandPalette.open) return "command";
  if (state.search.open) return "search";
  if (state.agents.pickerOpen) return "agent";
  if (state.confirmation.open) return "confirmation";
  return null;
}

export function closeAllModals(): AppUpdater {
  return (state) => ({
    ...state,
    mode: "NORMAL",
    commandPalette: { ...state.commandPalette, open: false },
    search: { ...state.search, open: false },
    agents: { ...state.agents, pickerOpen: false },
    confirmation: { ...state.confirmation, open: false },
  });
}

// ============================================================================
// Compose
// ============================================================================

export function compose(...updaters: AppUpdater[]): AppUpdater {
  return (state) => updaters.reduce((s, updater) => updater(s), state);
}
