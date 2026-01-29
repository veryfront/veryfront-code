// Core TUI Module Index
// Re-exports all core modules for the TUI navigation and menu system
//
// IMPORTANT: Some modules have overlapping names. If you get conflicts:
// Import directly from specific modules:
//   - ./types.ts - Core type definitions and factory functions
//   - ./mode.ts - Mode system
//   - ./keybindings.ts - Vim keybindings
//   - ./commands.ts - Command registry
//   - ./agents.ts - Coding agent management
//   - ./pty.ts - PTY spawning
//   - ./config.ts - Config persistence
//   - ./app-state.ts - Unified state management
//   - ./navigation.ts - Navigation stack
//   - ./slash-commands.ts - Slash command parsing
//   - ./key-handler.ts - Key routing

// Types - primary source for all type definitions
export * from "./types.ts";

// Navigation - no conflicts
export * from "./navigation.ts";

// Mode system - no conflicts
export * from "./mode.ts";

// Vim keybindings - no conflicts
export * from "./keybindings.ts";

// Slash commands - no conflicts
export * from "./slash-commands.ts";

// Key handler - no conflicts
export * from "./key-handler.ts";

// The following modules have conflicting exports.
// Re-export specific items to avoid ambiguity.

// Commands - addToHistory conflicts with config
export {
  addToHistory as addCommandToHistory,
  type CommandHistory,
  type CommandMatch,
  type CommandRegistry,
  createHistory,
  createRegistry,
  DEFAULT_COMMANDS,
  findCommand,
  fuzzyScore,
  getCategories,
  getCategory,
  getCommand,
  getCompletions,
  historyDown,
  historyUp,
  resetHistoryPosition,
  searchCommands,
} from "./commands.ts";

// Agents - detectInstalledAgents, isCommandAvailable conflict with pty
export {
  addInstalledAgent,
  addSession,
  type AgentRegistry,
  type AgentStateUpdater,
  buildAgentCommand,
  closeAgentPicker,
  createAgentRegistry,
  createSession,
  DEFAULT_AGENTS,
  detectInstalledAgents,
  getActiveSessions,
  getAgent,
  getAgentDisplayName,
  getAgentModels,
  getCLIAgents,
  getIDEAgents,
  initAgentState,
  isAgentInstalled,
  isCommandAvailable,
  movePickerSelection,
  openAgentPicker,
  removeSession,
  setActiveAgent,
  setActiveModel,
  updateSessionStatus,
} from "./agents.ts";

// PTY - conflicts with agents
export {
  createPtySession,
  parseCommand,
  type PtyOptions,
  PtyOptionsSchema,
  type PtySession,
  PtySessionSchema,
  type PtyState,
  PtyStateSchema,
  spawnAgent,
  type SpawnResult,
  updatePtySession,
  waitForExit,
} from "./pty.ts";

// Config - addToHistory, UserPreferences conflict
export {
  addRecentProject,
  addToHistory as addConfigHistory,
  clearHistory,
  clearRecentProjects,
  type ConfigState,
  type ConfigUpdater,
  createConfigState,
  ensureConfigDir,
  getConfigDir,
  getConfigPath,
  getHistoryPath,
  getRecentPath,
  loadConfig,
  removeRecentProject,
  saveConfig,
  saveHistory,
  savePreferences,
  saveRecentProjects,
  updatePreferences,
} from "./config.ts";

// App state - setMode conflicts with mode.ts
export {
  AppStateSchema,
  type AppUpdater,
  closeAllModals,
  compose,
  createAppState,
  getActiveModal,
  goBack as goBackCore,
  isModalOpen,
  setTermSize,
  setView,
  toggleDebug,
  updateAgents,
  updateCommandPalette,
  updateConfig,
  updateConfirmation,
  updateHeader,
  updateKeyChord,
  updateProjectDetail,
  updateResourceViewer,
  updateSearch,
} from "./app-state.ts";
// Note: setMode from app-state.ts not exported - use mode.ts setMode instead
// To use app-state setMode: import { setMode } from "./core/app-state.ts"
