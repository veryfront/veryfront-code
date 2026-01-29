import { z } from "zod";
export declare const ModeSchema: z.ZodEnum<["NORMAL", "COMMAND", "SEARCH", "INSERT"]>;
export type Mode = z.infer<typeof ModeSchema>;
export declare const ViewSchema: z.ZodEnum<["dashboard", "project-detail", "resources", "settings", "new-project", "templates", "examples", "auth", "help"]>;
export type View = z.infer<typeof ViewSchema>;
export declare const ProjectTabSchema: z.ZodEnum<["dashboard", "files", "routes", "agents", "terminal", "logs"]>;
export type ProjectTab = z.infer<typeof ProjectTabSchema>;
export declare const ResourceTabSchema: z.ZodEnum<["files", "routes", "agents", "tools", "mcp"]>;
export type ResourceTab = z.infer<typeof ResourceTabSchema>;
export declare const NavEntrySchema: z.ZodObject<{
    view: z.ZodEnum<["dashboard", "project-detail", "resources", "settings", "new-project", "templates", "examples", "auth", "help"]>;
    params: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    scrollPosition: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    view: "auth" | "help" | "settings" | "resources" | "examples" | "dashboard" | "project-detail" | "new-project" | "templates";
    params?: Record<string, string> | undefined;
    scrollPosition?: number | undefined;
}, {
    view: "auth" | "help" | "settings" | "resources" | "examples" | "dashboard" | "project-detail" | "new-project" | "templates";
    params?: Record<string, string> | undefined;
    scrollPosition?: number | undefined;
}>;
export type NavEntry = z.infer<typeof NavEntrySchema>;
export declare const NavStackSchema: z.ZodObject<{
    stack: z.ZodArray<z.ZodObject<{
        view: z.ZodEnum<["dashboard", "project-detail", "resources", "settings", "new-project", "templates", "examples", "auth", "help"]>;
        params: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        scrollPosition: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        view: "auth" | "help" | "settings" | "resources" | "examples" | "dashboard" | "project-detail" | "new-project" | "templates";
        params?: Record<string, string> | undefined;
        scrollPosition?: number | undefined;
    }, {
        view: "auth" | "help" | "settings" | "resources" | "examples" | "dashboard" | "project-detail" | "new-project" | "templates";
        params?: Record<string, string> | undefined;
        scrollPosition?: number | undefined;
    }>, "many">;
    maxSize: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    maxSize: number;
    stack: {
        view: "auth" | "help" | "settings" | "resources" | "examples" | "dashboard" | "project-detail" | "new-project" | "templates";
        params?: Record<string, string> | undefined;
        scrollPosition?: number | undefined;
    }[];
}, {
    stack: {
        view: "auth" | "help" | "settings" | "resources" | "examples" | "dashboard" | "project-detail" | "new-project" | "templates";
        params?: Record<string, string> | undefined;
        scrollPosition?: number | undefined;
    }[];
    maxSize?: number | undefined;
}>;
export type NavStack = z.infer<typeof NavStackSchema>;
export declare const CommandCategorySchema: z.ZodEnum<["navigation", "project", "server", "agent", "files", "utility"]>;
export type CommandCategory = z.infer<typeof CommandCategorySchema>;
export declare const CommandDefSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodString;
    category: z.ZodEnum<["navigation", "project", "server", "agent", "files", "utility"]>;
    shortcut: z.ZodOptional<z.ZodString>;
    aliases: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    description: string;
    name: string;
    id: string;
    category: "server" | "agent" | "files" | "project" | "navigation" | "utility";
    aliases?: string[] | undefined;
    shortcut?: string | undefined;
}, {
    description: string;
    name: string;
    id: string;
    category: "server" | "agent" | "files" | "project" | "navigation" | "utility";
    aliases?: string[] | undefined;
    shortcut?: string | undefined;
}>;
export type CommandDef = z.infer<typeof CommandDefSchema>;
export declare const CommandPaletteStateSchema: z.ZodObject<{
    open: z.ZodBoolean;
    query: z.ZodString;
    selectedIndex: z.ZodNumber;
    filteredCommands: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        description: z.ZodString;
        category: z.ZodEnum<["navigation", "project", "server", "agent", "files", "utility"]>;
        shortcut: z.ZodOptional<z.ZodString>;
        aliases: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        description: string;
        name: string;
        id: string;
        category: "server" | "agent" | "files" | "project" | "navigation" | "utility";
        aliases?: string[] | undefined;
        shortcut?: string | undefined;
    }, {
        description: string;
        name: string;
        id: string;
        category: "server" | "agent" | "files" | "project" | "navigation" | "utility";
        aliases?: string[] | undefined;
        shortcut?: string | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    open: boolean;
    query: string;
    selectedIndex: number;
    filteredCommands: {
        description: string;
        name: string;
        id: string;
        category: "server" | "agent" | "files" | "project" | "navigation" | "utility";
        aliases?: string[] | undefined;
        shortcut?: string | undefined;
    }[];
}, {
    open: boolean;
    query: string;
    selectedIndex: number;
    filteredCommands: {
        description: string;
        name: string;
        id: string;
        category: "server" | "agent" | "files" | "project" | "navigation" | "utility";
        aliases?: string[] | undefined;
        shortcut?: string | undefined;
    }[];
}>;
export type CommandPaletteState = z.infer<typeof CommandPaletteStateSchema>;
export declare const SearchResultTypeSchema: z.ZodEnum<["file", "route", "command", "agent", "tool"]>;
export type SearchResultType = z.infer<typeof SearchResultTypeSchema>;
export declare const SearchResultSchema: z.ZodObject<{
    type: z.ZodEnum<["file", "route", "command", "agent", "tool"]>;
    id: z.ZodString;
    label: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    path: z.ZodOptional<z.ZodString>;
    score: z.ZodNumber;
    matches: z.ZodOptional<z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>, "many">>;
}, "strip", z.ZodTypeAny, {
    type: "agent" | "file" | "route" | "tool" | "command";
    label: string;
    id: string;
    score: number;
    path?: string | undefined;
    description?: string | undefined;
    matches?: [number, number][] | undefined;
}, {
    type: "agent" | "file" | "route" | "tool" | "command";
    label: string;
    id: string;
    score: number;
    path?: string | undefined;
    description?: string | undefined;
    matches?: [number, number][] | undefined;
}>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export declare const SearchStateSchema: z.ZodObject<{
    open: z.ZodBoolean;
    query: z.ZodString;
    selectedIndex: z.ZodNumber;
    results: z.ZodArray<z.ZodObject<{
        type: z.ZodEnum<["file", "route", "command", "agent", "tool"]>;
        id: z.ZodString;
        label: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        path: z.ZodOptional<z.ZodString>;
        score: z.ZodNumber;
        matches: z.ZodOptional<z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>, "many">>;
    }, "strip", z.ZodTypeAny, {
        type: "agent" | "file" | "route" | "tool" | "command";
        label: string;
        id: string;
        score: number;
        path?: string | undefined;
        description?: string | undefined;
        matches?: [number, number][] | undefined;
    }, {
        type: "agent" | "file" | "route" | "tool" | "command";
        label: string;
        id: string;
        score: number;
        path?: string | undefined;
        description?: string | undefined;
        matches?: [number, number][] | undefined;
    }>, "many">;
    loading: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    open: boolean;
    loading: boolean;
    query: string;
    results: {
        type: "agent" | "file" | "route" | "tool" | "command";
        label: string;
        id: string;
        score: number;
        path?: string | undefined;
        description?: string | undefined;
        matches?: [number, number][] | undefined;
    }[];
    selectedIndex: number;
}, {
    open: boolean;
    loading: boolean;
    query: string;
    results: {
        type: "agent" | "file" | "route" | "tool" | "command";
        label: string;
        id: string;
        score: number;
        path?: string | undefined;
        description?: string | undefined;
        matches?: [number, number][] | undefined;
    }[];
    selectedIndex: number;
}>;
export type SearchState = z.infer<typeof SearchStateSchema>;
export declare const SlashCommandSchema: z.ZodObject<{
    command: z.ZodString;
    args: z.ZodArray<z.ZodString, "many">;
    flags: z.ZodRecord<z.ZodString, z.ZodUnion<[z.ZodString, z.ZodBoolean]>>;
}, "strip", z.ZodTypeAny, {
    args: string[];
    command: string;
    flags: Record<string, string | boolean>;
}, {
    args: string[];
    command: string;
    flags: Record<string, string | boolean>;
}>;
export type SlashCommand = z.infer<typeof SlashCommandSchema>;
export declare const AgentTypeSchema: z.ZodEnum<["cli", "ide"]>;
export type AgentType = z.infer<typeof AgentTypeSchema>;
export declare const CodingAgentDefSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    command: z.ZodString;
    provider: z.ZodString;
    type: z.ZodEnum<["cli", "ide"]>;
    models: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    defaultModel: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "cli" | "ide";
    provider: string;
    name: string;
    id: string;
    command: string;
    models?: string[] | undefined;
    defaultModel?: string | undefined;
}, {
    type: "cli" | "ide";
    provider: string;
    name: string;
    id: string;
    command: string;
    models?: string[] | undefined;
    defaultModel?: string | undefined;
}>;
export type CodingAgentDef = z.infer<typeof CodingAgentDefSchema>;
export declare const AgentSessionSchema: z.ZodObject<{
    id: z.ZodString;
    agentId: z.ZodString;
    model: z.ZodOptional<z.ZodString>;
    status: z.ZodEnum<["starting", "running", "backgrounded", "stopped"]>;
    projectPath: z.ZodString;
    startedAt: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    status: "running" | "starting" | "backgrounded" | "stopped";
    agentId: string;
    id: string;
    startedAt: number;
    projectPath: string;
    model?: string | undefined;
}, {
    status: "running" | "starting" | "backgrounded" | "stopped";
    agentId: string;
    id: string;
    startedAt: number;
    projectPath: string;
    model?: string | undefined;
}>;
export type AgentSession = z.infer<typeof AgentSessionSchema>;
export declare const CodingAgentStateSchema: z.ZodObject<{
    activeAgent: z.ZodNullable<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        command: z.ZodString;
        provider: z.ZodString;
        type: z.ZodEnum<["cli", "ide"]>;
        models: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        defaultModel: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "cli" | "ide";
        provider: string;
        name: string;
        id: string;
        command: string;
        models?: string[] | undefined;
        defaultModel?: string | undefined;
    }, {
        type: "cli" | "ide";
        provider: string;
        name: string;
        id: string;
        command: string;
        models?: string[] | undefined;
        defaultModel?: string | undefined;
    }>>;
    activeModel: z.ZodNullable<z.ZodString>;
    agents: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        command: z.ZodString;
        provider: z.ZodString;
        type: z.ZodEnum<["cli", "ide"]>;
        models: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        defaultModel: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "cli" | "ide";
        provider: string;
        name: string;
        id: string;
        command: string;
        models?: string[] | undefined;
        defaultModel?: string | undefined;
    }, {
        type: "cli" | "ide";
        provider: string;
        name: string;
        id: string;
        command: string;
        models?: string[] | undefined;
        defaultModel?: string | undefined;
    }>, "many">;
    installedAgents: z.ZodArray<z.ZodString, "many">;
    sessions: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        agentId: z.ZodString;
        model: z.ZodOptional<z.ZodString>;
        status: z.ZodEnum<["starting", "running", "backgrounded", "stopped"]>;
        projectPath: z.ZodString;
        startedAt: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        status: "running" | "starting" | "backgrounded" | "stopped";
        agentId: string;
        id: string;
        startedAt: number;
        projectPath: string;
        model?: string | undefined;
    }, {
        status: "running" | "starting" | "backgrounded" | "stopped";
        agentId: string;
        id: string;
        startedAt: number;
        projectPath: string;
        model?: string | undefined;
    }>, "many">;
    pickerOpen: z.ZodBoolean;
    pickerIndex: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    agents: {
        type: "cli" | "ide";
        provider: string;
        name: string;
        id: string;
        command: string;
        models?: string[] | undefined;
        defaultModel?: string | undefined;
    }[];
    activeAgent: {
        type: "cli" | "ide";
        provider: string;
        name: string;
        id: string;
        command: string;
        models?: string[] | undefined;
        defaultModel?: string | undefined;
    } | null;
    activeModel: string | null;
    installedAgents: string[];
    sessions: {
        status: "running" | "starting" | "backgrounded" | "stopped";
        agentId: string;
        id: string;
        startedAt: number;
        projectPath: string;
        model?: string | undefined;
    }[];
    pickerOpen: boolean;
    pickerIndex: number;
}, {
    agents: {
        type: "cli" | "ide";
        provider: string;
        name: string;
        id: string;
        command: string;
        models?: string[] | undefined;
        defaultModel?: string | undefined;
    }[];
    activeAgent: {
        type: "cli" | "ide";
        provider: string;
        name: string;
        id: string;
        command: string;
        models?: string[] | undefined;
        defaultModel?: string | undefined;
    } | null;
    activeModel: string | null;
    installedAgents: string[];
    sessions: {
        status: "running" | "starting" | "backgrounded" | "stopped";
        agentId: string;
        id: string;
        startedAt: number;
        projectPath: string;
        model?: string | undefined;
    }[];
    pickerOpen: boolean;
    pickerIndex: number;
}>;
export type CodingAgentState = z.infer<typeof CodingAgentStateSchema>;
export declare const KeyChordStateSchema: z.ZodObject<{
    pending: z.ZodNullable<z.ZodString>;
    startTime: z.ZodNullable<z.ZodNumber>;
    count: z.ZodNullable<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    pending: string | null;
    count: number | null;
    startTime: number | null;
}, {
    pending: string | null;
    count: number | null;
    startTime: number | null;
}>;
export type KeyChordState = z.infer<typeof KeyChordStateSchema>;
export declare const ModalTypeSchema: z.ZodEnum<["command-palette", "search", "agent-picker", "confirmation", "model-picker"]>;
export type ModalType = z.infer<typeof ModalTypeSchema>;
export declare const ConfirmationOptionsSchema: z.ZodObject<{
    title: z.ZodString;
    message: z.ZodString;
    confirmLabel: z.ZodDefault<z.ZodString>;
    cancelLabel: z.ZodDefault<z.ZodString>;
    variant: z.ZodDefault<z.ZodEnum<["info", "warning", "danger"]>>;
}, "strip", z.ZodTypeAny, {
    message: string;
    title: string;
    confirmLabel: string;
    cancelLabel: string;
    variant: "info" | "warning" | "danger";
}, {
    message: string;
    title: string;
    confirmLabel?: string | undefined;
    cancelLabel?: string | undefined;
    variant?: "info" | "warning" | "danger" | undefined;
}>;
export type ConfirmationOptions = z.infer<typeof ConfirmationOptionsSchema>;
export declare const ConfirmationStateSchema: z.ZodObject<{
    open: z.ZodBoolean;
    options: z.ZodNullable<z.ZodObject<{
        title: z.ZodString;
        message: z.ZodString;
        confirmLabel: z.ZodDefault<z.ZodString>;
        cancelLabel: z.ZodDefault<z.ZodString>;
        variant: z.ZodDefault<z.ZodEnum<["info", "warning", "danger"]>>;
    }, "strip", z.ZodTypeAny, {
        message: string;
        title: string;
        confirmLabel: string;
        cancelLabel: string;
        variant: "info" | "warning" | "danger";
    }, {
        message: string;
        title: string;
        confirmLabel?: string | undefined;
        cancelLabel?: string | undefined;
        variant?: "info" | "warning" | "danger" | undefined;
    }>>;
    selectedIndex: z.ZodNumber;
    onConfirm: z.ZodNullable<z.ZodFunction<z.ZodTuple<[], z.ZodUnknown>, z.ZodVoid>>;
    onCancel: z.ZodNullable<z.ZodFunction<z.ZodTuple<[], z.ZodUnknown>, z.ZodVoid>>;
}, "strip", z.ZodTypeAny, {
    open: boolean;
    options: {
        message: string;
        title: string;
        confirmLabel: string;
        cancelLabel: string;
        variant: "info" | "warning" | "danger";
    } | null;
    selectedIndex: number;
    onConfirm: ((...args: unknown[]) => void) | null;
    onCancel: ((...args: unknown[]) => void) | null;
}, {
    open: boolean;
    options: {
        message: string;
        title: string;
        confirmLabel?: string | undefined;
        cancelLabel?: string | undefined;
        variant?: "info" | "warning" | "danger" | undefined;
    } | null;
    selectedIndex: number;
    onConfirm: ((...args: unknown[]) => void) | null;
    onCancel: ((...args: unknown[]) => void) | null;
}>;
export type ConfirmationState = z.infer<typeof ConfirmationStateSchema>;
export declare const UserPreferencesSchema: z.ZodObject<{
    defaultAgent: z.ZodNullable<z.ZodString>;
    autoConnect: z.ZodDefault<z.ZodBoolean>;
    fallbackToTui: z.ZodDefault<z.ZodBoolean>;
    theme: z.ZodDefault<z.ZodEnum<["dark", "light", "auto"]>>;
}, "strip", z.ZodTypeAny, {
    theme: "auto" | "dark" | "light";
    defaultAgent: string | null;
    autoConnect: boolean;
    fallbackToTui: boolean;
}, {
    defaultAgent: string | null;
    theme?: "auto" | "dark" | "light" | undefined;
    autoConnect?: boolean | undefined;
    fallbackToTui?: boolean | undefined;
}>;
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;
export declare const CommandHistoryEntrySchema: z.ZodObject<{
    command: z.ZodString;
    timestamp: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    timestamp: number;
    command: string;
}, {
    timestamp: number;
    command: string;
}>;
export type CommandHistoryEntry = z.infer<typeof CommandHistoryEntrySchema>;
export declare const ExtendedStateSchema: z.ZodObject<{
    mode: z.ZodEnum<["NORMAL", "COMMAND", "SEARCH", "INSERT"]>;
    navStack: z.ZodObject<{
        stack: z.ZodArray<z.ZodObject<{
            view: z.ZodEnum<["dashboard", "project-detail", "resources", "settings", "new-project", "templates", "examples", "auth", "help"]>;
            params: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            scrollPosition: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            view: "auth" | "help" | "settings" | "resources" | "examples" | "dashboard" | "project-detail" | "new-project" | "templates";
            params?: Record<string, string> | undefined;
            scrollPosition?: number | undefined;
        }, {
            view: "auth" | "help" | "settings" | "resources" | "examples" | "dashboard" | "project-detail" | "new-project" | "templates";
            params?: Record<string, string> | undefined;
            scrollPosition?: number | undefined;
        }>, "many">;
        maxSize: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        maxSize: number;
        stack: {
            view: "auth" | "help" | "settings" | "resources" | "examples" | "dashboard" | "project-detail" | "new-project" | "templates";
            params?: Record<string, string> | undefined;
            scrollPosition?: number | undefined;
        }[];
    }, {
        stack: {
            view: "auth" | "help" | "settings" | "resources" | "examples" | "dashboard" | "project-detail" | "new-project" | "templates";
            params?: Record<string, string> | undefined;
            scrollPosition?: number | undefined;
        }[];
        maxSize?: number | undefined;
    }>;
    keyChord: z.ZodObject<{
        pending: z.ZodNullable<z.ZodString>;
        startTime: z.ZodNullable<z.ZodNumber>;
        count: z.ZodNullable<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        pending: string | null;
        count: number | null;
        startTime: number | null;
    }, {
        pending: string | null;
        count: number | null;
        startTime: number | null;
    }>;
    commandPalette: z.ZodObject<{
        open: z.ZodBoolean;
        query: z.ZodString;
        selectedIndex: z.ZodNumber;
        filteredCommands: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            description: z.ZodString;
            category: z.ZodEnum<["navigation", "project", "server", "agent", "files", "utility"]>;
            shortcut: z.ZodOptional<z.ZodString>;
            aliases: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "strip", z.ZodTypeAny, {
            description: string;
            name: string;
            id: string;
            category: "server" | "agent" | "files" | "project" | "navigation" | "utility";
            aliases?: string[] | undefined;
            shortcut?: string | undefined;
        }, {
            description: string;
            name: string;
            id: string;
            category: "server" | "agent" | "files" | "project" | "navigation" | "utility";
            aliases?: string[] | undefined;
            shortcut?: string | undefined;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        open: boolean;
        query: string;
        selectedIndex: number;
        filteredCommands: {
            description: string;
            name: string;
            id: string;
            category: "server" | "agent" | "files" | "project" | "navigation" | "utility";
            aliases?: string[] | undefined;
            shortcut?: string | undefined;
        }[];
    }, {
        open: boolean;
        query: string;
        selectedIndex: number;
        filteredCommands: {
            description: string;
            name: string;
            id: string;
            category: "server" | "agent" | "files" | "project" | "navigation" | "utility";
            aliases?: string[] | undefined;
            shortcut?: string | undefined;
        }[];
    }>;
    search: z.ZodObject<{
        open: z.ZodBoolean;
        query: z.ZodString;
        selectedIndex: z.ZodNumber;
        results: z.ZodArray<z.ZodObject<{
            type: z.ZodEnum<["file", "route", "command", "agent", "tool"]>;
            id: z.ZodString;
            label: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
            path: z.ZodOptional<z.ZodString>;
            score: z.ZodNumber;
            matches: z.ZodOptional<z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>, "many">>;
        }, "strip", z.ZodTypeAny, {
            type: "agent" | "file" | "route" | "tool" | "command";
            label: string;
            id: string;
            score: number;
            path?: string | undefined;
            description?: string | undefined;
            matches?: [number, number][] | undefined;
        }, {
            type: "agent" | "file" | "route" | "tool" | "command";
            label: string;
            id: string;
            score: number;
            path?: string | undefined;
            description?: string | undefined;
            matches?: [number, number][] | undefined;
        }>, "many">;
        loading: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        open: boolean;
        loading: boolean;
        query: string;
        results: {
            type: "agent" | "file" | "route" | "tool" | "command";
            label: string;
            id: string;
            score: number;
            path?: string | undefined;
            description?: string | undefined;
            matches?: [number, number][] | undefined;
        }[];
        selectedIndex: number;
    }, {
        open: boolean;
        loading: boolean;
        query: string;
        results: {
            type: "agent" | "file" | "route" | "tool" | "command";
            label: string;
            id: string;
            score: number;
            path?: string | undefined;
            description?: string | undefined;
            matches?: [number, number][] | undefined;
        }[];
        selectedIndex: number;
    }>;
    codingAgent: z.ZodObject<{
        activeAgent: z.ZodNullable<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            command: z.ZodString;
            provider: z.ZodString;
            type: z.ZodEnum<["cli", "ide"]>;
            models: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            defaultModel: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: "cli" | "ide";
            provider: string;
            name: string;
            id: string;
            command: string;
            models?: string[] | undefined;
            defaultModel?: string | undefined;
        }, {
            type: "cli" | "ide";
            provider: string;
            name: string;
            id: string;
            command: string;
            models?: string[] | undefined;
            defaultModel?: string | undefined;
        }>>;
        activeModel: z.ZodNullable<z.ZodString>;
        agents: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            command: z.ZodString;
            provider: z.ZodString;
            type: z.ZodEnum<["cli", "ide"]>;
            models: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            defaultModel: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: "cli" | "ide";
            provider: string;
            name: string;
            id: string;
            command: string;
            models?: string[] | undefined;
            defaultModel?: string | undefined;
        }, {
            type: "cli" | "ide";
            provider: string;
            name: string;
            id: string;
            command: string;
            models?: string[] | undefined;
            defaultModel?: string | undefined;
        }>, "many">;
        installedAgents: z.ZodArray<z.ZodString, "many">;
        sessions: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            agentId: z.ZodString;
            model: z.ZodOptional<z.ZodString>;
            status: z.ZodEnum<["starting", "running", "backgrounded", "stopped"]>;
            projectPath: z.ZodString;
            startedAt: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            status: "running" | "starting" | "backgrounded" | "stopped";
            agentId: string;
            id: string;
            startedAt: number;
            projectPath: string;
            model?: string | undefined;
        }, {
            status: "running" | "starting" | "backgrounded" | "stopped";
            agentId: string;
            id: string;
            startedAt: number;
            projectPath: string;
            model?: string | undefined;
        }>, "many">;
        pickerOpen: z.ZodBoolean;
        pickerIndex: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        agents: {
            type: "cli" | "ide";
            provider: string;
            name: string;
            id: string;
            command: string;
            models?: string[] | undefined;
            defaultModel?: string | undefined;
        }[];
        activeAgent: {
            type: "cli" | "ide";
            provider: string;
            name: string;
            id: string;
            command: string;
            models?: string[] | undefined;
            defaultModel?: string | undefined;
        } | null;
        activeModel: string | null;
        installedAgents: string[];
        sessions: {
            status: "running" | "starting" | "backgrounded" | "stopped";
            agentId: string;
            id: string;
            startedAt: number;
            projectPath: string;
            model?: string | undefined;
        }[];
        pickerOpen: boolean;
        pickerIndex: number;
    }, {
        agents: {
            type: "cli" | "ide";
            provider: string;
            name: string;
            id: string;
            command: string;
            models?: string[] | undefined;
            defaultModel?: string | undefined;
        }[];
        activeAgent: {
            type: "cli" | "ide";
            provider: string;
            name: string;
            id: string;
            command: string;
            models?: string[] | undefined;
            defaultModel?: string | undefined;
        } | null;
        activeModel: string | null;
        installedAgents: string[];
        sessions: {
            status: "running" | "starting" | "backgrounded" | "stopped";
            agentId: string;
            id: string;
            startedAt: number;
            projectPath: string;
            model?: string | undefined;
        }[];
        pickerOpen: boolean;
        pickerIndex: number;
    }>;
    confirmation: z.ZodObject<{
        open: z.ZodBoolean;
        options: z.ZodNullable<z.ZodObject<{
            title: z.ZodString;
            message: z.ZodString;
            confirmLabel: z.ZodDefault<z.ZodString>;
            cancelLabel: z.ZodDefault<z.ZodString>;
            variant: z.ZodDefault<z.ZodEnum<["info", "warning", "danger"]>>;
        }, "strip", z.ZodTypeAny, {
            message: string;
            title: string;
            confirmLabel: string;
            cancelLabel: string;
            variant: "info" | "warning" | "danger";
        }, {
            message: string;
            title: string;
            confirmLabel?: string | undefined;
            cancelLabel?: string | undefined;
            variant?: "info" | "warning" | "danger" | undefined;
        }>>;
        selectedIndex: z.ZodNumber;
        onConfirm: z.ZodNullable<z.ZodFunction<z.ZodTuple<[], z.ZodUnknown>, z.ZodVoid>>;
        onCancel: z.ZodNullable<z.ZodFunction<z.ZodTuple<[], z.ZodUnknown>, z.ZodVoid>>;
    }, "strip", z.ZodTypeAny, {
        open: boolean;
        options: {
            message: string;
            title: string;
            confirmLabel: string;
            cancelLabel: string;
            variant: "info" | "warning" | "danger";
        } | null;
        selectedIndex: number;
        onConfirm: ((...args: unknown[]) => void) | null;
        onCancel: ((...args: unknown[]) => void) | null;
    }, {
        open: boolean;
        options: {
            message: string;
            title: string;
            confirmLabel?: string | undefined;
            cancelLabel?: string | undefined;
            variant?: "info" | "warning" | "danger" | undefined;
        } | null;
        selectedIndex: number;
        onConfirm: ((...args: unknown[]) => void) | null;
        onCancel: ((...args: unknown[]) => void) | null;
    }>;
    projectTab: z.ZodEnum<["dashboard", "files", "routes", "agents", "terminal", "logs"]>;
    resourceTab: z.ZodEnum<["files", "routes", "agents", "tools", "mcp"]>;
}, "strip", z.ZodTypeAny, {
    search: {
        open: boolean;
        loading: boolean;
        query: string;
        results: {
            type: "agent" | "file" | "route" | "tool" | "command";
            label: string;
            id: string;
            score: number;
            path?: string | undefined;
            description?: string | undefined;
            matches?: [number, number][] | undefined;
        }[];
        selectedIndex: number;
    };
    mode: "NORMAL" | "COMMAND" | "SEARCH" | "INSERT";
    confirmation: {
        open: boolean;
        options: {
            message: string;
            title: string;
            confirmLabel: string;
            cancelLabel: string;
            variant: "info" | "warning" | "danger";
        } | null;
        selectedIndex: number;
        onConfirm: ((...args: unknown[]) => void) | null;
        onCancel: ((...args: unknown[]) => void) | null;
    };
    navStack: {
        maxSize: number;
        stack: {
            view: "auth" | "help" | "settings" | "resources" | "examples" | "dashboard" | "project-detail" | "new-project" | "templates";
            params?: Record<string, string> | undefined;
            scrollPosition?: number | undefined;
        }[];
    };
    keyChord: {
        pending: string | null;
        count: number | null;
        startTime: number | null;
    };
    commandPalette: {
        open: boolean;
        query: string;
        selectedIndex: number;
        filteredCommands: {
            description: string;
            name: string;
            id: string;
            category: "server" | "agent" | "files" | "project" | "navigation" | "utility";
            aliases?: string[] | undefined;
            shortcut?: string | undefined;
        }[];
    };
    codingAgent: {
        agents: {
            type: "cli" | "ide";
            provider: string;
            name: string;
            id: string;
            command: string;
            models?: string[] | undefined;
            defaultModel?: string | undefined;
        }[];
        activeAgent: {
            type: "cli" | "ide";
            provider: string;
            name: string;
            id: string;
            command: string;
            models?: string[] | undefined;
            defaultModel?: string | undefined;
        } | null;
        activeModel: string | null;
        installedAgents: string[];
        sessions: {
            status: "running" | "starting" | "backgrounded" | "stopped";
            agentId: string;
            id: string;
            startedAt: number;
            projectPath: string;
            model?: string | undefined;
        }[];
        pickerOpen: boolean;
        pickerIndex: number;
    };
    projectTab: "files" | "routes" | "agents" | "logs" | "dashboard" | "terminal";
    resourceTab: "files" | "routes" | "mcp" | "tools" | "agents";
}, {
    search: {
        open: boolean;
        loading: boolean;
        query: string;
        results: {
            type: "agent" | "file" | "route" | "tool" | "command";
            label: string;
            id: string;
            score: number;
            path?: string | undefined;
            description?: string | undefined;
            matches?: [number, number][] | undefined;
        }[];
        selectedIndex: number;
    };
    mode: "NORMAL" | "COMMAND" | "SEARCH" | "INSERT";
    confirmation: {
        open: boolean;
        options: {
            message: string;
            title: string;
            confirmLabel?: string | undefined;
            cancelLabel?: string | undefined;
            variant?: "info" | "warning" | "danger" | undefined;
        } | null;
        selectedIndex: number;
        onConfirm: ((...args: unknown[]) => void) | null;
        onCancel: ((...args: unknown[]) => void) | null;
    };
    navStack: {
        stack: {
            view: "auth" | "help" | "settings" | "resources" | "examples" | "dashboard" | "project-detail" | "new-project" | "templates";
            params?: Record<string, string> | undefined;
            scrollPosition?: number | undefined;
        }[];
        maxSize?: number | undefined;
    };
    keyChord: {
        pending: string | null;
        count: number | null;
        startTime: number | null;
    };
    commandPalette: {
        open: boolean;
        query: string;
        selectedIndex: number;
        filteredCommands: {
            description: string;
            name: string;
            id: string;
            category: "server" | "agent" | "files" | "project" | "navigation" | "utility";
            aliases?: string[] | undefined;
            shortcut?: string | undefined;
        }[];
    };
    codingAgent: {
        agents: {
            type: "cli" | "ide";
            provider: string;
            name: string;
            id: string;
            command: string;
            models?: string[] | undefined;
            defaultModel?: string | undefined;
        }[];
        activeAgent: {
            type: "cli" | "ide";
            provider: string;
            name: string;
            id: string;
            command: string;
            models?: string[] | undefined;
            defaultModel?: string | undefined;
        } | null;
        activeModel: string | null;
        installedAgents: string[];
        sessions: {
            status: "running" | "starting" | "backgrounded" | "stopped";
            agentId: string;
            id: string;
            startedAt: number;
            projectPath: string;
            model?: string | undefined;
        }[];
        pickerOpen: boolean;
        pickerIndex: number;
    };
    projectTab: "files" | "routes" | "agents" | "logs" | "dashboard" | "terminal";
    resourceTab: "files" | "routes" | "mcp" | "tools" | "agents";
}>;
export type ExtendedState = z.infer<typeof ExtendedStateSchema>;
export declare function createNavStack(): NavStack;
export declare function createKeyChordState(): KeyChordState;
export declare function createCommandPaletteState(): CommandPaletteState;
export declare function createSearchState(): SearchState;
export declare function createCodingAgentState(): CodingAgentState;
export declare function createConfirmationState(): ConfirmationState;
export declare function createExtendedState(): ExtendedState;
//# sourceMappingURL=types.d.ts.map