import type { Agent } from "#veryfront/agent";
import type { Tool } from "#veryfront/tool";
import type { AgentRegistry, ToolRegistry } from "../executor/step-executor.ts";

export class DefaultAgentRegistry implements AgentRegistry {
  private agents = new Map<string, Agent>();

  registerAgent(agent: Agent): void {
    this.agents.set(agent.id, agent);
  }

  registerAgents(agents: Agent[]): void {
    for (const agent of agents) this.registerAgent(agent);
  }

  get(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  hasAgent(id: string): boolean {
    return this.agents.has(id);
  }

  listAgentIds(): string[] {
    return [...this.agents.keys()];
  }

  removeAgent(id: string): boolean {
    return this.agents.delete(id);
  }

  clear(): void {
    this.agents.clear();
  }
}

export class DefaultToolRegistry implements ToolRegistry {
  private tools = new Map<string, Tool>();

  registerTool(tool: Tool): void {
    this.tools.set(tool.id, tool);
  }

  registerTools(tools: Tool[]): void {
    for (const tool of tools) this.registerTool(tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  listToolNames(): string[] {
    return [...this.tools.keys()];
  }

  removeTool(name: string): boolean {
    return this.tools.delete(name);
  }

  clear(): void {
    this.tools.clear();
  }
}

export function createMockAgent(
  id: string,
  options: {
    response?: string;
    responseFunc?: (input: string) => string | Promise<string>;
    toolCalls?: Array<{
      id: string;
      name: string;
      args: Record<string, unknown>;
    }>;
  } = {},
): Agent {
  return {
    id,
    config: {
      model: "mock/test-model",
      system: "Mock agent for testing",
    },
    async generate(input: { input: string | unknown[]; context?: Record<string, unknown> }) {
      const inputStr = typeof input.input === "string" ? input.input : JSON.stringify(input.input);

      const text = options.responseFunc
        ? await options.responseFunc(inputStr)
        : options.response ?? `Mock response for: ${inputStr.slice(0, 50)}...`;

      const now = Date.now();

      return {
        text,
        messages: [
          {
            id: `msg_${now}_0`,
            role: "user" as const,
            parts: [{ type: "text" as const, text: inputStr }],
          },
          {
            id: `msg_${now}_1`,
            role: "assistant" as const,
            parts: [{ type: "text" as const, text }],
          },
        ],
        toolCalls: options.toolCalls?.map((tc) => ({ ...tc, status: "completed" as const })) ?? [],
        status: "completed" as const,
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
      };
    },
    stream(): never {
      throw new Error("Mock agent does not support streaming");
    },
    respond(): never {
      throw new Error("Mock agent does not support HTTP responses");
    },
    getMemory(): never {
      throw new Error("Mock agent does not have memory");
    },
    getMemoryStats() {
      return Promise.resolve({
        totalMessages: 0,
        estimatedTokens: 0,
        type: "mock",
      });
    },
    async clearMemory() {},
  };
}

export function createMockTool(
  id: string,
  options: {
    description?: string;
    result?: unknown;
    executeFunc?: (args: Record<string, unknown>) => unknown | Promise<unknown>;
  } = {},
): Tool {
  const mockSchema = { parse: (x: unknown) => x } as import("zod").z.ZodSchema;

  return {
    id,
    type: "function" as const,
    description: options.description ?? `Mock tool: ${id}`,
    inputSchema: mockSchema,
    async execute(args: Record<string, unknown>) {
      if (options.executeFunc) return options.executeFunc(args);
      return options.result ?? { success: true, tool: id, args };
    },
  };
}
