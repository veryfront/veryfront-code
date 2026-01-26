import { z } from "zod";
import type { MCPTool } from "./tools.js";
type RouteType = "page" | "layout" | "api" | "error" | "loading" | "not-found";
interface RouteInfo {
    path: string;
    type: RouteType;
    file: string;
    methods?: string[];
}
interface ProjectContext {
    name: string;
    router: "app" | "pages";
    routes: RouteInfo[];
    directories: {
        app?: string;
        pages?: string;
        components?: string;
        lib?: string;
        ai?: string;
    };
    hasAI: boolean;
    integrations: string[];
    features: string[];
}
interface ScaffoldResult {
    success: boolean;
    files: Array<{
        path: string;
        created: boolean;
    }>;
    message: string;
}
declare const listRoutesInput: z.ZodObject<{
    type: z.ZodDefault<z.ZodOptional<z.ZodEnum<["all", "pages", "api", "layouts"]>>>;
    projectPath: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "api" | "pages" | "all" | "layouts";
    projectPath?: string | undefined;
}, {
    type?: "api" | "pages" | "all" | "layouts" | undefined;
    projectPath?: string | undefined;
}>;
type ListRoutesInput = z.infer<typeof listRoutesInput>;
export declare const vfListRoutes: MCPTool<ListRoutesInput, RouteInfo[]>;
declare const getProjectContextInput: z.ZodObject<{
    projectPath: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    projectPath?: string | undefined;
}, {
    projectPath?: string | undefined;
}>;
type GetProjectContextInput = z.infer<typeof getProjectContextInput>;
export declare const vfGetProjectContext: MCPTool<GetProjectContextInput, ProjectContext>;
declare const scaffoldInput: z.ZodObject<{
    type: z.ZodEnum<["page", "api", "layout", "component", "tool", "agent", "prompt"]>;
    name: z.ZodString;
    methods: z.ZodOptional<z.ZodArray<z.ZodEnum<["GET", "POST", "PUT", "DELETE", "PATCH"]>, "many">>;
    projectPath: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "prompt" | "page" | "api" | "agent" | "component" | "layout" | "tool";
    name: string;
    methods?: ("DELETE" | "GET" | "PATCH" | "POST" | "PUT")[] | undefined;
    projectPath?: string | undefined;
}, {
    type: "prompt" | "page" | "api" | "agent" | "component" | "layout" | "tool";
    name: string;
    methods?: ("DELETE" | "GET" | "PATCH" | "POST" | "PUT")[] | undefined;
    projectPath?: string | undefined;
}>;
type ScaffoldInput = z.infer<typeof scaffoldInput>;
export declare const vfScaffold: MCPTool<ScaffoldInput, ScaffoldResult>;
declare const getConventionsInput: z.ZodObject<{
    topic: z.ZodDefault<z.ZodOptional<z.ZodEnum<["all", "routing", "api", "components", "ai", "styling"]>>>;
}, "strip", z.ZodTypeAny, {
    topic: "api" | "components" | "all" | "ai" | "routing" | "styling";
}, {
    topic?: "api" | "components" | "all" | "ai" | "routing" | "styling" | undefined;
}>;
type GetConventionsInput = z.infer<typeof getConventionsInput>;
interface Convention {
    topic: string;
    rules: string[];
    examples: Array<{
        good: string;
        bad?: string;
        explanation: string;
    }>;
}
export declare const vfGetConventions: MCPTool<GetConventionsInput, Convention[]>;
declare const hotReloadInput: z.ZodObject<{
    file: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    file?: string | undefined;
}, {
    file?: string | undefined;
}>;
type HotReloadInput = z.infer<typeof hotReloadInput>;
interface HotReloadResult {
    success: boolean;
    message: string;
}
export declare const vfHotReload: MCPTool<HotReloadInput, HotReloadResult>;
declare const getDebugContextInput: z.ZodObject<{
    port: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    project: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    port: number;
    project?: string | undefined;
}, {
    port?: number | undefined;
    project?: string | undefined;
}>;
type GetDebugContextInput = z.infer<typeof getDebugContextInput>;
interface DebugContextResult {
    success: boolean;
    context?: {
        projectSlug: string;
        projectDir: string;
        requestContextMode?: string;
        isMultiProjectMode: boolean;
    };
    error?: string;
}
export declare const vfGetDebugContext: MCPTool<GetDebugContextInput, DebugContextResult>;
declare const triggerHmrInput: z.ZodObject<{
    path: z.ZodString;
    port: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    port: number;
    path: string;
}, {
    path: string;
    port?: number | undefined;
}>;
type TriggerHmrInput = z.infer<typeof triggerHmrInput>;
interface TriggerHmrResult {
    success: boolean;
    message: string;
}
export declare const vfTriggerHmr: MCPTool<TriggerHmrInput, TriggerHmrResult>;
declare const previewRouteInput: z.ZodObject<{
    route: z.ZodString;
    port: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    format: z.ZodDefault<z.ZodOptional<z.ZodEnum<["html", "json", "status"]>>>;
}, "strip", z.ZodTypeAny, {
    port: number;
    route: string;
    format: "status" | "json" | "html";
}, {
    route: string;
    port?: number | undefined;
    format?: "status" | "json" | "html" | undefined;
}>;
type PreviewRouteInput = z.infer<typeof previewRouteInput>;
interface PreviewRouteResult {
    success: boolean;
    status: number;
    contentType?: string;
    body?: string;
    headers?: Record<string, string>;
    error?: string;
    renderTime?: number;
}
export declare const vfPreviewRoute: MCPTool<PreviewRouteInput, PreviewRouteResult>;
declare const getComponentTreeInput: z.ZodObject<{
    route: z.ZodString;
    projectPath: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    route: string;
    projectPath?: string | undefined;
}, {
    route: string;
    projectPath?: string | undefined;
}>;
type GetComponentTreeInput = z.infer<typeof getComponentTreeInput>;
interface ComponentNode {
    name: string;
    type: "page" | "layout" | "component" | "provider";
    file: string;
    children?: ComponentNode[];
    props?: string[];
}
interface ComponentTreeResult {
    route: string;
    tree: ComponentNode[];
    layouts: string[];
    providers: string[];
}
export declare const vfGetComponentTree: MCPTool<GetComponentTreeInput, ComponentTreeResult>;
declare const getSkillsInput: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name?: string | undefined;
}, {
    name?: string | undefined;
}>;
type GetSkillsInput = z.infer<typeof getSkillsInput>;
interface SkillMetadata {
    name: string;
    description: string;
    license?: string;
    compatibility?: string;
    tools?: string[];
}
interface SkillContent extends SkillMetadata {
    content: string;
    references?: string[];
}
interface GetSkillsResult {
    skills?: SkillMetadata[];
    skill?: SkillContent;
    error?: string;
}
export declare const vfGetSkills: MCPTool<GetSkillsInput, GetSkillsResult>;
declare const getSkillReferenceInput: z.ZodObject<{
    skill: z.ZodString;
    reference: z.ZodString;
}, "strip", z.ZodTypeAny, {
    skill: string;
    reference: string;
}, {
    skill: string;
    reference: string;
}>;
type GetSkillReferenceInput = z.infer<typeof getSkillReferenceInput>;
interface GetSkillReferenceResult {
    content?: string;
    error?: string;
}
export declare const vfGetSkillReference: MCPTool<GetSkillReferenceInput, GetSkillReferenceResult>;
declare const listLocalProjectsInput: z.ZodObject<{
    directory: z.ZodOptional<z.ZodString>;
    depth: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    depth: number;
    directory?: string | undefined;
}, {
    depth?: number | undefined;
    directory?: string | undefined;
}>;
type ListLocalProjectsInput = z.infer<typeof listLocalProjectsInput>;
interface LocalProjectInfo {
    name: string;
    path: string;
    template?: string;
    hasAI: boolean;
    integrations: string[];
    lastModified?: string;
}
export declare const vfListLocalProjects: MCPTool<ListLocalProjectsInput, LocalProjectInfo[]>;
declare const listExamplesInput: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
type ListExamplesInput = z.infer<typeof listExamplesInput>;
interface ExampleInfo {
    name: string;
    description: string;
    template: string;
    integrations: string[];
    features: string[];
    difficulty: "beginner" | "intermediate" | "advanced";
    path?: string;
}
export declare const vfListExamples: MCPTool<ListExamplesInput, ExampleInfo[]>;
declare const listTemplatesInput: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
type ListTemplatesInput = z.infer<typeof listTemplatesInput>;
interface TemplateInfo {
    name: string;
    description: string;
    features: string[];
    recommended?: boolean;
}
export declare const vfListTemplates: MCPTool<ListTemplatesInput, TemplateInfo[]>;
declare const listIntegrationsInput: z.ZodObject<{
    category: z.ZodDefault<z.ZodOptional<z.ZodEnum<["all", "productivity", "development", "communication", "data", "ai"]>>>;
}, "strip", z.ZodTypeAny, {
    category: "development" | "data" | "all" | "ai" | "productivity" | "communication";
}, {
    category?: "development" | "data" | "all" | "ai" | "productivity" | "communication" | undefined;
}>;
type ListIntegrationsInput = z.infer<typeof listIntegrationsInput>;
interface IntegrationInfo {
    name: string;
    displayName: string;
    category: string;
    description: string;
    authType: "oauth2" | "api-key";
}
export declare const vfListIntegrations: MCPTool<ListIntegrationsInput, IntegrationInfo[]>;
declare const listUsecasesInput: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
type ListUsecasesInput = z.infer<typeof listUsecasesInput>;
interface UsecaseInfo {
    name: string;
    displayName: string;
    description: string;
    integrations: string[];
    chatUI: string;
}
export declare const vfListUsecases: MCPTool<ListUsecasesInput, UsecaseInfo[]>;
declare const createProjectInput: z.ZodObject<{
    name: z.ZodString;
    template: z.ZodDefault<z.ZodOptional<z.ZodEnum<["ai", "app", "blog", "docs", "minimal"]>>>;
    integrations: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    directory: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    template: "app" | "docs" | "ai" | "blog" | "minimal";
    directory?: string | undefined;
    integrations?: string[] | undefined;
}, {
    name: string;
    template?: "app" | "docs" | "ai" | "blog" | "minimal" | undefined;
    directory?: string | undefined;
    integrations?: string[] | undefined;
}>;
type CreateProjectInput = z.infer<typeof createProjectInput>;
interface CreateProjectResult {
    success: boolean;
    projectDir?: string;
    message: string;
    nextSteps?: string[];
}
export declare const vfCreateProject: MCPTool<CreateProjectInput, CreateProjectResult>;
declare const waitForReadyInput: z.ZodObject<{
    port: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    timeout: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    interval: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    port: number;
    timeout: number;
    interval: number;
}, {
    port?: number | undefined;
    timeout?: number | undefined;
    interval?: number | undefined;
}>;
type WaitForReadyInput = z.infer<typeof waitForReadyInput>;
interface WaitForReadyResult {
    success: boolean;
    message: string;
    elapsed?: number;
}
export declare const vfWaitForReady: MCPTool<WaitForReadyInput, WaitForReadyResult>;
declare const getFlywheelStatusInput: z.ZodObject<{
    port: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    port: number;
}, {
    port?: number | undefined;
}>;
type GetFlywheelStatusInput = z.infer<typeof getFlywheelStatusInput>;
interface FlywheelStatus {
    server: {
        running: boolean;
        port: number;
        url: string;
        uptime?: number;
    };
    errors: {
        total: number;
        compile: number;
        runtime: number;
        bundle: number;
        hmr: number;
        module: number;
        latest?: {
            type: string;
            message: string;
            file?: string;
            timestamp: number;
        };
    };
    logs: {
        total: number;
        errors: number;
        warnings: number;
    };
    hmr: {
        enabled: boolean;
        reloadListeners: number;
        invalidateListeners: number;
        triggerCalls: number;
        broadcastsSent: number;
    };
}
export declare const vfGetFlywheelStatus: MCPTool<GetFlywheelStatusInput, FlywheelStatus>;
export declare const advancedTools: MCPTool[];
export {};
//# sourceMappingURL=advanced-tools.d.ts.map