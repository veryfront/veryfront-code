/**
 * MCP tools for project discovery and analysis.
 */
import { z } from "zod";
import type { MCPTool } from "../tools.js";
import { type ProjectContext, type RouteInfo } from "./helpers.js";
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
export {};
//# sourceMappingURL=project-tools.d.ts.map