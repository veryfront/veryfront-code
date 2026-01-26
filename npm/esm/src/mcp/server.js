import * as dntShim from "../../_dnt.shims.js";
import { getMCPRegistry } from "./registry.js";
import { executeTool, zodToJsonSchema } from "../tool/index.js";
import { resourceRegistry } from "../resource/index.js";
import { promptRegistry } from "../prompt/index.js";
import { createError, toError } from "../errors/veryfront-error.js";
import { withSpan } from "../observability/tracing/otlp-setup.js";
function asParamsRecord(params) {
    if (!params || Array.isArray(params))
        return {};
    return params;
}
export class MCPServer {
    config;
    constructor(config) {
        this.config = config;
    }
    handleRequest(request) {
        return withSpan("mcp.handleRequest", async () => {
            try {
                const result = await this.dispatch(request.method, request.params);
                return { jsonrpc: "2.0", id: request.id, result };
            }
            catch (error) {
                return {
                    jsonrpc: "2.0",
                    id: request.id,
                    error: {
                        code: -32603,
                        message: error instanceof Error ? error.message : String(error),
                    },
                };
            }
        }, { "mcp.method": request.method });
    }
    dispatch(method, params) {
        switch (method) {
            case "tools/list":
                return this.listTools();
            case "tools/call":
                return this.callTool(params);
            case "resources/list":
                return this.listResources();
            case "resources/read":
                return this.readResource(params);
            case "prompts/list":
                return this.listPrompts();
            case "prompts/get":
                return this.getPrompt(params);
            case "initialize":
                return this.initialize(params);
            default:
                throw toError(createError({
                    type: "agent",
                    message: `Unknown method: ${method}`,
                }));
        }
    }
    initialize(_params) {
        return Promise.resolve({
            protocolVersion: "2024-11-05",
            serverInfo: { name: "veryfront-mcp", version: "0.1.0" },
            capabilities: {
                tools: {},
                resources: { subscribe: true },
                prompts: {},
            },
        });
    }
    listTools() {
        const registry = getMCPRegistry();
        const tools = [];
        for (const [id, tool] of registry.tools.entries()) {
            if (tool.mcp?.enabled === false)
                continue;
            const inputSchema = tool.inputSchemaJson ?? zodToJsonSchema(tool.inputSchema);
            tools.push({
                name: id,
                description: tool.description,
                inputSchema,
            });
        }
        return Promise.resolve({ tools });
    }
    callTool(params) {
        const { name, arguments: args } = asParamsRecord(params);
        if (!name) {
            throw toError(createError({
                type: "agent",
                message: "Tool name is required",
            }));
        }
        const toolName = String(name);
        return withSpan("mcp.callTool", async () => {
            const result = await executeTool(toolName, args);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        }, { "mcp.tool.name": toolName });
    }
    listResources() {
        const registry = getMCPRegistry();
        const resources = [];
        for (const [id, resource] of registry.resources.entries()) {
            resources.push({
                uri: resource.pattern,
                name: id,
                description: resource.description,
                mimeType: "application/json",
            });
        }
        return Promise.resolve({ resources });
    }
    readResource(params) {
        const { uri } = asParamsRecord(params);
        if (!uri) {
            throw toError(createError({
                type: "agent",
                message: "Resource URI is required",
            }));
        }
        const resourceUri = String(uri);
        return withSpan("mcp.readResource", async () => {
            const resource = resourceRegistry.findByPattern(resourceUri);
            if (!resource) {
                throw toError(createError({
                    type: "agent",
                    message: `Resource not found: ${resourceUri}`,
                }));
            }
            const resourceParams = resourceRegistry.extractParams(resourceUri, resource.pattern);
            const data = await resource.load(resourceParams);
            return {
                contents: [
                    {
                        uri: resourceUri,
                        mimeType: "application/json",
                        text: JSON.stringify(data, null, 2),
                    },
                ],
            };
        }, { "mcp.resource.uri": resourceUri });
    }
    listPrompts() {
        const registry = getMCPRegistry();
        const prompts = [];
        for (const [id, promptInstance] of registry.prompts.entries()) {
            prompts.push({
                name: id,
                description: promptInstance.description,
            });
        }
        return Promise.resolve({ prompts });
    }
    getPrompt(params) {
        const { name, arguments: args } = asParamsRecord(params);
        if (!name) {
            throw toError(createError({
                type: "agent",
                message: "Prompt name is required",
            }));
        }
        const promptName = String(name);
        return withSpan("mcp.getPrompt", async () => {
            const content = await promptRegistry.getContent(promptName, args);
            return {
                description: `Prompt: ${promptName}`,
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: content,
                        },
                    },
                ],
            };
        }, { "mcp.prompt.name": promptName });
    }
    createHTTPHandler() {
        return async (request) => {
            if (request.method === "OPTIONS")
                return this.handleCORS();
            if (this.config.auth?.type && this.config.auth.type !== "none") {
                const authorized = await this.validateAuth(request);
                if (!authorized)
                    return new dntShim.Response("Unauthorized", { status: 401 });
            }
            try {
                const rpcRequest = await request.json();
                const rpcResponse = await this.handleRequest(rpcRequest);
                return new dntShim.Response(JSON.stringify(rpcResponse), {
                    headers: {
                        "Content-Type": "application/json",
                        ...this.getCORSHeaders(),
                    },
                });
            }
            catch {
                return new dntShim.Response(JSON.stringify({
                    jsonrpc: "2.0",
                    error: { code: -32700, message: "Parse error" },
                }), {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                });
            }
        };
    }
    async validateAuth(request) {
        if (!this.config.auth || this.config.auth.type === "none")
            return true;
        const authHeader = request.headers.get("Authorization");
        if (!authHeader)
            return false;
        if (this.config.auth.type !== "bearer")
            return false;
        const token = authHeader.replace("Bearer ", "");
        if (!this.config.auth.validate)
            return false;
        return await this.config.auth.validate(token);
    }
    handleCORS() {
        return new dntShim.Response(null, { status: 204, headers: this.getCORSHeaders() });
    }
    getCORSHeaders() {
        if (!this.config.cors?.enabled)
            return {};
        const origins = this.config.cors.origins ?? ["*"];
        return {
            "Access-Control-Allow-Origin": origins[0] ?? "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        };
    }
}
export function createMCPServer(config) {
    return new MCPServer(config);
}
