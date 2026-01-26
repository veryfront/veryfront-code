/**
 * Universal Veryfront HTTP handler - Modular Architecture
 *
 * Runtime-agnostic HTTP handler using handler-based architecture
 */
import * as dntShim from "../../../_dnt.shims.js";
import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import type { VeryfrontConfig } from "../../config/index.js";
export { parseProxyEnvironment, type ProxyEnvironment } from "./proxy-environment.js";
export interface UniversalHandlerOptions {
    projectDir: string;
    /** When true, expose additional debug logging. */
    debug?: boolean;
    /** Module server URL for ESM imports (e.g., 'http://localhost:8765') */
    moduleServerUrl?: string;
    /** Pre-loaded config (avoids re-loading via FSAdapter) */
    config?: VeryfrontConfig;
    /** Map of local project slugs to their filesystem paths (for unified dev server) */
    localProjects?: Record<string, string>;
    /** Override environment config for isLocalDev (dev server passes { isLocalDev: true }) */
    envConfig?: import("../context/request-context.js").EnvConfig;
    /** Default project slug when not provided via proxy headers (for tests/local mode) */
    defaultProjectSlug?: string;
    /** Default project ID when not provided via proxy headers (for tests/local mode) */
    defaultProjectId?: string;
    /** Default environment for standalone mode (preview or production). Defaults to preview for safety. */
    defaultEnvironment?: "preview" | "production";
}
/**
 * Create a universal, runtime-agnostic HTTP handler using the provided adapter.
 *
 * This implementation uses a modular handler-based architecture with:
 * - RouteRegistry for managing handlers
 * - Priority-based handler execution
 * - Clean separation of concerns
 * - Easy extensibility
 */
export declare function createVeryfrontHandler(projectDir: string, adapter: RuntimeAdapter, opts?: UniversalHandlerOptions): ((req: dntShim.Request) => Promise<dntShim.Response>) & {
    ready?: Promise<void>;
};
export type { HandlerContext } from "../handlers/types.js";
export { RouteRegistry } from "../../routing/registry/index.js";
export { BaseHandler } from "../handlers/response/base.js";
//# sourceMappingURL=index.d.ts.map