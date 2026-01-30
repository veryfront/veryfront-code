/**
 * MCP tools for scaffolding and conventions.
 */
import { z } from "zod";
import type { MCPTool } from "../tools.js";
import { type ScaffoldResult } from "./helpers.js";
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
export {};
//# sourceMappingURL=scaffold-tools.d.ts.map