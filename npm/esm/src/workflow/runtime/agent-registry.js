export class DefaultAgentRegistry {
    agents = new Map();
    registerAgent(agent) {
        this.agents.set(agent.id, agent);
    }
    registerAgents(agents) {
        for (const agent of agents)
            this.registerAgent(agent);
    }
    get(id) {
        return this.agents.get(id);
    }
    hasAgent(id) {
        return this.agents.has(id);
    }
    listAgentIds() {
        return [...this.agents.keys()];
    }
    removeAgent(id) {
        return this.agents.delete(id);
    }
    clear() {
        this.agents.clear();
    }
}
export class DefaultToolRegistry {
    tools = new Map();
    registerTool(tool) {
        this.tools.set(tool.id, tool);
    }
    registerTools(tools) {
        for (const tool of tools)
            this.registerTool(tool);
    }
    get(name) {
        return this.tools.get(name);
    }
    hasTool(name) {
        return this.tools.has(name);
    }
    listToolNames() {
        return [...this.tools.keys()];
    }
    removeTool(name) {
        return this.tools.delete(name);
    }
    clear() {
        this.tools.clear();
    }
}
export function createMockAgent(id, options = {}) {
    return {
        id,
        config: {
            model: "mock/test-model",
            system: "Mock agent for testing",
        },
        async generate(input) {
            const inputStr = typeof input.input === "string" ? input.input : JSON.stringify(input.input);
            const text = options.responseFunc
                ? await options.responseFunc(inputStr)
                : (options.response ?? `Mock response for: ${inputStr.slice(0, 50)}...`);
            const now = Date.now();
            return {
                text,
                messages: [
                    {
                        id: `msg_${now}_0`,
                        role: "user",
                        parts: [{ type: "text", text: inputStr }],
                    },
                    {
                        id: `msg_${now}_1`,
                        role: "assistant",
                        parts: [{ type: "text", text }],
                    },
                ],
                toolCalls: options.toolCalls?.map((tc) => ({ ...tc, status: "completed" })) ?? [],
                status: "completed",
                usage: {
                    promptTokens: 100,
                    completionTokens: 50,
                    totalTokens: 150,
                },
            };
        },
        stream() {
            throw new Error("Mock agent does not support streaming");
        },
        respond() {
            throw new Error("Mock agent does not support HTTP responses");
        },
        getMemory() {
            throw new Error("Mock agent does not have memory");
        },
        getMemoryStats() {
            return Promise.resolve({
                totalMessages: 0,
                estimatedTokens: 0,
                type: "mock",
            });
        },
        async clearMemory() { },
    };
}
export function createMockTool(id, options = {}) {
    const mockSchema = { parse: (x) => x };
    return {
        id,
        type: "function",
        description: options.description ?? `Mock tool: ${id}`,
        inputSchema: mockSchema,
        async execute(args) {
            if (options.executeFunc)
                return await options.executeFunc(args);
            return options.result ?? { success: true, tool: id, args };
        },
    };
}
