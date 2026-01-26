import type { HMRServerOptions, HMRUpdate } from "./hmr-types.js";
export type { HMRServerOptions, HMRUpdate } from "./hmr-types.js";
/**
 * HMR Server - Orchestrates Hot Module Replacement functionality
 * Manages WebSocket connections, serves runtime script, and broadcasts updates
 */
export declare class HMRServer {
    private options;
    private clients;
    private server?;
    private cachedRuntime?;
    private rateLimiter;
    private readonly maxMessageSize;
    private abortController?;
    constructor(options: HMRServerOptions);
    /**
     * Start the HMR server
     * Sets up HTTP server with WebSocket upgrade and runtime script serving
     */
    start(): Promise<void>;
    /**
     * Stop the HMR server gracefully
     * Closes all WebSocket connections and shuts down the HTTP server
     */
    stop(): Promise<void>;
    /**
     * Send an update to all connected clients
     * @param update - The HMR update to broadcast
     */
    sendUpdate(update: HMRUpdate): void;
    /**
     * Get the number of connected clients
     * @returns The count of active WebSocket connections
     */
    getConnectionCount(): number;
    /**
     * Get the HMR runtime script
     * Uses cached version if available for better performance
     */
    private getHMRRuntime;
    /**
     * Get the React Refresh runtime script
     * Provides React Fast Refresh support for hot reloading
     */
    private getReactRefreshRuntime;
}
//# sourceMappingURL=hmr-server.d.ts.map