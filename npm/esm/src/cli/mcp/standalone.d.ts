/**
 * Standalone MCP Server
 *
 * Runs as a separate process (`veryfront mcp`), communicates over stdio.
 * Pulls runtime data from the dev server's Dashboard API over HTTP.
 * Falls back gracefully when the dev server is not running.
 */
export interface StandaloneMCPConfig {
    port?: number;
}
export declare class StandaloneMCPServer {
    private client;
    private tools;
    private running;
    private stdinReader;
    constructor(config?: StandaloneMCPConfig);
    start(): void;
    stop(): void;
    private startStdio;
    private handleRequest;
    private dispatchMethod;
    private handleToolsCall;
    private handlePromptsList;
    private handlePromptsGet;
    private createTools;
}
export declare function createStandaloneMCPServer(config?: StandaloneMCPConfig): StandaloneMCPServer;
//# sourceMappingURL=standalone.d.ts.map