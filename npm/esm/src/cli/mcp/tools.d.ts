/**************************
 * MCP Tools for Veryfront Dev Server
 **************************/
import { z } from "zod";
import { type DevError } from "./error-collector.js";
import { type LogEntry } from "./log-buffer.js";
import { type RuntimeEnv } from "../../config/runtime-env.js";
export interface MCPTool<TInput = any, TOutput = any> {
    name: string;
    description: string;
    inputSchema: z.ZodType<any, any, any>;
    execute: (input: TInput) => Promise<TOutput>;
}
export declare function setServerStartTime(time: number): void;
declare const getErrorsInput: z.ZodObject<{
    type: z.ZodOptional<z.ZodEnum<["compile", "runtime", "bundle", "hmr", "module"]>>;
    file: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    file?: string | undefined;
    type?: "module" | "bundle" | "hmr" | "runtime" | "compile" | undefined;
}, {
    file?: string | undefined;
    type?: "module" | "bundle" | "hmr" | "runtime" | "compile" | undefined;
    limit?: number | undefined;
}>;
type GetErrorsInput = z.infer<typeof getErrorsInput>;
export declare const vfGetErrors: MCPTool<GetErrorsInput, DevError[]>;
declare const getLogsInput: z.ZodObject<{
    level: z.ZodOptional<z.ZodEnum<["debug", "info", "warn", "error"]>>;
    source: z.ZodOptional<z.ZodString>;
    pattern: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    since: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    level?: "debug" | "info" | "warn" | "error" | undefined;
    pattern?: string | undefined;
    since?: number | undefined;
    source?: string | undefined;
}, {
    level?: "debug" | "info" | "warn" | "error" | undefined;
    limit?: number | undefined;
    pattern?: string | undefined;
    since?: number | undefined;
    source?: string | undefined;
}>;
type GetLogsInput = z.infer<typeof getLogsInput>;
export declare const vfGetLogs: MCPTool<GetLogsInput, LogEntry[]>;
declare const clearCacheInput: z.ZodObject<{
    type: z.ZodDefault<z.ZodOptional<z.ZodEnum<["all", "modules", "mdx"]>>>;
}, "strip", z.ZodTypeAny, {
    type: "mdx" | "all" | "modules";
}, {
    type?: "mdx" | "all" | "modules" | undefined;
}>;
type ClearCacheInput = z.infer<typeof clearCacheInput>;
interface ClearCacheOutput {
    success: boolean;
    cleared: string[];
}
export declare const vfClearCache: MCPTool<ClearCacheInput, ClearCacheOutput>;
declare const getStatusInput: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
type GetStatusInput = z.infer<typeof getStatusInput>;
interface ServerStatus {
    running: boolean;
    url: string;
    port: number;
    errorCount: number;
    warningCount: number;
    logCount: number;
    uptime: number;
}
export declare function createVfGetStatus(env?: RuntimeEnv): MCPTool<GetStatusInput, ServerStatus>;
export declare const vfGetStatus: MCPTool<{}, ServerStatus>;
declare const clearErrorsInput: z.ZodObject<{
    file: z.ZodOptional<z.ZodString>;
    type: z.ZodOptional<z.ZodEnum<["compile", "runtime", "bundle", "hmr", "module"]>>;
}, "strip", z.ZodTypeAny, {
    file?: string | undefined;
    type?: "module" | "bundle" | "hmr" | "runtime" | "compile" | undefined;
}, {
    file?: string | undefined;
    type?: "module" | "bundle" | "hmr" | "runtime" | "compile" | undefined;
}>;
type ClearErrorsInput = z.infer<typeof clearErrorsInput>;
interface ClearErrorsOutput {
    cleared: number;
}
export declare const vfClearErrors: MCPTool<ClearErrorsInput, ClearErrorsOutput>;
export declare const allTools: MCPTool[];
export declare function getTool(name: string): MCPTool | undefined;
export declare function listTools(): Array<{
    name: string;
    description: string;
}>;
export {};
//# sourceMappingURL=tools.d.ts.map