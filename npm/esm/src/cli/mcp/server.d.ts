export interface MCPServerConfig {
    /** Enable stdio transport (for Claude Code, Cursor, etc.) */
    stdio?: boolean;
    /** HTTP port for remote MCP access */
    httpPort?: number;
    /** Server name for MCP protocol */
    serverName?: string;
    /** Server version */
    serverVersion?: string;
}
export declare class MCPDevServer {
    private config;
    private running;
    private stdinReader;
    private httpServer;
    constructor(config?: MCPServerConfig);
    start(): void;
    stop(): Promise<void>;
    private startStdio;
    private startHTTP;
    private handleRequest;
    private dispatchMethod;
    private handleInitialize;
    private handleToolsList;
    private handleToolsCall;
    private handleResourcesList;
    private handleResourcesRead;
    private handlePromptsList;
    private handlePromptsGet;
    private zodToJsonSchema;
}
export declare function createMCPServer(config: MCPServerConfig): MCPDevServer;
export * from "./error-collector.js";
export * from "./log-buffer.js";
export * from "./tools.js";
//# sourceMappingURL=server.d.ts.map