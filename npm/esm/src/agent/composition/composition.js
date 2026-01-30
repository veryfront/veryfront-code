/**
 * Agent Composition and Registry
 *
 * Project-scoped registry for agents. Each project has its own isolated
 * agent namespace, preventing cross-project agent access.
 *
 * @module
 */
import { z } from "zod";
import { setActiveSpanAttributes, withSpan } from "../../observability/tracing/otlp-setup.js";
import { ProjectScopedRegistryManager } from "../../ai/registry-manager.js";
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
const agentManager = new ProjectScopedRegistryManager("agent");
class AgentRegistryClass {
    register(id, agent) {
        agentManager.register(id, agent);
    }
    /**
     * Register a framework-provided agent available to all projects.
     */
    registerShared(id, agent) {
        agentManager.registerShared(id, agent);
    }
    get(id) {
        return agentManager.get(id);
    }
    has(id) {
        return agentManager.has(id);
    }
    getAllIds() {
        return agentManager.getAllIds();
    }
    getAll() {
        return agentManager.getAll();
    }
    clear() {
        agentManager.clear();
    }
    /**
     * Clear everything (for testing).
     */
    clearAll() {
        agentManager.clearAll();
    }
    getStats() {
        return agentManager.getStats();
    }
}
// Singleton instance - maintains same interface but now project-scoped internally
export const agentRegistry = new AgentRegistryClass();
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
