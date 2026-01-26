/**
 * MCP Dev Server
 *
 * Exposes dev server functionality via MCP (Model Context Protocol).
 * Supports both stdio transport (for local editors like Claude Code)
 * and HTTP transport (for remote access).
 */
import * as dntShim from "../../../_dnt.shims.js";
import { readTextFile } from "../../platform/compat/fs.js";
import { createHttpServer } from "../../platform/compat/http/index.js";
import { cwd, writeStdoutAsync } from "../../platform/compat/process.js";
import { getStdinReader } from "../../platform/compat/stdin.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";
import { createIssuesManager } from "../../issues/core.js";
import { getErrorCollector } from "./error-collector.js";
import { getLogBuffer } from "./log-buffer.js";
import { allTools, getTool, setServerStartTime } from "./tools.js";
// ============================================================================
// MCP Server
// ============================================================================
export class MCPDevServer {
    config;
    running = false;
    stdinReader = null;
    httpServer = null;
    constructor(config = {}) {
        this.config = {
            serverName: "veryfront-dev",
            serverVersion: "1.0.0",
            ...config,
        };
        // Set server start time for status tool
        setServerStartTime(Date.now());
    }
    start() {
        if (this.running)
            return;
        this.running = true;
        if (this.config.stdio)
            this.startStdio();
        if (this.config.httpPort)
            this.startHTTP(this.config.httpPort);
    }
    async stop() {
        this.running = false;
        this.stdinReader?.releaseLock();
        this.stdinReader = null;
        if (this.httpServer) {
            await this.httpServer.close();
            this.httpServer = null;
        }
    }
    startStdio() {
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        this.stdinReader = getStdinReader();
        const readLoop = async () => {
            let buffer = "";
            while (this.running) {
                try {
                    const { value, done } = await this.stdinReader.read();
                    if (done)
                        break;
                    if (!value)
                        continue;
                    buffer += decoder.decode(value, { stream: true });
                    let newlineIndex = buffer.indexOf("\n");
                    while (newlineIndex !== -1) {
                        const line = buffer.slice(0, newlineIndex).trim();
                        buffer = buffer.slice(newlineIndex + 1);
                        newlineIndex = buffer.indexOf("\n");
                        if (!line)
                            continue;
                        try {
                            const request = JSON.parse(line);
                            const response = await this.handleRequest(request);
                            await writeStdoutAsync(encoder.encode(`${JSON.stringify(response)}\n`));
                        }
                        catch (e) {
                            const errorResponse = {
                                jsonrpc: "2.0",
                                error: {
                                    code: -32700,
                                    message: "Parse error",
                                    data: e instanceof Error ? e.message : String(e),
                                },
                            };
                            await writeStdoutAsync(encoder.encode(`${JSON.stringify(errorResponse)}\n`));
                        }
                    }
                }
                catch {
                    break;
                }
            }
        };
        void readLoop();
    }
    startHTTP(port) {
        this.httpServer = createHttpServer();
        const handler = async (req) => {
            const url = new URL(req.url);
            // CORS headers - allow localhost and veryfront dev domains
            const origin = req.headers.get("Origin") ?? "";
            const isAllowedOrigin = origin === "" ||
                origin.startsWith("http://localhost") ||
                origin.startsWith("http://127.0.0.1") ||
                origin.startsWith("http://lvh.me") ||
                origin.startsWith("http://veryfront.me");
            const headers = {
                "Content-Type": "application/json",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Accept, mcp-protocol-version, mcp-session-id",
            };
            if (isAllowedOrigin && origin)
                headers["Access-Control-Allow-Origin"] = origin;
            if (req.method === "OPTIONS")
                return new dntShim.Response(null, { status: 204, headers });
            if (url.pathname !== "/mcp") {
                return new dntShim.Response(JSON.stringify({ error: "Not found. MCP endpoint is at /mcp" }), {
                    status: 404,
                    headers,
                });
            }
            if (req.method !== "POST") {
                return new dntShim.Response(JSON.stringify({ error: "Method not allowed" }), {
                    status: 405,
                    headers,
                });
            }
            try {
                const body = (await req.json());
                const response = await this.handleRequest(body);
                return new dntShim.Response(JSON.stringify(response), { headers });
            }
            catch (e) {
                const errorResponse = {
                    jsonrpc: "2.0",
                    error: {
                        code: -32700,
                        message: "Parse error",
                        data: e instanceof Error ? e.message : String(e),
                    },
                };
                return new dntShim.Response(JSON.stringify(errorResponse), { status: 400, headers });
            }
        };
        this.httpServer.serve(handler, { port, onListen: () => { } });
    }
    handleRequest(request) {
        const { id, method, params } = request;
        return withSpan("cli.mcp.handleRequest", async () => {
            try {
                const result = await this.dispatchMethod(method, params);
                return { jsonrpc: "2.0", id, result };
            }
            catch (e) {
                return {
                    jsonrpc: "2.0",
                    id,
                    error: {
                        code: -32603,
                        message: e instanceof Error ? e.message : String(e),
                    },
                };
            }
        }, { "mcp.method": method });
    }
    dispatchMethod(method, params) {
        switch (method) {
            case "initialize":
                return Promise.resolve(this.handleInitialize(params));
            case "tools/list":
                return Promise.resolve(this.handleToolsList());
            case "tools/call":
                return this.handleToolsCall(params);
            case "resources/list":
                return Promise.resolve(this.handleResourcesList());
            case "resources/read":
                return this.handleResourcesRead(params);
            case "prompts/list":
                return Promise.resolve(this.handlePromptsList());
            case "prompts/get":
                return this.handlePromptsGet(params);
            default:
                return Promise.reject(new Error(`Unknown method: ${method}`));
        }
    }
    handleInitialize(_params) {
        return {
            protocolVersion: "2024-11-05",
            capabilities: {
                tools: {},
                resources: {},
                prompts: {},
            },
            serverInfo: {
                name: this.config.serverName,
                version: this.config.serverVersion,
            },
        };
    }
    handleToolsList() {
        return {
            tools: allTools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                inputSchema: this.zodToJsonSchema(tool.inputSchema),
            })),
        };
    }
    handleToolsCall(params) {
        const { name, arguments: args } = params;
        return withSpan("cli.mcp.handleToolsCall", async () => {
            const tool = getTool(name);
            if (!tool)
                throw new Error(`Unknown tool: ${name}`);
            const input = tool.inputSchema.parse(args ?? {});
            const result = await tool.execute(input);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        }, { "mcp.tool.name": name });
    }
    handleResourcesList() {
        return {
            resources: [
                {
                    uri: "veryfront://skill",
                    name: "Veryfront Skill",
                    description: "How to build Veryfront apps - conventions, patterns, workflows",
                    mimeType: "text/markdown",
                },
                {
                    uri: "veryfront://errors",
                    name: "Dev Server Errors",
                    description: "Current compilation and runtime errors",
                    mimeType: "application/json",
                },
                {
                    uri: "veryfront://logs",
                    name: "Dev Server Logs",
                    description: "Recent server logs",
                    mimeType: "application/json",
                },
                {
                    uri: "issues://",
                    name: "Project Issues",
                    description: "File-based issues, tasks, and plans",
                    mimeType: "application/json",
                },
            ],
        };
    }
    handleResourcesRead(params) {
        const { uri } = params;
        return withSpan("cli.mcp.handleResourcesRead", async () => {
            if (uri === "veryfront://skill") {
                try {
                    const skillPath = new URL("./skills/veryfront/SKILL.md", globalThis[Symbol.for("import-meta-ponyfill-esmodule")](import.meta).url).pathname;
                    const content = await readTextFile(skillPath);
                    return {
                        contents: [
                            {
                                uri,
                                mimeType: "text/markdown",
                                text: content,
                            },
                        ],
                    };
                }
                catch {
                    throw new Error("Skill file not found");
                }
            }
            if (uri === "veryfront://errors") {
                const errors = getErrorCollector().getAll();
                return {
                    contents: [
                        {
                            uri,
                            mimeType: "application/json",
                            text: JSON.stringify(errors, null, 2),
                        },
                    ],
                };
            }
            if (uri === "veryfront://logs") {
                const logs = getLogBuffer().tail(100);
                return {
                    contents: [
                        {
                            uri,
                            mimeType: "application/json",
                            text: JSON.stringify(logs, null, 2),
                        },
                    ],
                };
            }
            if (uri.startsWith("issues://")) {
                const manager = createIssuesManager(cwd());
                if (uri === "issues://") {
                    const result = await manager.list({ state: "open" });
                    return {
                        contents: [
                            {
                                uri,
                                mimeType: "application/json",
                                text: JSON.stringify(result, null, 2),
                            },
                        ],
                    };
                }
                const id = uri.slice("issues://".length);
                const issue = await manager.get(id);
                if (!issue)
                    throw new Error(`Issue not found: ${id}`);
                return {
                    contents: [
                        {
                            uri,
                            mimeType: "application/json",
                            text: JSON.stringify(issue, null, 2),
                        },
                    ],
                };
            }
            throw new Error(`Unknown resource: ${uri}`);
        }, { "mcp.resource.uri": uri });
    }
    handlePromptsList() {
        return {
            prompts: [
                {
                    name: "veryfront",
                    description: "Build Veryfront apps - conventions, patterns, workflows, scaffolding",
                    arguments: [],
                },
                {
                    name: "veryfront-routing",
                    description: "Veryfront routing conventions and file-based routing patterns",
                    arguments: [],
                },
                {
                    name: "veryfront-ai-tools",
                    description: "AI tool patterns for Veryfront agents",
                    arguments: [],
                },
                {
                    name: "veryfront-components",
                    description: "Component patterns and best practices for Veryfront",
                    arguments: [],
                },
                {
                    name: "flywheel",
                    description: "Development flywheel - autonomous run/observe/fix/verify cycle with browser automation",
                    arguments: [],
                },
            ],
        };
    }
    handlePromptsGet(params) {
        const { name } = params;
        return withSpan("cli.mcp.handlePromptsGet", async () => {
            const promptFiles = {
                veryfront: "./skills/veryfront/SKILL.md",
                "veryfront-routing": "./skills/veryfront/references/ROUTES.md",
                "veryfront-ai-tools": "./skills/veryfront/references/AI-TOOLS.md",
                "veryfront-components": "./skills/veryfront/references/COMPONENTS.md",
                flywheel: "./skills/flywheel/SKILL.md",
            };
            const filePath = promptFiles[name];
            if (!filePath)
                throw new Error(`Unknown prompt: ${name}`);
            try {
                const fullPath = new URL(filePath, globalThis[Symbol.for("import-meta-ponyfill-esmodule")](import.meta).url).pathname;
                const content = await readTextFile(fullPath);
                return {
                    description: `Veryfront skill: ${name}`,
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
            }
            catch {
                throw new Error(`Failed to read prompt: ${name}`);
            }
        }, { "mcp.prompt.name": name });
    }
    zodToJsonSchema(schema) {
        // deno-lint-ignore no-explicit-any
        const zodSchema = schema;
        if (!zodSchema?._def)
            return { type: "object", properties: {} };
        const def = zodSchema._def;
        const typeName = def.typeName;
        if (typeName === "ZodObject") {
            const shape = def.shape?.() ?? {};
            const properties = {};
            const required = [];
            for (const [key, value] of Object.entries(shape)) {
                // deno-lint-ignore no-explicit-any
                const fieldDef = value?._def;
                const fieldSchema = this.zodToJsonSchema(value);
                if (fieldDef?.description) {
                    // deno-lint-ignore no-explicit-any
                    fieldSchema.description = fieldDef.description;
                }
                properties[key] = fieldSchema;
                if (fieldDef?.typeName !== "ZodOptional" && fieldDef?.typeName !== "ZodDefault") {
                    required.push(key);
                }
            }
            return {
                type: "object",
                properties,
                ...(required.length ? { required } : {}),
            };
        }
        if (typeName === "ZodString") {
            return { type: "string", ...(def.description ? { description: def.description } : {}) };
        }
        if (typeName === "ZodNumber") {
            return { type: "number", ...(def.description ? { description: def.description } : {}) };
        }
        if (typeName === "ZodBoolean") {
            return { type: "boolean", ...(def.description ? { description: def.description } : {}) };
        }
        if (typeName === "ZodArray") {
            return {
                type: "array",
                items: this.zodToJsonSchema(def.type),
                ...(def.description ? { description: def.description } : {}),
            };
        }
        if (typeName === "ZodEnum") {
            return {
                type: "string",
                enum: def.values,
                ...(def.description ? { description: def.description } : {}),
            };
        }
        if (typeName === "ZodOptional")
            return this.zodToJsonSchema(def.innerType);
        if (typeName === "ZodDefault") {
            const innerSchema = this.zodToJsonSchema(def.innerType);
            // deno-lint-ignore no-explicit-any
            innerSchema.default = def.defaultValue?.();
            return innerSchema;
        }
        return { type: "object" };
    }
}
// ============================================================================
// Factory
// ============================================================================
export function createMCPServer(config) {
    const server = new MCPDevServer(config);
    server.start();
    return server;
}
// ============================================================================
// Index Exports
// ============================================================================
export * from "./error-collector.js";
export * from "./log-buffer.js";
export * from "./tools.js";
