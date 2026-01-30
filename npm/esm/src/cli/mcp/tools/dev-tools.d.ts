import { z } from "zod";
import type { MCPTool } from "../tools.js";
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
export {};
//# sourceMappingURL=dev-tools.d.ts.map