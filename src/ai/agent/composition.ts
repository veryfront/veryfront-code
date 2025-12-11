/**
 * Agent Composition Utilities
 *
 * Enables agents to orchestrate other agents for complex workflows
 */

import type { Agent } from "../types/agent.ts";
import type { Tool } from "../types/tool.ts";
import { z } from "zod";
import { agentLogger } from "../../core/utils/logger/logger.ts";

/**
 * Convert an agent to a tool that can be called by other agents
 *
 * @example
 * ```typescript
 * import { agent, agentAsTool } from 'veryfront/ai';
 *
 * const researchAgent = agent({
 *   model: 'gpt-4',
 *   system: 'You are a research assistant',
 * });
 *
 * const writerAgent = agent({
 *   model: 'gpt-4',
 *   system: 'You are a content writer',
 * });
 *
 * const orchestrator = agent({
 *   model: 'gpt-4',
 *   system: 'You coordinate research and writing',
 *   tools: {
 *     research: agentAsTool(researchAgent, 'Research a topic'),
 *     write: agentAsTool(writerAgent, 'Write content'),
 *   },
 * });
 * ```
 */
export function agentAsTool(
  agent: Agent,
  description: string,
): Tool {
  return {
    id: `agent_${agent.id}`,
    type: "function",
    description,
    inputSchema: z.object({
      input: z.string().describe("Input for the agent"),
    }),
    async execute({ input }) {
      const response = await agent.generate({ input });
      return {
        text: response.text,
        toolCalls: response.toolCalls.length,
        status: response.status,
      };
    },
  };
}

/**
 * Create a multi-agent workflow
 *
 * @example
 * ```typescript
 * import { createWorkflow } from 'veryfront/ai';
 *
 * const workflow = createWorkflow({
 *   steps: [
 *     { agent: researchAgent, name: 'research' },
 *     { agent: writerAgent, name: 'write' },
 *     { agent: editorAgent, name: 'edit' },
 *   ],
 * });
 *
 * const result = await workflow.execute('Write about AI');
 * ```
 */
export interface WorkflowStep {
  /** Agent to execute */
  agent: Agent;

  /** Step name */
  name: string;

  /** Transform output before passing to next step */
  transform?: (output: string) => string | Promise<string>;

  /** Condition to skip this step */
  skip?: (context: Record<string, unknown>) => boolean | Promise<boolean>;
}

export interface WorkflowConfig {
  /** Workflow steps */
  steps: WorkflowStep[];

  /** Initial context */
  initialContext?: Record<string, unknown>;
}

export interface WorkflowResult {
  /** Final output */
  output: string;

  /** Results from each step */
  steps: Array<{
    name: string;
    output: string;
    skipped: boolean;
  }>;

  /** Combined context */
  context: Record<string, unknown>;
}

/**
 * Create a multi-agent workflow
 */
export function createWorkflow(config: WorkflowConfig) {
  return {
    async execute(input: string): Promise<WorkflowResult> {
      const result: WorkflowResult = {
        output: input,
        steps: [],
        context: { ...config.initialContext },
      };

      for (const step of config.steps) {
        // Check if step should be skipped
        if (step.skip && (await step.skip(result.context))) {
          result.steps.push({
            name: step.name,
            output: "",
            skipped: true,
          });
          continue;
        }

        // Execute agent
        const response = await step.agent.generate({
          input: result.output,
          context: result.context,
        });

        // Transform output if needed
        let output = response.text;
        if (step.transform) {
          output = await step.transform(output);
        }

        // Update result
        result.output = output;
        result.steps.push({
          name: step.name,
          output,
          skipped: false,
        });

        // Update context
        result.context[step.name] = output;
      }

      return result;
    },
  };
}

/**
 * Agent registry for composition and multi-agent workflows
 *
 * Note: This registry is primarily used for agent-to-agent orchestration.
 * For API routes, agents should be imported directly to ensure they are
 * bundled with the route and available at runtime.
 */
class AgentRegistryClass {
  private agents = new Map<string, Agent>();

  /**
   * Register an agent
   */
  register(id: string, agent: Agent): void {
    if (this.agents.has(id)) {
      // Debug level - overwriting is expected during hot reload and re-discovery
      agentLogger.debug(`Agent "${id}" is already registered. Overwriting.`);
    }
    this.agents.set(id, agent);
    agentLogger.debug(`Registered agent: ${id}`);
  }

  /**
   * Get an agent by ID
   */
  get(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  /**
   * Check if an agent exists
   */
  has(id: string): boolean {
    return this.agents.has(id);
  }

  /**
   * Get all agent IDs
   */
  getAllIds(): string[] {
    return Array.from(this.agents.keys());
  }

  /**
   * Get all agents as a Map
   */
  getAll(): Map<string, Agent> {
    return new Map(this.agents);
  }

  /**
   * Clear all agents (for testing)
   */
  clear(): void {
    this.agents.clear();
  }
}

// Singleton instance using globalThis to share across module contexts
// This is necessary for esbuild-bundled API routes to access the same registry
const AGENT_REGISTRY_KEY = "__veryfront_agent_registry__";
// deno-lint-ignore no-explicit-any
const _globalAgent = globalThis as any;
export const agentRegistry: AgentRegistryClass = _globalAgent[AGENT_REGISTRY_KEY] ||=
  new AgentRegistryClass();

// Export class for type usage
export { AgentRegistryClass };

/**
 * Register an agent for use by other agents
 */
export function registerAgent(id: string, agent: Agent): void {
  agentRegistry.register(id, agent);
}

/**
 * Get an agent by ID from the registry.
 * Returns undefined if agent not found.
 */
export function getAgent(id: string): Agent | undefined {
  return agentRegistry.get(id);
}

/**
 * Get all registered agent IDs
 */
export function getAllAgentIds(): string[] {
  return agentRegistry.getAllIds();
}

/**
 * Get all registered agents as tools
 */
export function getAgentsAsTools(descriptions?: Record<string, string>): Record<string, Tool> {
  const tools: Record<string, Tool> = {};

  for (const [id, agent] of agentRegistry.getAll()) {
    const description = descriptions?.[id] || `Call ${id} agent`;
    tools[id] = agentAsTool(agent, description);
  }

  return tools;
}
