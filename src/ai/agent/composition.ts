import type { Agent } from "../types/agent.ts";
import type { Tool } from "../types/tool.ts";
import { z } from "zod";
import { agentLogger } from "../../core/utils/logger/logger.ts";

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

export interface WorkflowStep {
  agent: Agent;
  name: string;
  transform?: (output: string) => string | Promise<string>;
  skip?: (context: Record<string, unknown>) => boolean | Promise<boolean>;
}

export interface WorkflowConfig {
  steps: WorkflowStep[];
  initialContext?: Record<string, unknown>;
}

export interface WorkflowResult {
  output: string;
  steps: Array<{
    name: string;
    output: string;
    skipped: boolean;
  }>;
  context: Record<string, unknown>;
}

export function createWorkflow(config: WorkflowConfig) {
  return {
    async execute(input: string): Promise<WorkflowResult> {
      const result: WorkflowResult = {
        output: input,
        steps: [],
        context: { ...config.initialContext },
      };

      for (const step of config.steps) {
        if (step.skip && (await step.skip(result.context))) {
          result.steps.push({
            name: step.name,
            output: "",
            skipped: true,
          });
          continue;
        }

        const response = await step.agent.generate({
          input: result.output,
          context: result.context,
        });

        let output = response.text;
        if (step.transform) {
          output = await step.transform(output);
        }

        result.output = output;
        result.steps.push({
          name: step.name,
          output,
          skipped: false,
        });

        result.context[step.name] = output;
      }

      return result;
    },
  };
}

class AgentRegistryClass {
  private agents = new Map<string, Agent>();

  register(id: string, agent: Agent): void {
    if (this.agents.has(id)) {
      agentLogger.debug(`Agent "${id}" is already registered. Overwriting.`);
    }
    this.agents.set(id, agent);
    agentLogger.debug(`Registered agent: ${id}`);
  }

  get(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  has(id: string): boolean {
    return this.agents.has(id);
  }

  getAllIds(): string[] {
    return Array.from(this.agents.keys());
  }

  getAll(): Map<string, Agent> {
    return new Map(this.agents);
  }

  clear(): void {
    this.agents.clear();
  }
}

const AGENT_REGISTRY_KEY = "__veryfront_agent_registry__";
// deno-lint-ignore no-explicit-any
const _globalAgent = globalThis as any;
export const agentRegistry: AgentRegistryClass = _globalAgent[AGENT_REGISTRY_KEY] ||=
  new AgentRegistryClass();

export { AgentRegistryClass };

export function registerAgent(id: string, agent: Agent): void {
  agentRegistry.register(id, agent);
}

export function getAgent(id: string): Agent | undefined {
  return agentRegistry.get(id);
}

export function getAllAgentIds(): string[] {
  return agentRegistry.getAllIds();
}

export function getAgentsAsTools(descriptions?: Record<string, string>): Record<string, Tool> {
  const tools: Record<string, Tool> = {};

  for (const [id, agent] of agentRegistry.getAll()) {
    const description = descriptions?.[id] || `Call ${id} agent`;
    tools[id] = agentAsTool(agent, description);
  }

  return tools;
}
