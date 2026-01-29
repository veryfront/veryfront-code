// Core TUI Types with Zod Validation
// Foundational types for state machine, navigation, and command system

import { z } from "zod";

// ============================================================================
// Mode System
// ============================================================================

export const ModeSchema = z.enum(["NORMAL", "COMMAND", "SEARCH", "INSERT"]);
export type Mode = z.infer<typeof ModeSchema>;

// ============================================================================
// View Hierarchy
// ============================================================================

export const ViewSchema = z.enum([
  "dashboard",
  "project-detail",
  "resources",
  "settings",
  "new-project",
  "templates",
  "examples",
  "auth",
  "help",
]);
export type View = z.infer<typeof ViewSchema>;

export const ProjectTabSchema = z.enum([
  "dashboard",
  "files",
  "routes",
  "agents",
  "terminal",
  "logs",
]);
export type ProjectTab = z.infer<typeof ProjectTabSchema>;

export const ResourceTabSchema = z.enum([
  "files",
  "routes",
  "agents",
  "tools",
  "mcp",
]);
export type ResourceTab = z.infer<typeof ResourceTabSchema>;

// ============================================================================
// Navigation Stack
// ============================================================================

export const NavEntrySchema = z.object({
  view: ViewSchema,
  params: z.record(z.string()).optional(),
  scrollPosition: z.number().optional(),
});
export type NavEntry = z.infer<typeof NavEntrySchema>;

export const NavStackSchema = z.object({
  stack: z.array(NavEntrySchema),
  maxSize: z.number().default(20),
});
export type NavStack = z.infer<typeof NavStackSchema>;

// ============================================================================
// Command System
// ============================================================================

export const CommandCategorySchema = z.enum([
  "navigation",
  "project",
  "server",
  "agent",
  "files",
  "utility",
]);
export type CommandCategory = z.infer<typeof CommandCategorySchema>;

export const CommandDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: CommandCategorySchema,
  shortcut: z.string().optional(),
  aliases: z.array(z.string()).optional(),
});
export type CommandDef = z.infer<typeof CommandDefSchema>;

export const CommandPaletteStateSchema = z.object({
  open: z.boolean(),
  query: z.string(),
  selectedIndex: z.number(),
  filteredCommands: z.array(CommandDefSchema),
});
export type CommandPaletteState = z.infer<typeof CommandPaletteStateSchema>;

// ============================================================================
// Search System
// ============================================================================

export const SearchResultTypeSchema = z.enum([
  "file",
  "route",
  "command",
  "agent",
  "tool",
]);
export type SearchResultType = z.infer<typeof SearchResultTypeSchema>;

export const SearchResultSchema = z.object({
  type: SearchResultTypeSchema,
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  path: z.string().optional(),
  score: z.number(),
  matches: z.array(z.tuple([z.number(), z.number()])).optional(), // [start, end]
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const SearchStateSchema = z.object({
  open: z.boolean(),
  query: z.string(),
  selectedIndex: z.number(),
  results: z.array(SearchResultSchema),
  loading: z.boolean(),
});
export type SearchState = z.infer<typeof SearchStateSchema>;

// ============================================================================
// Slash Commands
// ============================================================================

export const SlashCommandSchema = z.object({
  command: z.string(),
  args: z.array(z.string()),
  flags: z.record(z.union([z.string(), z.boolean()])),
});
export type SlashCommand = z.infer<typeof SlashCommandSchema>;

// ============================================================================
// Coding Agent System
// ============================================================================

export const AgentTypeSchema = z.enum(["cli", "ide"]);
export type AgentType = z.infer<typeof AgentTypeSchema>;

export const CodingAgentDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  command: z.string(),
  provider: z.string(),
  type: AgentTypeSchema,
  models: z.array(z.string()).optional(),
  defaultModel: z.string().optional(),
});
export type CodingAgentDef = z.infer<typeof CodingAgentDefSchema>;

export const AgentSessionSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  model: z.string().optional(),
  status: z.enum(["starting", "running", "backgrounded", "stopped"]),
  projectPath: z.string(),
  startedAt: z.number(),
});
export type AgentSession = z.infer<typeof AgentSessionSchema>;

export const CodingAgentStateSchema = z.object({
  activeAgent: CodingAgentDefSchema.nullable(),
  activeModel: z.string().nullable(),
  agents: z.array(CodingAgentDefSchema),
  installedAgents: z.array(z.string()),
  sessions: z.array(AgentSessionSchema),
  pickerOpen: z.boolean(),
  pickerIndex: z.number(),
});
export type CodingAgentState = z.infer<typeof CodingAgentStateSchema>;

// ============================================================================
// Key Chord System
// ============================================================================

export const KeyChordStateSchema = z.object({
  pending: z.string().nullable(), // prefix key like 'g'
  startTime: z.number().nullable(), // for timeout
  count: z.number().nullable(), // numeric prefix like 5j
});
export type KeyChordState = z.infer<typeof KeyChordStateSchema>;

// ============================================================================
// Modal System
// ============================================================================

export const ModalTypeSchema = z.enum([
  "command-palette",
  "search",
  "agent-picker",
  "confirmation",
  "model-picker",
]);
export type ModalType = z.infer<typeof ModalTypeSchema>;

export const ConfirmationOptionsSchema = z.object({
  title: z.string(),
  message: z.string(),
  confirmLabel: z.string().default("Yes"),
  cancelLabel: z.string().default("No"),
  variant: z.enum(["info", "warning", "danger"]).default("info"),
});
export type ConfirmationOptions = z.infer<typeof ConfirmationOptionsSchema>;

export const ConfirmationStateSchema = z.object({
  open: z.boolean(),
  options: ConfirmationOptionsSchema.nullable(),
  selectedIndex: z.number(), // 0 = confirm, 1 = cancel
  onConfirm: z.function().args().returns(z.void()).nullable(),
  onCancel: z.function().args().returns(z.void()).nullable(),
});
export type ConfirmationState = z.infer<typeof ConfirmationStateSchema>;

// ============================================================================
// Config Persistence
// ============================================================================

export const UserPreferencesSchema = z.object({
  defaultAgent: z.string().nullable(),
  autoConnect: z.boolean().default(true),
  fallbackToTui: z.boolean().default(true),
  theme: z.enum(["dark", "light", "auto"]).default("auto"),
});
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

export const CommandHistoryEntrySchema = z.object({
  command: z.string(),
  timestamp: z.number(),
});
export type CommandHistoryEntry = z.infer<typeof CommandHistoryEntrySchema>;

// ============================================================================
// Extended App State
// ============================================================================

export const ExtendedStateSchema = z.object({
  mode: ModeSchema,
  navStack: NavStackSchema,
  keyChord: KeyChordStateSchema,
  commandPalette: CommandPaletteStateSchema,
  search: SearchStateSchema,
  codingAgent: CodingAgentStateSchema,
  confirmation: ConfirmationStateSchema,
  projectTab: ProjectTabSchema,
  resourceTab: ResourceTabSchema,
});
export type ExtendedState = z.infer<typeof ExtendedStateSchema>;

// ============================================================================
// Factory Functions
// ============================================================================

export function createNavStack(): NavStack {
  return { stack: [], maxSize: 20 };
}

export function createKeyChordState(): KeyChordState {
  return { pending: null, startTime: null, count: null };
}

export function createCommandPaletteState(): CommandPaletteState {
  return { open: false, query: "", selectedIndex: 0, filteredCommands: [] };
}

export function createSearchState(): SearchState {
  return { open: false, query: "", selectedIndex: 0, results: [], loading: false };
}

export function createCodingAgentState(): CodingAgentState {
  return {
    activeAgent: null,
    activeModel: null,
    agents: [],
    installedAgents: [],
    sessions: [],
    pickerOpen: false,
    pickerIndex: 0,
  };
}

export function createConfirmationState(): ConfirmationState {
  return {
    open: false,
    options: null,
    selectedIndex: 0,
    onConfirm: null,
    onCancel: null,
  };
}

export function createExtendedState(): ExtendedState {
  return {
    mode: "NORMAL",
    navStack: createNavStack(),
    keyChord: createKeyChordState(),
    commandPalette: createCommandPaletteState(),
    search: createSearchState(),
    codingAgent: createCodingAgentState(),
    confirmation: createConfirmationState(),
    projectTab: "dashboard",
    resourceTab: "files",
  };
}
