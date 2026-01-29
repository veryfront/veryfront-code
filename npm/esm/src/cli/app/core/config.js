// Config Persistence Module
// Handles saving and loading user preferences, command history, and recent projects
import * as dntShim from "../../../../_dnt.shims.js";
import { z } from "zod";
// ============================================================================
// Schemas
// ============================================================================
export const UserPreferencesSchema = z.object({
    defaultAgent: z.string().nullable().default(null),
    defaultModel: z.string().nullable().default(null),
    autoConnect: z.boolean().default(true),
    fallbackToTui: z.boolean().default(true),
    defaultPort: z.number().default(8080),
    theme: z.string().default("default"),
});
export const RecentProjectSchema = z.object({
    id: z.string(),
    name: z.string(),
    path: z.string(),
    lastAccessed: z.number(),
});
export const ConfigStateSchema = z.object({
    preferences: UserPreferencesSchema,
    commandHistory: z.array(z.string()),
    recentProjects: z.array(RecentProjectSchema),
});
// ============================================================================
// Defaults
// ============================================================================
const MAX_HISTORY = 100;
const MAX_RECENT_PROJECTS = 20;
export function createConfigState() {
    return {
        preferences: UserPreferencesSchema.parse({}),
        commandHistory: [],
        recentProjects: [],
    };
}
export function updatePreferences(updates) {
    return (state) => ({
        ...state,
        preferences: { ...state.preferences, ...updates },
    });
}
export function addToHistory(command) {
    return (state) => {
        // Remove duplicates and add to front
        const filtered = state.commandHistory.filter((c) => c !== command);
        const newHistory = [command, ...filtered].slice(0, MAX_HISTORY);
        return { ...state, commandHistory: newHistory };
    };
}
export function clearHistory() {
    return (state) => ({ ...state, commandHistory: [] });
}
export function addRecentProject(project) {
    return (state) => {
        // Remove existing entry if present
        const filtered = state.recentProjects.filter((p) => p.id !== project.id);
        // Add to front with new timestamp
        const newProject = {
            ...project,
            lastAccessed: Date.now(),
        };
        const newProjects = [newProject, ...filtered].slice(0, MAX_RECENT_PROJECTS);
        return { ...state, recentProjects: newProjects };
    };
}
export function removeRecentProject(id) {
    return (state) => ({
        ...state,
        recentProjects: state.recentProjects.filter((p) => p.id !== id),
    });
}
export function clearRecentProjects() {
    return (state) => ({ ...state, recentProjects: [] });
}
// ============================================================================
// File Operations
// ============================================================================
export function getConfigDir() {
    const home = dntShim.Deno.env.get("HOME") ?? dntShim.Deno.env.get("USERPROFILE") ?? "";
    return `${home}/.config/veryfront`;
}
export function getConfigPath() {
    return `${getConfigDir()}/config.json`;
}
export function getHistoryPath() {
    return `${getConfigDir()}/history.json`;
}
export function getRecentPath() {
    return `${getConfigDir()}/recent.json`;
}
export async function ensureConfigDir() {
    try {
        await dntShim.Deno.mkdir(getConfigDir(), { recursive: true });
    }
    catch (err) {
        if (!(err instanceof dntShim.Deno.errors.AlreadyExists)) {
            throw err;
        }
    }
}
export async function loadConfig() {
    const state = createConfigState();
    try {
        // Load preferences
        const prefContent = await dntShim.Deno.readTextFile(getConfigPath());
        const prefData = JSON.parse(prefContent);
        state.preferences = UserPreferencesSchema.parse(prefData);
    }
    catch {
        // Use defaults if file doesn't exist
    }
    try {
        // Load history
        const histContent = await dntShim.Deno.readTextFile(getHistoryPath());
        const histData = JSON.parse(histContent);
        if (Array.isArray(histData)) {
            state.commandHistory = histData.slice(0, MAX_HISTORY);
        }
    }
    catch {
        // Use defaults if file doesn't exist
    }
    try {
        // Load recent projects
        const recentContent = await dntShim.Deno.readTextFile(getRecentPath());
        const recentData = JSON.parse(recentContent);
        if (Array.isArray(recentData)) {
            state.recentProjects = recentData
                .map((p) => {
                try {
                    return RecentProjectSchema.parse(p);
                }
                catch {
                    return null;
                }
            })
                .filter((p) => p !== null)
                .slice(0, MAX_RECENT_PROJECTS);
        }
    }
    catch {
        // Use defaults if file doesn't exist
    }
    return state;
}
export async function saveConfig(state) {
    await ensureConfigDir();
    // Save preferences
    await dntShim.Deno.writeTextFile(getConfigPath(), JSON.stringify(state.preferences, null, 2));
    // Save history
    await dntShim.Deno.writeTextFile(getHistoryPath(), JSON.stringify(state.commandHistory, null, 2));
    // Save recent projects
    await dntShim.Deno.writeTextFile(getRecentPath(), JSON.stringify(state.recentProjects, null, 2));
}
export async function savePreferences(preferences) {
    await ensureConfigDir();
    await dntShim.Deno.writeTextFile(getConfigPath(), JSON.stringify(preferences, null, 2));
}
export async function saveHistory(history) {
    await ensureConfigDir();
    await dntShim.Deno.writeTextFile(getHistoryPath(), JSON.stringify(history, null, 2));
}
export async function saveRecentProjects(projects) {
    await ensureConfigDir();
    await dntShim.Deno.writeTextFile(getRecentPath(), JSON.stringify(projects, null, 2));
}
