import type { RuntimeAdapter } from "../platform/adapters/base.js";
interface ServerOptions {
    projectDir: string;
    port: number;
    /** 0.0.0.0 = all interfaces, 127.0.0.1 = localhost only */
    bindAddress?: string;
    signal?: AbortSignal;
    /** Server mode - "development" enables dev-only features like /_veryfront/fs/ */
    mode?: "development" | "production";
    /** Default project slug when not provided via proxy headers (for tests/local mode) */
    defaultProjectSlug?: string;
    /** Default project ID when not provided via proxy headers (for tests/local mode) */
    defaultProjectId?: string;
    /** Default environment for standalone mode (preview or production). Defaults to preview for safety. */
    defaultEnvironment?: "preview" | "production";
}
export interface ServerHandle {
    ready: Promise<void>;
    stop: () => Promise<void>;
}
export declare function startUniversalServer(options: ServerOptions & {
    debug?: boolean;
    adapter?: RuntimeAdapter;
}): Promise<ServerHandle>;
export declare function startProductionServer(options: ServerOptions): Promise<ServerHandle>;
export {};
//# sourceMappingURL=production-server.d.ts.map