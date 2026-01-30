/**
 * MCP tools for catalog browsing and project creation.
 */
import { z } from "zod";
import type { MCPTool } from "../tools.js";
interface ExampleInfo {
    name: string;
    description: string;
    template: string;
    integrations: string[];
    features: string[];
    difficulty: "beginner" | "intermediate" | "advanced";
    path?: string;
}
interface TemplateInfo {
    name: string;
    description: string;
    features: string[];
    recommended?: boolean;
}
interface IntegrationInfo {
    name: string;
    displayName: string;
    category: string;
    description: string;
    authType: "oauth2" | "api-key";
}
interface UsecaseInfo {
    name: string;
    displayName: string;
    description: string;
    integrations: string[];
    chatUI: string;
}
declare const listExamplesInput: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
type ListExamplesInput = z.infer<typeof listExamplesInput>;
export declare const vfListExamples: MCPTool<ListExamplesInput, ExampleInfo[]>;
declare const listTemplatesInput: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
type ListTemplatesInput = z.infer<typeof listTemplatesInput>;
export declare const vfListTemplates: MCPTool<ListTemplatesInput, TemplateInfo[]>;
declare const listIntegrationsInput: z.ZodObject<{
    category: z.ZodDefault<z.ZodOptional<z.ZodEnum<["all", "productivity", "development", "communication", "data", "ai"]>>>;
}, "strip", z.ZodTypeAny, {
    category: "development" | "data" | "all" | "ai" | "productivity" | "communication";
}, {
    category?: "development" | "data" | "all" | "ai" | "productivity" | "communication" | undefined;
}>;
type ListIntegrationsInput = z.infer<typeof listIntegrationsInput>;
export declare const vfListIntegrations: MCPTool<ListIntegrationsInput, IntegrationInfo[]>;
declare const listUsecasesInput: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
type ListUsecasesInput = z.infer<typeof listUsecasesInput>;
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
export {};
//# sourceMappingURL=catalog-tools.d.ts.map