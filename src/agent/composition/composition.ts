/**
 * Agent Composition and Registry
 *
 * Project-scoped registry for agents. Each project has its own isolated
 * agent namespace, preventing cross-project agent access.
 *
 * @module
 */

import type { Agent } from "../types.ts";
import type { Tool } from "#veryfront/tool";
import { setActiveSpanAttributes, withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { ProjectScopedRegistryManager } from "#veryfront/ai/registry-manager.ts";
import { ScopedRegistryFacade } from "#veryfront/ai/registry-facade.ts";
import { AgentToolInputSchema } from "../schemas/index.ts";

export function agentAsTool(agent: Agent, description: string): Tool {
  return {
    id: `agent_${agent.id}`,
    type: "function",
    description,
    inputSchema: AgentToolInputSchema,
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
                const shouldSkip = await step.skip?.(result.context);
                if (shouldSkip) {
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

const agentManager = new ProjectScopedRegistryManager<Agent>("agent");

class AgentRegistryClass extends ScopedRegistryFacade<Agent> {}

// Singleton instance - maintains same interface but now project-scoped internally
export const agentRegistry = new AgentRegistryClass(agentManager);

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

// Register on globalThis so compiled-binary runtime shim can delegate to the
// real registry. External temp-file modules can't import from the embedded
// binary FS, so they use globalThis bridges instead.
// Use Object.defineProperty to prevent accidental overwriting or enumeration.
for (
  const [key, value] of Object.entries({
    __vfGetAgent: getAgent,
    __vfRegisterAgent: registerAgent,
    __vfGetAllAgentIds: getAllAgentIds,
  })
) {
  Object.defineProperty(globalThis, key, {
    value,
    writable: false,
    enumerable: false,
    configurable: false,
  });
}

export function getAgentsAsTools(descriptions?: Record<string, string>): Record<string, Tool> {
  const tools: Record<string, Tool> = {};

  for (const [id, agent] of agentRegistry.getAll()) {
    tools[id] = agentAsTool(agent, descriptions?.[id] ?? `Call ${id} agent`);
  }

  return tools;
}
