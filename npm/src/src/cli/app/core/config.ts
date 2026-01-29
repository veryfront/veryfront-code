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

export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

export const RecentProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  lastAccessed: z.number(),
});

export type RecentProject = z.infer<typeof RecentProjectSchema>;

export const ConfigStateSchema = z.object({
  preferences: UserPreferencesSchema,
  commandHistory: z.array(z.string()),
  recentProjects: z.array(RecentProjectSchema),
});

export type ConfigState = z.infer<typeof ConfigStateSchema>;

// ============================================================================
// Defaults
// ============================================================================

const MAX_HISTORY = 100;
const MAX_RECENT_PROJECTS = 20;

export function createConfigState(): ConfigState {
  return {
    preferences: UserPreferencesSchema.parse({}),
    commandHistory: [],
    recentProjects: [],
  };
}

// ============================================================================
// State Management
// ============================================================================

export type ConfigUpdater = (state: ConfigState) => ConfigState;

export function updatePreferences(
  updates: Partial<UserPreferences>,
): ConfigUpdater {
  return (state) => ({
    ...state,
    preferences: { ...state.preferences, ...updates },
  });
}

export function addToHistory(command: string): ConfigUpdater {
  return (state) => {
    // Remove duplicates and add to front
    const filtered = state.commandHistory.filter((c) => c !== command);
    const newHistory = [command, ...filtered].slice(0, MAX_HISTORY);

    return { ...state, commandHistory: newHistory };
  };
}

export function clearHistory(): ConfigUpdater {
  return (state) => ({ ...state, commandHistory: [] });
}

export function addRecentProject(project: Omit<RecentProject, "lastAccessed">): ConfigUpdater {
  return (state) => {
    // Remove existing entry if present
    const filtered = state.recentProjects.filter((p) => p.id !== project.id);

    // Add to front with new timestamp
    const newProject: RecentProject = {
      ...project,
      lastAccessed: Date.now(),
    };

    const newProjects = [newProject, ...filtered].slice(0, MAX_RECENT_PROJECTS);

    return { ...state, recentProjects: newProjects };
  };
}

export function removeRecentProject(id: string): ConfigUpdater {
  return (state) => ({
    ...state,
    recentProjects: state.recentProjects.filter((p) => p.id !== id),
  });
}

export function clearRecentProjects(): ConfigUpdater {
  return (state) => ({ ...state, recentProjects: [] });
}

// ============================================================================
// File Operations
// ============================================================================

export function getConfigDir(): string {
  const home = dntShim.Deno.env.get("HOME") ?? dntShim.Deno.env.get("USERPROFILE") ?? "";
  return `${home}/.config/veryfront`;
}

export function getConfigPath(): string {
  return `${getConfigDir()}/config.json`;
}

export function getHistoryPath(): string {
  return `${getConfigDir()}/history.json`;
}

export function getRecentPath(): string {
  return `${getConfigDir()}/recent.json`;
}

export async function ensureConfigDir(): Promise<void> {
  try {
    await dntShim.Deno.mkdir(getConfigDir(), { recursive: true });
  } catch (err) {
    if (!(err instanceof dntShim.Deno.errors.AlreadyExists)) {
      throw err;
    }
  }
}

export async function loadConfig(): Promise<ConfigState> {
  const state = createConfigState();

  try {
    // Load preferences
    const prefContent = await dntShim.Deno.readTextFile(getConfigPath());
    const prefData = JSON.parse(prefContent);
    state.preferences = UserPreferencesSchema.parse(prefData);
  } catch {
    // Use defaults if file doesn't exist
  }

  try {
    // Load history
    const histContent = await dntShim.Deno.readTextFile(getHistoryPath());
    const histData = JSON.parse(histContent);
    if (Array.isArray(histData)) {
      state.commandHistory = histData.slice(0, MAX_HISTORY);
    }
  } catch {
    // Use defaults if file doesn't exist
  }

  try {
    // Load recent projects
    const recentContent = await dntShim.Deno.readTextFile(getRecentPath());
    const recentData = JSON.parse(recentContent);
    if (Array.isArray(recentData)) {
      state.recentProjects = recentData
        .map((p: unknown) => {
          try {
            return RecentProjectSchema.parse(p);
          } catch {
            return null;
          }
        })
        .filter((p): p is RecentProject => p !== null)
        .slice(0, MAX_RECENT_PROJECTS);
    }
  } catch {
    // Use defaults if file doesn't exist
  }

  return state;
}

export async function saveConfig(state: ConfigState): Promise<void> {
  await ensureConfigDir();

  // Save preferences
  await dntShim.Deno.writeTextFile(
    getConfigPath(),
    JSON.stringify(state.preferences, null, 2),
  );

  // Save history
  await dntShim.Deno.writeTextFile(
    getHistoryPath(),
    JSON.stringify(state.commandHistory, null, 2),
  );

  // Save recent projects
  await dntShim.Deno.writeTextFile(
    getRecentPath(),
    JSON.stringify(state.recentProjects, null, 2),
  );
}

export async function savePreferences(preferences: UserPreferences): Promise<void> {
  await ensureConfigDir();
  await dntShim.Deno.writeTextFile(
    getConfigPath(),
    JSON.stringify(preferences, null, 2),
  );
}

export async function saveHistory(history: string[]): Promise<void> {
  await ensureConfigDir();
  await dntShim.Deno.writeTextFile(
    getHistoryPath(),
    JSON.stringify(history, null, 2),
  );
}

export async function saveRecentProjects(projects: RecentProject[]): Promise<void> {
  await ensureConfigDir();
  await dntShim.Deno.writeTextFile(
    getRecentPath(),
    JSON.stringify(projects, null, 2),
  );
}
