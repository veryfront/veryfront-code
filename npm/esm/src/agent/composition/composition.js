import * as dntShim from "../../../_dnt.shims.js";
import { z } from "zod";
import { agentLogger } from "../../utils/logger/logger.js";
import { setActiveSpanAttributes, withSpan } from "../../observability/tracing/otlp-setup.js";
export function agentAsTool(agent, description) {
    return {
        id: `agent_${agent.id}`,
        type: "function",
        description,
        inputSchema: z.object({
            input: z.string().describe("Input for the agent"),
        }),
        execute({ input }) {
            return withSpan("agent.composition.agentAsTool.execute", async () => {
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
            }, { "agent.id": agent.id });
        },
    };
}
export function createWorkflow(config) {
    return {
        execute(input) {
            return withSpan("agent.composition.workflow.execute", async () => {
                const result = {
                    output: input,
                    steps: [],
                    context: { ...config.initialContext },
                };
                for (const step of config.steps) {
                    await withSpan(`agent.composition.workflow.step.${step.name}`, async () => {
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
                    }, { "workflow.step.name": step.name, "workflow.step.agent_id": step.agent.id });
                }
                setActiveSpanAttributes({
                    "workflow.total_steps": config.steps.length,
                    "workflow.executed_steps": result.steps.filter((s) => !s.skipped).length,
                });
                return result;
            }, { "workflow.steps_count": config.steps.length });
        },
    };
}
class AgentRegistryClass {
    agents = new Map();
    register(id, agent) {
        if (this.agents.has(id)) {
            agentLogger.debug(`Agent "${id}" is already registered. Overwriting.`);
        }
        this.agents.set(id, agent);
        agentLogger.debug(`Registered agent: ${id}`);
    }
    get(id) {
        return this.agents.get(id);
    }
    has(id) {
        return this.agents.has(id);
    }
    getAllIds() {
        return Array.from(this.agents.keys());
    }
    getAll() {
        return new Map(this.agents);
    }
    clear() {
        this.agents.clear();
    }
}
const AGENT_REGISTRY_KEY = "__veryfront_agent_registry__";
const globalWithRegistry = dntShim.dntGlobalThis;
export const agentRegistry = (globalWithRegistry[AGENT_REGISTRY_KEY] ??= new AgentRegistryClass());
export { AgentRegistryClass };
export function registerAgent(id, agent) {
    agentRegistry.register(id, agent);
}
export function getAgent(id) {
    return agentRegistry.get(id);
}
export function getAllAgentIds() {
    return agentRegistry.getAllIds();
}
export function getAgentsAsTools(descriptions) {
    const tools = {};
    for (const [id, agent] of agentRegistry.getAll()) {
        tools[id] = agentAsTool(agent, descriptions?.[id] ?? `Call ${id} agent`);
    }
    return tools;
}
