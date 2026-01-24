import type { Agent } from "../types.ts";
import type { Tool } from "#veryfront/tool";
import { z } from "zod";
import { agentLogger } from "#veryfront/utils/logger/logger.ts";
import { setActiveSpanAttributes, withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

export function agentAsTool(agent: Agent, description: string): Tool {
  return {
    id: `agent_${agent.id}`,
    type: "function",
    description,
    inputSchema: z.object({
      input: z.string().describe("Input for the agent"),
    }),
    execute({ input }) {
      return withSpan(
        "agent.composition.agentAsTool.execute",
        async () => {
          const response = await agent.generate({ input });

          setActiveSpanAttributes({
            "agent.tool_calls": response.toolCalls.length,
            "agent.status": response.status,
          });

          return {
            text: response.text,
            toolCalls: response.toolCalls.length,
            status: response.status,
          };
        },
        { "agent.id": agent.id },
      );
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

export function createWorkflow(
  config: WorkflowConfig,
): { execute(input: string): Promise<WorkflowResult> } {
  return {
    execute(input: string): Promise<WorkflowResult> {
      return withSpan(
        "agent.composition.workflow.execute",
        async () => {
          const result: WorkflowResult = {
            output: input,
            steps: [],
            context: { ...config.initialContext },
          };

          for (const step of config.steps) {
            await withSpan(
              `agent.composition.workflow.step.${step.name}`,
              async () => {
                if (step.skip && (await step.skip(result.context))) {
                  result.steps.push({ name: step.name, output: "", skipped: true });
                  setActiveSpanAttributes({ "workflow.step.skipped": true });
                  return;
                }

                const response = await step.agent.generate({
                  input: result.output,
                  context: result.context,
                });

                const output = step.transform ? await step.transform(response.text) : response.text;

                result.output = output;
                result.steps.push({ name: step.name, output, skipped: false });
                result.context[step.name] = output;

                setActiveSpanAttributes({
                  "workflow.step.skipped": false,
                  "workflow.step.output_length": output.length,
                });
              },
              { "workflow.step.name": step.name, "workflow.step.agent_id": step.agent.id },
            );
          }

          setActiveSpanAttributes({
            "workflow.total_steps": config.steps.length,
            "workflow.executed_steps": result.steps.filter((s) => !s.skipped).length,
          });

          return result;
        },
        { "workflow.steps_count": config.steps.length },
      );
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

type GlobalWithRegistry = typeof globalThis & {
  [AGENT_REGISTRY_KEY]?: AgentRegistryClass;
};

const globalWithRegistry = globalThis as GlobalWithRegistry;

export const agentRegistry: AgentRegistryClass =
  (globalWithRegistry[AGENT_REGISTRY_KEY] ??= new AgentRegistryClass());

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
    tools[id] = agentAsTool(agent, descriptions?.[id] ?? `Call ${id} agent`);
  }

  return tools;
}
