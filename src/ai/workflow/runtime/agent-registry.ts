/**
 * Agent Registry
 *
 * Registry for managing and looking up agents in workflow execution
 */

import type { Agent } from "../../types/agent.ts";
import type { Tool } from "../../types/tool.ts";
import type { AgentRegistry, ToolRegistry } from "../executor/step-executor.ts";

/**
 * Default agent registry implementation
 *
 * Provides in-memory storage for agents that can be used in workflow steps.
 *
 * @example
 * ```typescript
 * import { DefaultAgentRegistry } from 'veryfront/ai/workflow/runtime/agent-registry';
 *
 * const registry = new DefaultAgentRegistry();
 *
 * // Register agents
 * registry.registerAgent(researchAgent);
 * registry.registerAgent(writerAgent);
 *
 * // Use with workflow client
 * const client = createWorkflowClient({
 *   executor: {
 *     agentRegistry: registry,
 *   },
 * });
 * ```
 */
export class DefaultAgentRegistry implements AgentRegistry {
  private agents = new Map<string, Agent>();

  /**
   * Register an agent
   */
  registerAgent(agent: Agent): void {
    this.agents.set(agent.id, agent);
  }

  /**
   * Register multiple agents
   */
  registerAgents(agents: Agent[]): void {
    for (const agent of agents) {
      this.registerAgent(agent);
    }
  }

  /**
   * Get an agent by ID (implements AgentRegistry.get)
   */
  get(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  /**
   * Check if an agent exists
   */
  hasAgent(id: string): boolean {
    return this.agents.has(id);
  }

  /**
   * List all registered agent IDs
   */
  listAgentIds(): string[] {
    return Array.from(this.agents.keys());
  }

  /**
   * Remove an agent
   */
  removeAgent(id: string): boolean {
    return this.agents.delete(id);
  }

  /**
   * Clear all registrations
   */
  clear(): void {
    this.agents.clear();
  }
}

/**
 * Default tool registry implementation
 *
 * Provides in-memory storage for tools that can be used in workflow steps.
 */
export class DefaultToolRegistry implements ToolRegistry {
  private tools = new Map<string, Tool>();

  /**
   * Register a tool
   */
  registerTool(tool: Tool): void {
    this.tools.set(tool.id, tool);
  }

  /**
   * Register multiple tools
   */
  registerTools(tools: Tool[]): void {
    for (const tool of tools) {
      this.registerTool(tool);
    }
  }

  /**
   * Get a tool by name (implements ToolRegistry.get)
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool exists
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * List all registered tool names
   */
  listToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Remove a tool
   */
  removeTool(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Clear all tools
   */
  clear(): void {
    this.tools.clear();
  }
}

/**
 * Create a mock agent for testing
 *
 * Creates an agent that returns a predictable response without
 * making actual API calls.
 *
 * @example
 * ```typescript
 * const mockAgent = createMockAgent('test-agent', {
 *   response: 'This is the mock response',
 * });
 *
 * registry.registerAgent(mockAgent);
 * ```
 */
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

      let text: string;
      if (options.responseFunc) {
        text = await options.responseFunc(inputStr);
      } else {
        text = options.response ?? `Mock response for: ${inputStr.slice(0, 50)}...`;
      }

      return {
        text,
        messages: [
          { role: "user" as const, content: inputStr },
          { role: "assistant" as const, content: text },
        ],
        toolCalls: options.toolCalls?.map((tc) => ({
          ...tc,
          status: "completed" as const,
        })) ?? [],
        status: "completed" as const,
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
    async clearMemory() {
      // No-op
    },
  };
}

/**
 * Create a mock tool for testing
 *
 * @example
 * ```typescript
 * const mockTool = createMockTool('fetchData', {
 *   result: { data: 'test' },
 * });
 *
 * registry.registerTool(mockTool);
 * ```
 */
export function createMockTool(
  id: string,
  options: {
    description?: string;
    result?: unknown;
    executeFunc?: (
      args: Record<string, unknown>,
    ) => unknown | Promise<unknown>;
  } = {},
): Tool {
  // Import z dynamically to avoid bundling issues
  const mockSchema = { parse: (x: unknown) => x } as unknown as import("zod").z.ZodSchema;

  return {
    id,
    description: options.description ?? `Mock tool: ${id}`,
    inputSchema: mockSchema,
    async execute(args: Record<string, unknown>) {
      if (options.executeFunc) {
        return await options.executeFunc(args);
      }
      return options.result ?? { success: true, tool: id, args };
    },
  };
}
