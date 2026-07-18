/**
 * Agent Composition and Registry
 *
 * Project-scoped registry for agents. Each project has its own isolated
 * agent namespace, preventing cross-project agent access.
 *
 * @module
 */

import type { Agent, AgentResponse } from "../types.ts";
import type { Tool } from "#veryfront/tool";
import { setActiveSpanAttributes } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { ScopedRegistryFacade } from "#veryfront/registry/scoped-registry-facade.ts";
import { ProjectScopedRegistryManager } from "#veryfront/registry/project-scoped-registry-manager.ts";
import { getAgentToolInputSchema } from "../schemas/index.ts";

/** Agent as tool helper. */
async function runAgentAsStreamingTool(agent: Agent, input: string): Promise<AgentResponse> {
  let finalResponse: AgentResponse | undefined;
  const stream = await agent.stream({
    input,
    onFinish: (response) => {
      finalResponse = response;
    },
  });

  await stream.toDataStreamResponse().arrayBuffer();

  if (!finalResponse) {
    throw new Error(`Agent "${agent.id}" stream completed without a final response.`);
  }

  return finalResponse;
}

export function agentAsTool(agent: Agent, description: string): Tool {
  return {
    id: `agent_${agent.id}`,
    type: "function",
    description,
    inputSchema: getAgentToolInputSchema(),
    execute({ input }) {
      return withSpan(
        "agent.composition.agentAsTool.execute",
        async () => {
          const response = await runAgentAsStreamingTool(agent, input);

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

/** Public API contract for workflow step. */
export interface WorkflowStep {
  agent: Agent;
  name: string;
  transform?: (output: string) => string | Promise<string>;
  skip?: (context: Record<string, unknown>) => boolean | Promise<boolean>;
}

/** Configuration used by workflow. */
export interface WorkflowConfig {
  steps: WorkflowStep[];
  initialContext?: Record<string, unknown>;
}

/** Result returned from workflow. */
export interface WorkflowResult {
  output: string;
  steps: Array<{
    name: string;
    output: string;
    skipped: boolean;
  }>;
  context: Record<string, unknown>;
}

/** Create workflow. */
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

const GET_AGENT_BRIDGE_KEY = "__vfGetAgent";
const REGISTER_AGENT_BRIDGE_KEY = "__vfRegisterAgent";
const GET_ALL_AGENT_IDS_BRIDGE_KEY = "__vfGetAllAgentIds";

function getExistingGlobalAgentBridge(key: string, localValue: unknown): unknown | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
  if (!descriptor) return undefined;
  if (typeof descriptor.value !== "function") {
    throw new TypeError(`Global agent bridge ${key} already exists and is not callable.`);
  }
  return descriptor.value === localValue ? undefined : descriptor.value;
}

/** Registers agent. */
export function registerAgent(id: string, agent: Agent): void {
  const register = getExistingGlobalAgentBridge(REGISTER_AGENT_BRIDGE_KEY, registerAgent) as
    | ((id: string, agent: Agent) => void)
    | undefined;
  if (register) {
    register(id, agent);
    return;
  }

  agentRegistry.register(id, agent);
}

/** Return agent. */
export function getAgent(id: string): Agent | undefined {
  const get = getExistingGlobalAgentBridge(GET_AGENT_BRIDGE_KEY, getAgent) as
    | ((id: string) => Agent | undefined)
    | undefined;
  if (get) return get(id);

  return agentRegistry.get(id);
}

/** Return all agent IDs. */
export function getAllAgentIds(): string[] {
  const getAllIds = getExistingGlobalAgentBridge(GET_ALL_AGENT_IDS_BRIDGE_KEY, getAllAgentIds) as
    | (() => string[])
    | undefined;
  if (getAllIds) return getAllIds();

  return agentRegistry.getAllIds();
}

// Register on globalThis so compiled-binary runtime shim can delegate to the
// real registry. External temp-file modules can't import from the embedded
// binary FS, so they use globalThis bridges instead.
// Use Object.defineProperty to prevent accidental overwriting or enumeration.
function defineGlobalAgentBridge(key: string, value: unknown): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
  if (descriptor) {
    if (typeof descriptor.value === "function") return;
    throw new TypeError(`Global agent bridge ${key} already exists and is not callable.`);
  }

  Object.defineProperty(globalThis, key, {
    value,
    writable: false,
    enumerable: false,
    configurable: false,
  });
}

for (
  const [key, value] of Object.entries({
    [GET_AGENT_BRIDGE_KEY]: getAgent,
    [REGISTER_AGENT_BRIDGE_KEY]: registerAgent,
    [GET_ALL_AGENT_IDS_BRIDGE_KEY]: getAllAgentIds,
  })
) {
  defineGlobalAgentBridge(key, value);
}

/** Return agents as tools. */
export function getAgentsAsTools(descriptions?: Record<string, string>): Record<string, Tool> {
  const tools: Record<string, Tool> = {};

  for (const id of getAllAgentIds()) {
    const agent = getAgent(id);
    if (!agent) continue;
    tools[id] = agentAsTool(agent, descriptions?.[id] ?? `Call ${id} agent`);
  }

  return tools;
}
