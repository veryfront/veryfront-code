import * as dntShim from "../../_dnt.shims.js";
import type { MCPServerConfig } from "./types.js";
type JSONRPCParams = Record<string, unknown> | unknown[];
interface JSONRPCRequest {
    jsonrpc: "2.0";
    id?: string | number;
    method: string;
    params?: JSONRPCParams;
}
interface JSONRPCResponse {
    jsonrpc: "2.0";
    id?: string | number;
    result?: unknown;
    error?: {
        code: number;
        message: string;
        data?: unknown;
    };
}
export declare class MCPServer {
    private config;
    constructor(config: MCPServerConfig);
    handleRequest(request: JSONRPCRequest): Promise<JSONRPCResponse>;
    private dispatch;
    private initialize;
    private listTools;
    private callTool;
    private listResources;
    private readResource;
    private listPrompts;
    private getPrompt;
    createHTTPHandler(): (request: dntShim.Request) => Promise<dntShim.Response>;
    private validateAuth;
    private handleCORS;
    private getCORSHeaders;
}
export declare function createMCPServer(config: MCPServerConfig): MCPServer;
export {};
//# sourceMappingURL=server.d.ts.map