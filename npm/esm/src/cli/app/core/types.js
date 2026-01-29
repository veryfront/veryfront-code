// Core TUI Types with Zod Validation
// Foundational types for state machine, navigation, and command system
import { z } from "zod";
// ============================================================================
// Mode System
// ============================================================================
export const ModeSchema = z.enum(["NORMAL", "COMMAND", "SEARCH", "INSERT"]);
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
export const ProjectTabSchema = z.enum([
    "dashboard",
    "files",
    "routes",
    "agents",
    "terminal",
    "logs",
]);
export const ResourceTabSchema = z.enum([
    "files",
    "routes",
    "agents",
    "tools",
    "mcp",
]);
// ============================================================================
// Navigation Stack
// ============================================================================
export const NavEntrySchema = z.object({
    view: ViewSchema,
    params: z.record(z.string()).optional(),
    scrollPosition: z.number().optional(),
});
export const NavStackSchema = z.object({
    stack: z.array(NavEntrySchema),
    maxSize: z.number().default(20),
});
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
export const CommandDefSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    category: CommandCategorySchema,
    shortcut: z.string().optional(),
    aliases: z.array(z.string()).optional(),
});
export const CommandPaletteStateSchema = z.object({
    open: z.boolean(),
    query: z.string(),
    selectedIndex: z.number(),
    filteredCommands: z.array(CommandDefSchema),
});
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
export const SearchResultSchema = z.object({
    type: SearchResultTypeSchema,
    id: z.string(),
    label: z.string(),
    description: z.string().optional(),
    path: z.string().optional(),
    score: z.number(),
    matches: z.array(z.tuple([z.number(), z.number()])).optional(), // [start, end]
});
export const SearchStateSchema = z.object({
    open: z.boolean(),
    query: z.string(),
    selectedIndex: z.number(),
    results: z.array(SearchResultSchema),
    loading: z.boolean(),
});
// ============================================================================
// Slash Commands
// ============================================================================
export const SlashCommandSchema = z.object({
    command: z.string(),
    args: z.array(z.string()),
    flags: z.record(z.union([z.string(), z.boolean()])),
});
// ============================================================================
// Coding Agent System
// ============================================================================
export const AgentTypeSchema = z.enum(["cli", "ide"]);
export const CodingAgentDefSchema = z.object({
    id: z.string(),
    name: z.string(),
    command: z.string(),
    provider: z.string(),
    type: AgentTypeSchema,
    models: z.array(z.string()).optional(),
    defaultModel: z.string().optional(),
});
export const AgentSessionSchema = z.object({
    id: z.string(),
    agentId: z.string(),
    model: z.string().optional(),
    status: z.enum(["starting", "running", "backgrounded", "stopped"]),
    projectPath: z.string(),
    startedAt: z.number(),
});
export const CodingAgentStateSchema = z.object({
    activeAgent: CodingAgentDefSchema.nullable(),
    activeModel: z.string().nullable(),
    agents: z.array(CodingAgentDefSchema),
    installedAgents: z.array(z.string()),
    sessions: z.array(AgentSessionSchema),
    pickerOpen: z.boolean(),
    pickerIndex: z.number(),
});
// ============================================================================
// Key Chord System
// ============================================================================
export const KeyChordStateSchema = z.object({
    pending: z.string().nullable(), // prefix key like 'g'
    startTime: z.number().nullable(), // for timeout
    count: z.number().nullable(), // numeric prefix like 5j
});
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
export const ConfirmationOptionsSchema = z.object({
    title: z.string(),
    message: z.string(),
    confirmLabel: z.string().default("Yes"),
    cancelLabel: z.string().default("No"),
    variant: z.enum(["info", "warning", "danger"]).default("info"),
});
export const ConfirmationStateSchema = z.object({
    open: z.boolean(),
    options: ConfirmationOptionsSchema.nullable(),
    selectedIndex: z.number(), // 0 = confirm, 1 = cancel
    onConfirm: z.function().args().returns(z.void()).nullable(),
    onCancel: z.function().args().returns(z.void()).nullable(),
});
// ============================================================================
// Config Persistence
// ============================================================================
export const UserPreferencesSchema = z.object({
    defaultAgent: z.string().nullable(),
    autoConnect: z.boolean().default(true),
    fallbackToTui: z.boolean().default(true),
    theme: z.enum(["dark", "light", "auto"]).default("auto"),
});
export const CommandHistoryEntrySchema = z.object({
    command: z.string(),
    timestamp: z.number(),
});
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
// ============================================================================
// Factory Functions
// ============================================================================
export function createNavStack() {
    return { stack: [], maxSize: 20 };
}
export function createKeyChordState() {
    return { pending: null, startTime: null, count: null };
}
export function createCommandPaletteState() {
    return { open: false, query: "", selectedIndex: 0, filteredCommands: [] };
}
export function createSearchState() {
    return { open: false, query: "", selectedIndex: 0, results: [], loading: false };
}
export function createCodingAgentState() {
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
export function createConfirmationState() {
    return {
        open: false,
        options: null,
        selectedIndex: 0,
        onConfirm: null,
        onCancel: null,
    };
}
export function createExtendedState() {
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
