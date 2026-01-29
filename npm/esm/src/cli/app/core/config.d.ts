import { z } from "zod";
export declare const UserPreferencesSchema: z.ZodObject<{
    defaultAgent: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    defaultModel: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    autoConnect: z.ZodDefault<z.ZodBoolean>;
    fallbackToTui: z.ZodDefault<z.ZodBoolean>;
    defaultPort: z.ZodDefault<z.ZodNumber>;
    theme: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    theme: string;
    defaultModel: string | null;
    defaultAgent: string | null;
    autoConnect: boolean;
    fallbackToTui: boolean;
    defaultPort: number;
}, {
    theme?: string | undefined;
    defaultModel?: string | null | undefined;
    defaultAgent?: string | null | undefined;
    autoConnect?: boolean | undefined;
    fallbackToTui?: boolean | undefined;
    defaultPort?: number | undefined;
}>;
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;
export declare const RecentProjectSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    path: z.ZodString;
    lastAccessed: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    path: string;
    name: string;
    id: string;
    lastAccessed: number;
}, {
    path: string;
    name: string;
    id: string;
    lastAccessed: number;
}>;
export type RecentProject = z.infer<typeof RecentProjectSchema>;
export declare const ConfigStateSchema: z.ZodObject<{
    preferences: z.ZodObject<{
        defaultAgent: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        defaultModel: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        autoConnect: z.ZodDefault<z.ZodBoolean>;
        fallbackToTui: z.ZodDefault<z.ZodBoolean>;
        defaultPort: z.ZodDefault<z.ZodNumber>;
        theme: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        theme: string;
        defaultModel: string | null;
        defaultAgent: string | null;
        autoConnect: boolean;
        fallbackToTui: boolean;
        defaultPort: number;
    }, {
        theme?: string | undefined;
        defaultModel?: string | null | undefined;
        defaultAgent?: string | null | undefined;
        autoConnect?: boolean | undefined;
        fallbackToTui?: boolean | undefined;
        defaultPort?: number | undefined;
    }>;
    commandHistory: z.ZodArray<z.ZodString, "many">;
    recentProjects: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        path: z.ZodString;
        lastAccessed: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        path: string;
        name: string;
        id: string;
        lastAccessed: number;
    }, {
        path: string;
        name: string;
        id: string;
        lastAccessed: number;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    preferences: {
        theme: string;
        defaultModel: string | null;
        defaultAgent: string | null;
        autoConnect: boolean;
        fallbackToTui: boolean;
        defaultPort: number;
    };
    commandHistory: string[];
    recentProjects: {
        path: string;
        name: string;
        id: string;
        lastAccessed: number;
    }[];
}, {
    preferences: {
        theme?: string | undefined;
        defaultModel?: string | null | undefined;
        defaultAgent?: string | null | undefined;
        autoConnect?: boolean | undefined;
        fallbackToTui?: boolean | undefined;
        defaultPort?: number | undefined;
    };
    commandHistory: string[];
    recentProjects: {
        path: string;
        name: string;
        id: string;
        lastAccessed: number;
    }[];
}>;
export type ConfigState = z.infer<typeof ConfigStateSchema>;
export declare function createConfigState(): ConfigState;
export type ConfigUpdater = (state: ConfigState) => ConfigState;
export declare function updatePreferences(updates: Partial<UserPreferences>): ConfigUpdater;
export declare function addToHistory(command: string): ConfigUpdater;
export declare function clearHistory(): ConfigUpdater;
export declare function addRecentProject(project: Omit<RecentProject, "lastAccessed">): ConfigUpdater;
export declare function removeRecentProject(id: string): ConfigUpdater;
export declare function clearRecentProjects(): ConfigUpdater;
export declare function getConfigDir(): string;
export declare function getConfigPath(): string;
export declare function getHistoryPath(): string;
export declare function getRecentPath(): string;
export declare function ensureConfigDir(): Promise<void>;
export declare function loadConfig(): Promise<ConfigState>;
export declare function saveConfig(state: ConfigState): Promise<void>;
export declare function savePreferences(preferences: UserPreferences): Promise<void>;
export declare function saveHistory(history: string[]): Promise<void>;
export declare function saveRecentProjects(projects: RecentProject[]): Promise<void>;
//# sourceMappingURL=config.d.ts.map