/**
 * Proxy Handler - Core Logic
 *
 * Extracted proxy logic that can be used in:
 * - Split mode: Standalone proxy server (proxy/main.ts)
 * - Combined mode: Request interceptor in renderer process
 *
 * Handles:
 * - Domain parsing (subdomain to project slug)
 * - OAuth token management
 * - Local project detection
 * - User auth token extraction from cookies
 */
import * as dntShim from "../_dnt.shims.js";
import { type ParsedDomain } from "../src/server/utils/domain-parser.js";
import type { TokenCache } from "./cache/types.js";
export interface ProxyConfig {
    apiBaseUrl: string;
    clientId: string;
    clientSecret: string;
    previewClientId: string;
    previewClientSecret: string;
    apiToken?: string;
    localProjects?: Record<string, string>;
}
export interface ProxyContext {
    token?: string;
    projectSlug?: string;
    projectId?: string;
    releaseId?: string;
    branchId?: string;
    branchName?: string;
    environment: "preview" | "production";
    contentSourceId: string;
    localPath?: string;
    host: string;
    parsedDomain: ParsedDomain;
    isLocalProject: boolean;
    /** Error if request cannot be processed (e.g., custom domain not found) */
    error?: {
        status: number;
        message: string;
        redirectUrl?: string;
    };
}
export interface ProxyLogger {
    debug: (msg: string, extra?: Record<string, unknown>) => void;
    info: (msg: string, extra?: Record<string, unknown>) => void;
    warn: (msg: string, extra?: Record<string, unknown>) => void;
    error: (msg: string, error?: Error, extra?: Record<string, unknown>) => void;
}
export interface ProxyHandlerOptions {
    config: ProxyConfig;
    cache?: TokenCache;
    logger?: ProxyLogger;
}
/**
 * Create a proxy handler that processes requests and returns context.
 *
 * This is the core proxy logic, usable in both split and combined modes.
 */
export declare function createProxyHandler(options: ProxyHandlerOptions): {
    processRequest: (req: dntShim.Request) => Promise<ProxyContext>;
    getTokenForApi: (req: dntShim.Request) => Promise<string | undefined>;
    getStats: () => Promise<{
        hits: number;
        misses: number;
        size: number;
        type: string;
    }>;
    close: () => Promise<void>;
    validateConfig: () => string[];
    localProjects: Record<string, string>;
};
export type ProxyHandler = ReturnType<typeof createProxyHandler>;
/**
 * Inject proxy context into request headers for the renderer.
 * Used by both split mode (proxy/main.ts) and combined mode (scripts/server.ts).
 */
export declare function injectContextHeaders(req: dntShim.Request, ctx: ProxyContext): dntShim.Request;
//# sourceMappingURL=handler.d.ts.map